/**
 * services/uipath.test.js
 *
 * Unit tests for the UiPath service.
 *
 * All network calls are intercepted by replacing the global `fetch` with a
 * Jest mock so no real HTTP requests are made.
 *
 * Requirements covered: 5.1, 5.2, 5.4, 5.5, 6.1, 6.2
 */

'use strict';

// ─── Set up env vars before requiring the module ─────────────────────────────
process.env.UIPATH_BASE_URL = 'https://cloud.uipath.com';
process.env.UIPATH_TENANT = 'TestTenant';
process.env.UIPATH_CLIENT_ID = 'test-client-id';
process.env.UIPATH_CLIENT_SECRET = 'test-client-secret';

const {
  triggerAndPoll,
  getAccessToken,
  triggerJob,
  pollJob,
  cancelJob,
  _clearTokenCache,
} = require('./uipath');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal mock fetch Response.
 */
function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** Valid token response */
const TOKEN_RESP = { access_token: 'test-token', expires_in: 3600 };

/** Shortcut: a fetch that first returns a token then the provided response. */
function fetchSeq(...responses) {
  let idx = 0;
  return jest.fn(() => Promise.resolve(responses[idx++]));
}

// ─── Before each test ────────────────────────────────────────────────────────

beforeEach(() => {
  _clearTokenCache();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  global.fetch = undefined;
});

// ─── getAccessToken ───────────────────────────────────────────────────────────

describe('getAccessToken', () => {
  test('fetches a token and returns the access_token string', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200, TOKEN_RESP));

    const token = await getAccessToken();

    expect(token).toBe('test-token');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://cloud.uipath.com/identity_/connect/token');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(options.body).toContain('grant_type=client_credentials');
  });

  test('returns cached token on subsequent calls without refetching', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(200, TOKEN_RESP));

    await getAccessToken();
    await getAccessToken();

    // Second call should use cache
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('throws an error when token endpoint returns non-2xx', async () => {
    global.fetch = jest.fn().mockResolvedValue(mockResponse(401, 'Unauthorized'));

    await expect(getAccessToken()).rejects.toThrow(/token request failed \[401\]/i);
  });
});

// ─── triggerJob ───────────────────────────────────────────────────────────────

describe('triggerJob', () => {
  test('posts to StartJobs URL and returns the job ID', async () => {
    global.fetch = fetchSeq(
      mockResponse(200, TOKEN_RESP),
      mockResponse(200, { value: [{ Id: 42, State: 'Pending' }] })
    );

    const jobId = await triggerJob('MyProcess', { foo: 'bar' });
    expect(jobId).toBe(42);

    const [url, options] = global.fetch.mock.calls[1];
    expect(url).toContain('StartJobs');
    expect(url).toContain('TestTenant');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body);
    expect(body.startInfo.ReleaseKey).toBe('MyProcess');
    expect(body.startInfo.InputArguments).toBe(JSON.stringify({ foo: 'bar' }));
  });

  test('throws when API returns non-2xx', async () => {
    global.fetch = fetchSeq(
      mockResponse(200, TOKEN_RESP),
      mockResponse(400, 'Bad Request')
    );

    await expect(triggerJob('BadProcess')).rejects.toThrow(/StartJobs failed \[400\]/i);
  });

  test('throws when response value array is empty', async () => {
    global.fetch = fetchSeq(
      mockResponse(200, TOKEN_RESP),
      mockResponse(200, { value: [] })
    );

    await expect(triggerJob('EmptyProcess')).rejects.toThrow(/no jobs in response/i);
  });
});

// ─── pollJob ──────────────────────────────────────────────────────────────────

describe('pollJob', () => {
  test('GETs the Jobs(id) URL and returns parsed JSON', async () => {
    const jobData = { Id: 7, State: 'Running', OutputArguments: null };
    global.fetch = fetchSeq(
      mockResponse(200, TOKEN_RESP),
      mockResponse(200, jobData)
    );

    const result = await pollJob(7);
    expect(result.State).toBe('Running');

    const [url] = global.fetch.mock.calls[1];
    expect(url).toContain('/Jobs(7)');
    expect(url).toContain('TestTenant');
  });

  test('throws on non-2xx poll response', async () => {
    global.fetch = fetchSeq(
      mockResponse(200, TOKEN_RESP),
      mockResponse(404, 'Not Found')
    );

    await expect(pollJob(999)).rejects.toThrow(/poll failed \[404\]/i);
  });
});

// ─── cancelJob ────────────────────────────────────────────────────────────────

describe('cancelJob', () => {
  test('POSTs to StopJob URL', async () => {
    global.fetch = fetchSeq(
      mockResponse(200, TOKEN_RESP),
      mockResponse(200, {})
    );

    await cancelJob(5);

    const [url] = global.fetch.mock.calls[1];
    expect(url).toContain('/Jobs(5)/');
    expect(url).toContain('StopJob');
  });

  test('does not throw when StopJob returns an error', async () => {
    global.fetch = fetchSeq(
      mockResponse(200, TOKEN_RESP),
      mockResponse(500, 'Server Error')
    );

    // Should resolve without throwing
    await expect(cancelJob(5)).resolves.toBeUndefined();
  });

  test('does not throw when fetch itself rejects', async () => {
    let callCount = 0;
    global.fetch = jest.fn(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(mockResponse(200, TOKEN_RESP));
      return Promise.reject(new Error('Network error'));
    });

    await expect(cancelJob(5)).resolves.toBeUndefined();
  });
});

