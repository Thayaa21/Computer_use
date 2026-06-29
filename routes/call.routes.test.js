'use strict';

/**
 * routes/call.routes.test.js
 *
 * Wiring tests for the HTTP route handlers in routes/call.js.
 *
 * Tests use supertest to make real HTTP requests against the Express app.
 * All service/utility dependencies are mocked so no real I/O occurs.
 *
 * Assertions:
 *   - POST /call          → TwiML response returned within 3 seconds (Req 1.1, 10.4)
 *   - POST /call          → wakeFlow() is fired asynchronously (fire-and-forget) (Req 1.2)
 *   - POST /call/transcription → SpeechResult forwarded to claudeChat.classify (Req 10.1, 10.2)
 *   - POST /call/transcription → classified intent dispatched via serviceRouter (Req 10.3)
 *
 * Requirements: 1.1, 1.2, 10.1, 10.2, 10.3
 */

// ─── Mock dependencies BEFORE requiring any module under test ─────────────────
// These are the same dependencies used by wakeFlow() and the route handlers.

jest.mock('../services/computerUse');
jest.mock('../utils/screenshot');
jest.mock('../utils/projectSnapshot');
jest.mock('../services/slackBot');
jest.mock('../services/sessionManager');
jest.mock('../services/claudeChat');
jest.mock('../services/router');

const request         = require('supertest');
const app             = require('../server');

const computerUse     = require('../services/computerUse');
const screenshot      = require('../utils/screenshot');
const projectSnapshot = require('../utils/projectSnapshot');
const slackBot        = require('../services/slackBot');
const sessionManager  = require('../services/sessionManager');
const claudeChat      = require('../services/claudeChat');
const serviceRouter   = require('../services/router');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Set up all wakeFlow() dependencies to resolve successfully (happy path).
 * This prevents wakeFlow()'s async work from throwing and polluting other tests.
 */
function setupWakeFlowHappyPath() {
  computerUse.runLoop.mockResolvedValue({ success: true, iterations: 1, lastScreenshot: Buffer.from('') });
  computerUse.stopLoop.mockImplementation(() => {});
  screenshot.capture.mockResolvedValue(Buffer.from('png'));
  projectSnapshot.snapshot.mockResolvedValue('Project snapshot text');
  slackBot.postMessage.mockResolvedValue(undefined);
  slackBot.postError.mockResolvedValue(undefined);
  sessionManager.startSession.mockImplementation(() => {});
}

beforeEach(() => {
  jest.clearAllMocks();
  // Ensure PROJECT_DIR is set — wakeFlow() calls projectSnapshot.snapshot(process.env.PROJECT_DIR)
  process.env.PROJECT_DIR = '/project';
});

// ─── POST /call — TwiML Response ─────────────────────────────────────────────

