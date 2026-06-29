'use strict';

/**
 * Tests for routes/slack.js — Slack Event Handler
 *
 * Wiring tests: verify the POST /events and POST /actions endpoints behave
 * correctly with respect to:
 *   - URL-verification challenge echo (Requirement 9.3)
 *   - 403 on invalid/missing Slack signature (Requirement 9.2)
 *   - Classify and dispatch for non-bot message events (Requirements 2.1, 2.2)
 *
 * Test setup:
 *   - express.raw({ type: '*\/*' }) is mounted before the router (matches production)
 *   - Valid Slack signatures are generated using HMAC-SHA256 matching the
 *     production algorithm: v0:${timestamp}:${rawBody}
 */

const crypto   = require('crypto');
const express  = require('express');
const request  = require('supertest');

// ─── Mock dependencies before requiring the module under test ─────────────────

jest.mock('../services/claudeChat');
jest.mock('../services/router');

const claudeChat     = require('../services/claudeChat');
const routerService  = require('../services/router');

// ─── Test app factory ─────────────────────────────────────────────────────────

const TEST_SECRET = 'test-signing-secret-abc123';

/**
 * Build an Express app that mirrors the production setup:
 *   express.raw({ type: '*\/*' }) → slackRouter
 */
function buildApp() {
  // Must reset module registry so the router module re-reads env vars
  // (we set SLACK_SIGNING_SECRET before each describe block).
  const app = express();
  app.use(express.raw({ type: '*/*' }));
  // Re-require the router so it picks up any cleared mocks
  const slackRouter = require('./slack');
  app.use('/', slackRouter);
  return app;
}

/**
 * Generate a valid Slack request signature for the given raw body string.
 *
 * Algorithm (matches verifySlackSignature in routes/slack.js):
 *   sigBaseString = `v0:${timestamp}:${rawBody}`
 *   signature     = `v0=` + HMAC-SHA256(sigBaseString, SLACK_SIGNING_SECRET).hex
 *
 * @param {string} rawBody  The raw request body (string or JSON-serialised)
 * @param {number} [ts]     Unix timestamp (defaults to now)
 * @returns {{ timestamp: string, signature: string }}
 */
function generateSlackSignature(rawBody, ts) {
  const timestamp = String(ts ?? Math.floor(Date.now() / 1000));
  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', TEST_SECRET);
  hmac.update(sigBaseString);
  const signature = `v0=${hmac.digest('hex')}`;
  return { timestamp, signature };
}

// ─── Shared setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SLACK_SIGNING_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.SLACK_SIGNING_SECRET;
});

// ─── Helper: send a signed POST /events request ───────────────────────────────

/**
 * Send a POST /events request with a correctly signed body.
 *
 * @param {object|string} bodyObj  Payload to send (will be JSON-serialised if object)
 * @param {object}        [overrideHeaders]  Override specific headers
 */
async function signedPost(app, bodyObj, overrideHeaders = {}) {
  const rawBody = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  const { timestamp, signature } = generateSlackSignature(rawBody);
  return request(app)
    .post('/events')
    .set('Content-Type', 'application/json')
    .set('x-slack-request-timestamp', timestamp)
    .set('x-slack-signature', signature)
    .send(rawBody);
}

// =============================================================================
// POST /events — URL-verification challenge
// =============================================================================

describe('POST /events — URL-verification challenge', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  it('responds 200 and echoes the challenge value (Requirement 9.3)', async () => {
    const payload = { type: 'url_verification', challenge: 'abc123challenge' };
    const res = await signedPost(app, payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ challenge: 'abc123challenge' });
  });

  it('echoes the exact challenge string provided by Slack', async () => {
    const challenge = 'xoxp-unique-challenge-value-9876';
    const payload = { type: 'url_verification', challenge };
    const res = await signedPost(app, payload);

    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe(challenge);
  });

  it('does NOT classify or dispatch on a url_verification event', async () => {
    const payload = { type: 'url_verification', challenge: 'some-challenge' };
    await signedPost(app, payload);

    expect(claudeChat.classify).not.toHaveBeenCalled();
    expect(routerService.dispatch).not.toHaveBeenCalled();
  });
});

// =============================================================================
// POST /events — Signature verification (Requirement 9.2)
// =============================================================================