// ─── triggerAndPoll ───────────────────────────────────────────────────────────

describe('triggerAndPoll', () => {
  /**
   * Build a sequence of fetch responses:
   *   1. Token response
   *   2. StartJobs response
   *   3+ Poll responses
   */
  function buildFetchMock(pollResponses) {
    const allResponses = [
      mockResponse(200, TOKEN_RESP),
      mockResponse(200, { value: [{ Id: 100, State: 'Pending' }] }),
      ...pollResponses.map(state =>
        mockResponse(200, { State: state, OutputArguments: { result: 'ok' }, Info: 'done' })
      ),
    ];
    return fetchSeq(...allResponses);
  }

  test('returns success when job reaches Successful state on first poll', async () => {
    global.fetch = buildFetchMock(['Successful']);

    // Run triggerAndPoll and advance timers to skip the poll interval
    const promise = triggerAndPoll('SomeProcess', { arg: 1 });
    // No sleep needed — it polls immediately, gets Successful, returns
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ result: 'ok' });
    expect(result.timedOut).toBeUndefined();
  });

  test('returns failure when job reaches Faulted state', async () => {
    const allResponses = [
      mockResponse(200, TOKEN_RESP),
      mockResponse(200, { value: [{ Id: 200, State: 'Pending' }] }),
      mockResponse(200, { State: 'Faulted', Info: 'Script error', OutputArguments: null }),
    ];
    global.fetch = fetchSeq(...allResponses);

    const result = await triggerAndPoll('FaultingProcess');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Script error');
    expect(result.timedOut).toBeUndefined();
  });

  test('polls through RUNNING state before reaching Successful', async () => {
    const allResponses = [
      mockResponse(200, TOKEN_RESP),
      mockResponse(200, { value: [{ Id: 300, State: 'Pending' }] }),
      mockResponse(200, { State: 'Running', OutputArguments: null }),
      mockResponse(200, { State: 'Successful', OutputArguments: { commits: 1 }, Info: '' }),
    ];
    global.fetch = fetchSeq(...allResponses);

    let done = false;
    const promise = triggerAndPoll('RunningProcess').then(r => {
      done = true;
      return r;
    });

    // Advance 5 s to skip first poll interval (after RUNNING response)
    await jest.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(done).toBe(true);
    expect(result.success).toBe(true);
  });

  test('returns failure with timedOut=true and cancels job after timeout', async () => {
    // Job stays Running forever
    const tokenAndStart = [
      mockResponse(200, TOKEN_RESP),
      mockResponse(200, { value: [{ Id: 400, State: 'Pending' }] }),
    ];

    // Generate enough Running responses to survive 5 minutes of polling
    // (300 000 ms / 5 000 ms = 60 polls) + cancel call token + cancel call
    const pollCount = 62; // slightly more than needed
    const pollResponses = Array(pollCount).fill(null).map(() =>
      mockResponse(200, { State: 'Running', OutputArguments: null })
    );
    // Cancel token + cancel StopJob
    const cancelResponses = [
      mockResponse(200, TOKEN_RESP),
      mockResponse(200, {}),
    ];

    global.fetch = fetchSeq(...tokenAndStart, ...pollResponses, ...cancelResponses);

    const promise = triggerAndPoll('SlowProcess');

    // Advance past 5-minute timeout
    await jest.advanceTimersByTimeAsync(300_000 + 5_000);

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.error).toMatch(/timed out/i);
  });

  test('returns failure when triggerJob fails to start', async () => {
    global.fetch = fetchSeq(
      mockResponse(200, TOKEN_RESP),
      mockResponse(503, 'Service Unavailable')
    );

    const result = await triggerAndPoll('BadProcess');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Failed to start job/i);
    expect(result.timedOut).toBeUndefined();
  });

  test('continues polling after a transient poll error', async () => {
    // fetch call sequence:
    // 1. Token (initial auth)
    // 2. StartJobs
    // 3. Poll #1 → rejects (transient error), sleep(5s) then retry
    // 4. Token (re-auth after cache cleared or token still valid — poll uses same cached token)
    //    Actually the token IS cached from call #1. The poll catch just sleeps and continues.
    //    So next iteration calls pollJob again with the same token:
    // 4. Poll #2 → Successful

    // Because the token is cached after call #1, the next pollJob does NOT re-fetch a token.
    // Sequence: auth, startJobs, poll(reject), poll(Successful)
    let callCount = 0;
    global.fetch = jest.fn(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(mockResponse(200, TOKEN_RESP)); // auth + cache
      if (callCount === 2) return Promise.resolve(mockResponse(200, { value: [{ Id: 500 }] })); // start
      if (callCount === 3) return Promise.reject(new Error('Transient error')); // first poll fails
      // Token is still cached; next pollJob call goes straight to GET Jobs
      return Promise.resolve(mockResponse(200, { State: 'Successful', OutputArguments: {} }));
    });

    const promise = triggerAndPoll('TransientProcess');

    // Advance 5 s to skip the sleep after the transient error so the retry poll runs
    await jest.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result.success).toBe(true);
  }, 15_000); // generous timeout
});
