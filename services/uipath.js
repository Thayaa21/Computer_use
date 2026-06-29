/**
 * services/uipath.js
 *
 * UiPath Orchestrator integration for GhostDev.
 *
 * Handles OAuth2 client-credentials authentication, job triggering,
 * job polling, job cancellation, and a combined triggerAndPoll flow
 * with a 5-minute timeout.
 *
 * Requirements: 5.1, 5.2, 5.4, 5.5, 6.1, 6.2
 *
 * Job lifecycle state machine:
 *   PENDING → RUNNING → [Successful | Faulted | Cancelled]
 *                            ↑ timeout after 5 min → CANCELLED
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

/** 5-minute job timeout in milliseconds */
const JOB_TIMEOUT_MS = 5 * 60 * 1000; // 300 000 ms

/** Poll interval: 5 seconds */
const POLL_INTERVAL_MS = 5 * 1000; // 5 000 ms

// ─── Env helpers ─────────────────────────────────────────────────────────────

function getBaseUrl() {
  return process.env.UIPATH_BASE_URL;
}

function getTenant() {
  return process.env.UIPATH_TENANT;
}

function getOrg() {
  return process.env.UIPATH_ORG;
}

function getClientId() {
  return process.env.UIPATH_CLIENT_ID;
}

function getClientSecret() {
  return process.env.UIPATH_CLIENT_SECRET;
}

// ─── Token cache ─────────────────────────────────────────────────────────────

/** Cached OAuth2 access token and its expiry timestamp (ms since epoch). */
let _cachedToken = null;
let _tokenExpiresAt = 0;

/**
 * Fetch (or return cached) OAuth2 client-credentials access token.
 *
 * POST ${UIPATH_BASE_URL}/identity_/connect/token
 *   grant_type=client_credentials
 *   client_id=…
 *   client_secret=…
 *
 * @returns {Promise<string>} Bearer token string
 * @throws {Error} if the token request fails
 */