describe('POST /call — TwiML webhook handler', () => {
  /**
   * Req 1.1, 10.4: The handler must respond with TwiML within 3 seconds,
   * regardless of how long wakeFlow() takes.
   */
  it('responds with TwiML (text/xml) within 3 seconds', async () => {
    setupWakeFlowHappyPath();

    const start = Date.now();
    const res = await request(app)
      .post('/call')
      .set('Content-Type', 'application/json')
      .send({});
    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/xml/);
    expect(elapsed).toBeLessThan(3000);
  });

  it('TwiML response contains a <Response> root element', async () => {
    setupWakeFlowHappyPath();

    const res = await request(app)
      .post('/call')
      .send({});

    expect(res.text).toMatch(/<Response>/);
    expect(res.text).toMatch(/<\/Response>/);
  });

  it('TwiML response contains a <Say> element with session start message', async () => {
    setupWakeFlowHappyPath();

    const res = await request(app)
      .post('/call')
      .send({});

    expect(res.text).toMatch(/<Say>/);
  });

  it('TwiML response contains a <Gather> element for speech input', async () => {
    setupWakeFlowHappyPath();

    const res = await request(app)
      .post('/call')
      .send({});

    // <Gather input="speech" action="/call/transcription" ...>
    expect(res.text).toMatch(/<Gather /);
    expect(res.text).toContain('speech');
    expect(res.text).toContain('/call/transcription');
  });

  /**
   * Req 1.2: wakeFlow() is fired asynchronously (fire-and-forget).
   * The HTTP response is sent BEFORE wakeFlow() completes.
   * Verified by: response arrives before all wakeFlow steps finish,
   * AND the async work starts (computerUse.runLoop is eventually called).
   */
  it('fires wakeFlow() asynchronously — response arrives before wakeFlow completes', async () => {
    let wakeFlowStarted = false;
    let resolveWake;

    // Make the first step of wakeFlow (wake laptop) take a long time.
    // This means if the response waited for wakeFlow, the test would be very slow.
    computerUse.runLoop.mockImplementation(() => {
      wakeFlowStarted = true;
      return new Promise(resolve => {
        resolveWake = resolve;
        // Do NOT auto-resolve — response must arrive before this resolves.
      });
    });
    screenshot.capture.mockResolvedValue(Buffer.from(''));
    projectSnapshot.snapshot.mockResolvedValue('snap');
    slackBot.postMessage.mockResolvedValue(undefined);
    slackBot.postError.mockResolvedValue(undefined);
    sessionManager.startSession.mockImplementation(() => {});

    const start = Date.now();

    // The request should complete well before the 3-second mark even though
    // wakeFlow's first step is hanging (never resolving in this test).
    const res = await request(app)
      .post('/call')
      .send({})
      .timeout(3000);

    const elapsed = Date.now() - start;

    expect(res.status).toBe(200);
    // Response arrived quickly — wakeFlow's blocking step did NOT delay it
    expect(elapsed).toBeLessThan(3000);

    // Give the event loop a tick to let the fire-and-forget start
    await new Promise(resolve => setImmediate(resolve));
    expect(wakeFlowStarted).toBe(true);

    // Clean up: resolve the hanging promise so the async chain settles
    if (resolveWake) resolveWake({ success: true, iterations: 1, lastScreenshot: Buffer.from('') });
    // Wait for the dangling promise chain to flush
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  /**
   * Req 1.2: If wakeFlow() rejects, the error is caught and reported to
   * Slack (postError) — it does NOT crash the process or affect the response.
   */
  it('catches wakeFlow() errors and reports them to Slack without crashing', async () => {
    const wakeError = new Error('wake failed');

    // wakeFlow's first step throws immediately
    computerUse.runLoop.mockRejectedValue(wakeError);
    slackBot.postError.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/call')
      .send({});

    expect(res.status).toBe(200);
    // Give the fire-and-forget chain a moment to settle
    await new Promise(resolve => setTimeout(resolve, 20));
    // postError should have been called (by wakeFlow's error handler AND the outer .catch)
    expect(slackBot.postError).toHaveBeenCalled();
  });
});

// ─── POST /call/transcription — Transcription Handler ────────────────────────

describe('POST /call/transcription — transcription webhook handler', () => {
  /**
   * Req 10.1: SpeechResult from the Twilio request body is extracted.
   * Req 10.2: SpeechResult is passed to claudeChat.classify().
   */
  it('forwards SpeechResult to claudeChat.classify()', async () => {
    const speechText = 'fetch the README file';
    const mockIntent = { intent: 'fetch_file', data: { path: 'README.md' } };

    claudeChat.classify.mockResolvedValue(mockIntent);
    serviceRouter.dispatch.mockResolvedValue(undefined);

    await request(app)
      .post('/call/transcription')
      .send({ SpeechResult: speechText })
      .set('Content-Type', 'application/json');

    expect(claudeChat.classify).toHaveBeenCalledTimes(1);
    expect(claudeChat.classify).toHaveBeenCalledWith(speechText);
  });

  /**
   * Req 10.3: Classified intent is dispatched via serviceRouter.dispatch()
   * with the transcribed text and source: 'voice'.
   */
  it('dispatches the classified intent via serviceRouter.dispatch() with voice context', async () => {
    const speechText = 'run the tests';
    const mockIntent = { intent: 'run_tests', data: {} };

    claudeChat.classify.mockResolvedValue(mockIntent);
    serviceRouter.dispatch.mockResolvedValue(undefined);

    await request(app)
      .post('/call/transcription')
      .send({ SpeechResult: speechText })
      .set('Content-Type', 'application/json');

    expect(serviceRouter.dispatch).toHaveBeenCalledTimes(1);
    expect(serviceRouter.dispatch).toHaveBeenCalledWith(mockIntent, {
      text: speechText,
      source: 'voice',
    });
  });

  it('responds with 200 status after processing transcription', async () => {
    claudeChat.classify.mockResolvedValue({ intent: 'unknown', data: {} });
    serviceRouter.dispatch.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/call/transcription')
      .send({ SpeechResult: 'do something' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
  });

  /**
   * Edge case: no SpeechResult in the body — should NOT call classify or dispatch.
   */
  it('does not call classify or dispatch when SpeechResult is absent', async () => {
    const res = await request(app)
      .post('/call/transcription')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(claudeChat.classify).not.toHaveBeenCalled();
    expect(serviceRouter.dispatch).not.toHaveBeenCalled();
  });

  /**
   * Edge case: empty string SpeechResult — falsy, should not classify.
   */
  it('does not call classify when SpeechResult is an empty string', async () => {
    const res = await request(app)
      .post('/call/transcription')
      .send({ SpeechResult: '' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(claudeChat.classify).not.toHaveBeenCalled();
  });

  /**
   * Verify the full chain: SpeechResult → classify → dispatch is end-to-end correct.
   * Different intents should be dispatched as-is (no transformation).
   */
  it.each([
    ['fetch the file src/index.js', { intent: 'fetch_file', data: { path: 'src/index.js' } }],
    ['edit the main module', { intent: 'edit_code', data: { instruction: 'edit main' } }],
    ['commit my changes', { intent: 'commit_code', data: { message: 'update code' } }],
    ['end the session', { intent: 'end_session', data: {} }],
  ])('classify → dispatch chain works for: "%s"', async (speechText, mockIntent) => {
    claudeChat.classify.mockResolvedValue(mockIntent);
    serviceRouter.dispatch.mockResolvedValue(undefined);

    await request(app)
      .post('/call/transcription')
      .send({ SpeechResult: speechText })
      .set('Content-Type', 'application/json');

    expect(claudeChat.classify).toHaveBeenCalledWith(speechText);
    expect(serviceRouter.dispatch).toHaveBeenCalledWith(mockIntent, {
      text: speechText,
      source: 'voice',
    });
  });
});