describe('POST /events — signature verification', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  it('returns 403 when x-slack-signature header is missing', async () => {
    const rawBody = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
    const { timestamp } = generateSlackSignature(rawBody);

    const res = await request(app)
      .post('/events')
      .set('Content-Type', 'application/json')
      .set('x-slack-request-timestamp', timestamp)
      // no x-slack-signature header
      .send(rawBody);

    expect(res.status).toBe(403);
  });

  it('returns 403 when x-slack-request-timestamp header is missing', async () => {
    const rawBody = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
    const { signature } = generateSlackSignature(rawBody);

    const res = await request(app)
      .post('/events')
      .set('Content-Type', 'application/json')
      .set('x-slack-signature', signature)
      // no x-slack-request-timestamp header
      .send(rawBody);

    expect(res.status).toBe(403);
  });

  it('returns 403 when the signature is wrong (tampered body)', async () => {
    const originalBody = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
    const { timestamp, signature } = generateSlackSignature(originalBody);
    // Tamper: send a different body than what was signed
    const tamperedBody = JSON.stringify({ type: 'url_verification', challenge: 'TAMPERED' });

    const res = await request(app)
      .post('/events')
      .set('Content-Type', 'application/json')
      .set('x-slack-request-timestamp', timestamp)
      .set('x-slack-signature', signature)
      .send(tamperedBody);

    expect(res.status).toBe(403);
  });

  it('returns 403 when the signature uses a different secret', async () => {
    const rawBody = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const wrongSecret = 'totally-wrong-secret';
    const sigBase = `v0:${timestamp}:${rawBody}`;
    const hmac = crypto.createHmac('sha256', wrongSecret);
    hmac.update(sigBase);
    const badSignature = `v0=${hmac.digest('hex')}`;

    const res = await request(app)
      .post('/events')
      .set('Content-Type', 'application/json')
      .set('x-slack-request-timestamp', timestamp)
      .set('x-slack-signature', badSignature)
      .send(rawBody);

    expect(res.status).toBe(403);
  });

  it('returns 403 when timestamp is older than 5 minutes (replay attack)', async () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 6 * 60; // 6 min ago
    const rawBody = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
    const { signature } = generateSlackSignature(rawBody, staleTimestamp);

    const res = await request(app)
      .post('/events')
      .set('Content-Type', 'application/json')
      .set('x-slack-request-timestamp', String(staleTimestamp))
      .set('x-slack-signature', signature)
      .send(rawBody);

    expect(res.status).toBe(403);
  });

  it('returns 200 when the signature is valid', async () => {
    const payload = { type: 'url_verification', challenge: 'valid-sig-test' };
    const res = await signedPost(app, payload);
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// POST /events — Non-bot message events: classify + dispatch (Requirements 2.1, 2.2)
// =============================================================================

describe('POST /events — non-bot message event dispatch', () => {
  let app;

  beforeAll(() => { app = buildApp(); });

  beforeEach(() => {
    claudeChat.classify.mockResolvedValue({ intent: 'fetch_file', data: { path: 'src/index.js' } });
    routerService.dispatch.mockResolvedValue(undefined);
  });

  it('acknowledges immediately with 200 before async work completes (Requirement 2.1)', async () => {
    // Make classify take a long time so we can confirm 200 comes back first
    claudeChat.classify.mockImplementation(() =>
      new Promise(resolve => setTimeout(() => resolve({ intent: 'unknown', data: {} }), 200))
    );

    const payload = {
      event: {
        type: 'message',
        text: 'fetch src/index.js',
        ts: '1609459200.000100',
        channel: 'C12345678',
      },
    };

    const res = await signedPost(app, payload);
    expect(res.status).toBe(200);
  });

  it('calls claudeChat.classify with the message text (Requirement 2.1)', async () => {
    const payload = {
      event: {
        type: 'message',
        text: 'fetch src/index.js',
        ts: '1609459200.000100',
        channel: 'C12345678',
      },
    };

    await signedPost(app, payload);

    // Give the async chain a tick to complete
    await new Promise(r => setImmediate(r));

    expect(claudeChat.classify).toHaveBeenCalledWith('fetch src/index.js');
  });

  it('calls routerService.dispatch with the classified intent and context (Requirement 2.2)', async () => {
    const classifiedIntent = { intent: 'fetch_file', data: { path: 'src/app.js' } };
    claudeChat.classify.mockResolvedValue(classifiedIntent);

    const payload = {
      event: {
        type: 'message',
        text: 'fetch src/app.js',
        ts: '1609459200.000200',
        channel: 'C99999999',
      },
    };

    await signedPost(app, payload);
    await new Promise(r => setImmediate(r));

    expect(routerService.dispatch).toHaveBeenCalledWith(classifiedIntent, {
      text: 'fetch src/app.js',
      threadTs: '1609459200.000200',
      channelId: 'C99999999',
    });
  });

  it('does NOT classify or dispatch bot messages (bot_id present)', async () => {
    const payload = {
      event: {
        type: 'message',
        bot_id: 'B12345678',
        text: 'I am a bot',
        ts: '1609459200.000300',
        channel: 'C12345678',
      },
    };

    await signedPost(app, payload);
    await new Promise(r => setImmediate(r));

    expect(claudeChat.classify).not.toHaveBeenCalled();
    expect(routerService.dispatch).not.toHaveBeenCalled();
  });

  it('does NOT classify or dispatch messages with a subtype (e.g., message_changed)', async () => {
    const payload = {
      event: {
        type: 'message',
        subtype: 'message_changed',
        text: 'edited message',
        ts: '1609459200.000400',
        channel: 'C12345678',
      },
    };

    await signedPost(app, payload);
    await new Promise(r => setImmediate(r));

    expect(claudeChat.classify).not.toHaveBeenCalled();
    expect(routerService.dispatch).not.toHaveBeenCalled();
  });

  it('does NOT classify or dispatch non-message event types', async () => {
    const payload = {
      event: {
        type: 'reaction_added',
        reaction: 'thumbsup',
        ts: '1609459200.000500',
        channel: 'C12345678',
      },
    };

    await signedPost(app, payload);
    await new Promise(r => setImmediate(r));

    expect(claudeChat.classify).not.toHaveBeenCalled();
    expect(routerService.dispatch).not.toHaveBeenCalled();
  });

  it('returns 200 even when classify throws — errors are swallowed to prevent Slack retries', async () => {
    claudeChat.classify.mockRejectedValue(new Error('Claude API down'));

    const payload = {
      event: {
        type: 'message',
        text: 'do something',
        ts: '1609459200.000600',
        channel: 'C12345678',
      },
    };

    const res = await signedPost(app, payload);
    expect(res.status).toBe(200);
  });
});

// =============================================================================
// POST /actions — interactive action stub
// =============================================================================

describe('POST /actions — interactive action stub', () => {
  let app;
  beforeAll(() => { app = buildApp(); });

  it('returns 200 for any POST to /actions', async () => {
    const res = await request(app)
      .post('/actions')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'block_actions', actions: [] }));

    expect(res.status).toBe(200);
  });
});