async function getAccessToken() {
  const now = Date.now();

  // Return cached token if still valid (with 30-second safety margin)
  if (_cachedToken && now < _tokenExpiresAt - 30_000) {
    return _cachedToken;
  }

  const tokenUrl = `${getBaseUrl()}/identity_/connect/token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: getClientId(),
    client_secret: getClientSecret(),
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `UiPath token request failed [${response.status}]: ${text}`
    );
  }

  const data = await response.json();
  _cachedToken = data.access_token;
  // expires_in is in seconds; default to 3600 if absent
  const expiresIn = (data.expires_in ?? 3600) * 1000;
  _tokenExpiresAt = now + expiresIn;

  return _cachedToken;
}

// ─── Job operations ───────────────────────────────────────────────────────────

/**
 * Trigger a UiPath Robot job for a given process key.
 *
 * POST ${UIPATH_BASE_URL}/${UIPATH_TENANT}/orchestrator_/odata/Jobs/
 *        UiPath.Server.Configuration.OData.StartJobs
 *
 * @param {string} processKey - The UiPath process / release key.
 * @param {Record<string, unknown>} [inputArgs={}] - Input arguments for the Robot job.
 * @returns {Promise<number|string>} The numeric (or string) Job ID.
 * @throws {Error} if the request fails or the response is unexpected.
 */
async function triggerJob(processKey, inputArgs = {}) {
  const token = await getAccessToken();
  const url = `${getBaseUrl()}/${getOrg()}/${getTenant()}/orchestrator_/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs`;

  const payload = {
    startInfo: {
      ReleaseKey: processKey,
      RobotIds: [],
      NoOfRobots: 0,
      Source: 'Manual',
      InputArguments: JSON.stringify(inputArgs),
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-UIPATH-TenantName': getTenant(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `UiPath StartJobs failed [${response.status}]: ${text}`
    );
  }

  const data = await response.json();

  // The API returns { value: [ { Id: <jobId>, ... }, ... ] }
  const jobs = data.value;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    throw new Error('UiPath StartJobs returned no jobs in response');
  }

  return jobs[0].Id;
}

/**
 * Poll the current state of a UiPath job.
 *
 * GET ${UIPATH_BASE_URL}/${UIPATH_TENANT}/orchestrator_/odata/Jobs(${jobId})
 *
 * @param {number|string} jobId
 * @returns {Promise<{ State: string, OutputArguments?: Record<string, unknown>, Info?: string }>}
 * @throws {Error} if the request fails.
 */
async function pollJob(jobId) {
  const token = await getAccessToken();
  const url = `${getBaseUrl()}/${getOrg()}/${getTenant()}/orchestrator_/odata/Jobs(${jobId})`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-UIPATH-TenantName': getTenant(),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `UiPath Jobs poll failed [${response.status}]: ${text}`
    );
  }

  return response.json();
}

/**
 * Cancel a running UiPath job.
 *
 * POST ${UIPATH_BASE_URL}/${UIPATH_TENANT}/orchestrator_/odata/Jobs(${jobId})/
 *        UiPath.Server.Configuration.OData.StopJob
 *
 * Errors are swallowed — the caller has already decided to abandon the job.
 *
 * @param {number|string} jobId
 * @returns {Promise<void>}
 */
async function cancelJob(jobId) {
  try {
    const token = await getAccessToken();
    const url = `${getBaseUrl()}/${getOrg()}/${getTenant()}/orchestrator_/odata/Jobs(${jobId})/UiPath.Server.Configuration.OData.StopJob`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-UIPATH-TenantName': getTenant(),
      },
      body: JSON.stringify({ strategy: 'SoftStop' }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // Log but do not rethrow — this is a best-effort cancellation
      console.error(`UiPath StopJob failed [${response.status}]: ${text}`);
    }
  } catch (err) {
    // Best-effort: swallow cancellation errors
    console.error('UiPath cancelJob error (swallowed):', err.message);
  }
}

// ─── Sleep helper ─────────────────────────────────────────────────────────────

/**
 * Promise-based sleep.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Terminal states ──────────────────────────────────────────────────────────

/** States that indicate the job has finished (one way or another). */
const TERMINAL_STATES = new Set(['Successful', 'Faulted', 'Stopped', 'Abandoned', 'Cancelled']);

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Trigger a UiPath Robot job and poll until it finishes or times out.
 *
 * - Polls every POLL_INTERVAL_MS (5 s).
 * - Cancels the job and returns a timed-out result after JOB_TIMEOUT_MS (5 min).
 *
 * @param {string} processKey - The UiPath process / release key.
 * @param {Record<string, unknown>} [inputArgs={}] - Input arguments for the Robot job.
 * @returns {Promise<UiPathJobResult>}
 *
 * @typedef {{ success: boolean, output?: Record<string, unknown>, error?: string, timedOut?: boolean }} UiPathJobResult
 */
async function triggerAndPoll(processKey, inputArgs = {}) {
  let jobId;

  try {
    jobId = await triggerJob(processKey, inputArgs);
  } catch (err) {
    // Requirement 5.4 / 6.1: job failed to start
    return {
      success: false,
      error: `Failed to start job: ${err.message}`,
    };
  }

  const deadline = Date.now() + JOB_TIMEOUT_MS;

  while (Date.now() < deadline) {
    let job;

    try {
      job = await pollJob(jobId);
    } catch (err) {
      // Poll error — wait and retry (don't abort the entire flow)
      console.error(`UiPath poll error for job ${jobId} (retrying):`, err.message);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const state = job.State;

    if (state === 'Successful') {
      // Requirement 5.2 / 6.1: job completed successfully
      return {
        success: true,
        output: job.OutputArguments ?? {},
      };
    }

    if (TERMINAL_STATES.has(state) && state !== 'Successful') {
      // Faulted, Stopped, Abandoned, Cancelled
      return {
        success: false,
        error: job.Info || `Job ended with state: ${state}`,
      };
    }

    // Still PENDING or RUNNING — wait and poll again
    await sleep(POLL_INTERVAL_MS);
  }

  // Requirement 5.5: timed out — cancel and notify
  await cancelJob(jobId);

  return {
    success: false,
    error: 'Job timed out after 5 minutes',
    timedOut: true,
  };
}

// ─── Test helpers (not part of public API) ───────────────────────────────────

/**
 * Clear the cached access token (useful in tests to force re-auth).
 */
function _clearTokenCache() {
  _cachedToken = null;
  _tokenExpiresAt = 0;
}

module.exports = {
  triggerAndPoll,
  // Internals exported for unit testing
  getAccessToken,
  triggerJob,
  pollJob,
  cancelJob,
  _clearTokenCache,
};
