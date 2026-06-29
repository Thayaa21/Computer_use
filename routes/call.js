'use strict';

/**
 * routes/call.js
 *
 * Call Handler — Express router mounted at /call.
 *
 * Exposes:
 *   - POST /              — Twilio webhook: respond with TwiML and fire wakeFlow() async.
 *   - POST /transcription — Twilio transcription callback: classify and dispatch.
 *   - wakeFlow()          — Initialization sequence triggered by an inbound Twilio call.
 *     Wakes the laptop, captures a screenshot, snapshots the project directory,
 *     opens Slack, posts a ready message, and starts the session.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 10.1, 10.2, 10.3, 10.4, 11.1, 11.3
 */

require('dotenv').config();

const express        = require('express');
const twilio         = require('twilio');
const { VoiceResponse } = twilio.twiml;
const computerUse    = require('../services/computerUse');
const screenshot     = require('../utils/screenshot');
const projectSnapshot = require('../utils/projectSnapshot');
const slackBot       = require('../services/slackBot');
const sessionManager = require('../services/sessionManager');
const claudeChat     = require('../services/claudeChat');
const serviceRouter  = require('../services/router');
const maestro        = require('../services/maestro');

const router = express.Router();

// ─── Wake Flow ───────────────────────────────────────────────────────────────

/**
 * Execute the GhostDev Wake Flow initialization sequence.
 *
 * Steps (executed in series):
 *   1. Computer Use Agent — wake the laptop (unlock / move mouse if locked/asleep).
 *   2. Screenshot Util   — capture desktop to confirm the wake state.
 *   3. projectSnapshot   — list the configured project directory.
 *   4. Computer Use Agent — open the Slack desktop application.
 *   5. Slack Bot          — post a ready message that includes the snapshot summary.
 *   6. Session Manager    — start the session with computerUse.stopLoop as stop token.
 *
 * Error handling:
 *   Any thrown error is reported to Slack via slackBot.postError(stepName, error)
 *   and then re-thrown so the caller knows the flow failed.
 *
 * @returns {Promise<void>}
 */
async function wakeFlow() {
  // ── Step 1: Wake the laptop ──────────────────────────────────────────────
  try {
    const password = process.env.MAC_PASSWORD || '';
    await computerUse.runLoop(
      `Unlock the Mac screen. If you see a login or lock screen, click on the password field and type the password: ${password} — then press Enter. If the screen is already unlocked, do nothing.`
    );
  } catch (err) {
    await slackBot.postError('Wake laptop', err);
    throw err;
  }

  // ── Step 2: Capture screenshot ───────────────────────────────────────────
  let capturedScreenshot;
  try {
    capturedScreenshot = await screenshot.capture();
  } catch (err) {
    await slackBot.postError('Capture screenshot', err);
    throw err;
  }

  // ── Step 3: Project snapshot ─────────────────────────────────────────────
  let snapshotSummary;
  try {
    snapshotSummary = await projectSnapshot.snapshot(process.env.PROJECT_DIR);
  } catch (err) {
    await slackBot.postError('Project snapshot', err);
    throw err;
  }

  // ── Step 4: Open Slack ───────────────────────────────────────────────────
  try {
    await computerUse.runLoop('Open the Slack desktop application');
  } catch (err) {
    await slackBot.postError('Open Slack', err);
    throw err;
  }

  // ── Step 5: Post ready message with snapshot ─────────────────────────────
  const readyMessage = `GhostDev session ready.\n\n${snapshotSummary}`;
  try {
    await slackBot.postMessage(readyMessage);
  } catch (err) {
    await slackBot.postError('Post ready message', err);
    throw err;
  }

  // ── Step 6: Start session ─────────────────────────────────────────────────
  try {
    sessionManager.startSession(computerUse.stopLoop);
    // Log session start to Maestro
    maestro.logEvent('session_started', { snapshot: snapshotSummary.slice(0, 200) }).catch(() => {});
  } catch (err) {
    await slackBot.postError('Start session', err);
    throw err;
  }
}

// ─── Twilio Webhook Handlers ─────────────────────────────────────────────────

/**
 * POST /
 *
 * Twilio calls this endpoint when an inbound call arrives.
 * Responds immediately with TwiML (within 3 s) so Twilio doesn't time out,
 * then fires wakeFlow() asynchronously (fire-and-forget).
 *
 * Requirements: 1.1, 1.2, 10.4
 */
router.post('/', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say('Remote Dev Assistant session starting. Stand by.');
  // TODO: [WHISPER STUB] Replace Twilio built-in STT with OpenAI Whisper — Chetan's feature (non-blocking)
  twiml.gather({ input: 'speech', action: '/call/transcription', timeout: 30 });
  res.type('text/xml').send(twiml.toString());

  // Fire-and-forget — do not await; errors reported to Slack
  wakeFlow().catch(err => slackBot.postError('Wake Flow', err));
});

/**
 * POST /transcription
 *
 * Twilio calls this endpoint with the speech transcription result.
 * Extracts SpeechResult, classifies the intent via claudeChat, and
 * dispatches to the appropriate service handler via serviceRouter.
 *
 * Requirements: 10.1, 10.2, 10.3
 */
router.post('/transcription', async (req, res) => {
  const text = req.body && req.body.SpeechResult;
  if (text) {
    const intent = await claudeChat.classify(text);
    serviceRouter.dispatch(intent, { text, source: 'voice' });
  }
  res.sendStatus(200);
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = router;
module.exports.wakeFlow = wakeFlow;