// =============================================================================
// Exported helpers — verifySlackSignature and parseBody
// =============================================================================

describe('verifySlackSignature() — exported helper', () => {
  const { verifySlackSignature } = require('./slack');

  it('returns true for a valid signature', () => {
    const rawBody = '{"type":"url_verification","challenge":"abc"}';
    const { timestamp, signature } = generateSlackSignature(rawBody);
    const req = {
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      },
      body: Buffer.from(rawBody),
    };
    expect(verifySlackSignature(req)).toBe(true);
  });

  it('returns false when SLACK_SIGNING_SECRET is not set', () => {
    const saved = process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_SIGNING_SECRET;

    const rawBody = '{"type":"url_verification","challenge":"abc"}';
    const { timestamp, signature } = generateSlackSignature(rawBody);
    const req = {
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': signature,
      },
      body: Buffer.from(rawBody),
    };
    expect(verifySlackSignature(req)).toBe(false);

    process.env.SLACK_SIGNING_SECRET = saved;
  });

  it('returns false for a bad signature', () => {
    const rawBody = '{"type":"url_verification","challenge":"abc"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const req = {
      headers: {
        'x-slack-request-timestamp': timestamp,
        'x-slack-signature': 'v0=badhash',
      },
      body: Buffer.from(rawBody),
    };
    expect(verifySlackSignature(req)).toBe(false);
  });
});

describe('parseBody() — exported helper', () => {
  const { parseBody } = require('./slack');

  it('parses a Buffer into an object', () => {
    const obj = { type: 'url_verification', challenge: 'test' };
    const buf = Buffer.from(JSON.stringify(obj));
    expect(parseBody(buf)).toEqual(obj);
  });

  it('parses a JSON string into an object', () => {
    const obj = { type: 'event_callback', event: {} };
    expect(parseBody(JSON.stringify(obj))).toEqual(obj);
  });

  it('returns a plain object unchanged', () => {
    const obj = { already: 'parsed' };
    expect(parseBody(obj)).toEqual(obj);
  });

  it('returns empty object for null/undefined', () => {
    expect(parseBody(null)).toEqual({});
    expect(parseBody(undefined)).toEqual({});
  });
});
