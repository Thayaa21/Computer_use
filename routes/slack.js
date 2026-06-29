'use strict';

/**
 * routes/slack.js — Slack Event Handler
 *
 * Exposes two endpoints:
 *   POST /events   — Verifies Slack request signatures, handles URL-verification
 *                    challenges, and dispatches non-bot message events through
 *                    the Intent Classifier + Router.
 *   POST /actions  — Stub for interactive action callbacks (returns 200).
 *
 * IMPORTANT: The Express app MUST register express.raw({ type: '*\/*' })
 * middleware BEFORE mounting this router so that Slack signature verification
 * has access to the raw request body (a Buffer). This handler calls
 * JSON.parse(req.body.toString()) internally when req.body is a Buffer.
 *
 * Requirements: 2.1, 2.2, 9.2, 9.3
 */

const crypto = require('crypto');
const express = require('express');

const claudeChat = require('../services/claudeChat');
const router_service = require('../services/router');

const router = express.Router();

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the X-Slack-Signature header against the raw request body.
 *
 * Slack signs every request using:
 *   signature = "v0=" + HMAC-SHA256( "v0:<timestamp>:<rawBody>", SLACK_SIGNING_SECRET )
 *
 * Requirement 9.2: reject requests whose signature does not match.
 *
 * @param {import('express').Request} req
 * @returns {boolean} true if the signature is valid, false otherwise
 */
function verifySlackSignature(req) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    console.error('[slack] SLACK_SIGNING_SECRET is not set');
    return false;
  }

  const timestamp = req.headers['x-slack-request-timestamp'];
  const slackSignature = req.headers['x-slack-signature'];

  if (!timestamp || !slackSignature) {
    return false;
  }

  // Guard against replay attacks: reject requests older than 5 minutes
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 5 * 60;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return false;
  }

  // The raw body may arrive as a Buffer (when express.raw() is used upstream)
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);

  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(sigBaseString);
  const computedSignature = `v0=${hmac.digest('hex')}`;

  // Use timingSafeEqual to prevent timing-based attacks
  try {
    const a = Buffer.from(computedSignature, 'utf8');
    const b = Buffer.from(slackSignature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Body parser helper
// ---------------------------------------------------------------------------

/**
 * Parse req.body into a plain object.
 *
 * When express.raw() is used the body arrives as a Buffer; otherwise it may
 * already be a parsed object (e.g., during tests).
 *
 * @param {Buffer|object} body
 * @returns {object}
 */
function parseBody(body) {
  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString());
  }
  if (typeof body === 'string') {
    return JSON.parse(body);
  }
  return body || {};
}

// ---------------------------------------------------------------------------
// POST /events
// ---------------------------------------------------------------------------

/**
 * Handle Slack Events API payloads.
 *
 * Flow:
 *  1. Verify request signature → 403 on failure (Requirement 9.2).
 *  2. If type === 'url_verification' → respond with challenge (Requirement 9.3).
 *  3. Acknowledge immediately with 200 to prevent Slack retries (Requirement 2.1).
 *  4. Asynchronously classify + dispatch non-bot message events (Requirement 2.2).
 */
router.post('/events', async (req, res) => {
  // Step 1 — Verify signature
  if (!verifySlackSignature(req)) {
    return res.status(403).send('Forbidden');
  }

  // Parse the body (Buffer → object when raw middleware is active)
  let payload;
  try {
    payload = parseBody(req.body);
  } catch (err) {
    console.error('[slack] Failed to parse request body:', err.message);
    return res.status(400).send('Bad Request');
  }

  // Step 2 — URL verification challenge (Requirement 9.3)
  if (payload.type === 'url_verification') {
    return res.json({ challenge: payload.challenge });
  }

  // Step 3 — Acknowledge immediately (MUST happen before async work)
  res.sendStatus(200);

  // Step 4 — Classify and dispatch non-bot message events (Requirement 2.1, 2.2)
  const event = payload.event;
  if (
    event &&
    event.type === 'message' &&
    !event.bot_id &&
    !event.subtype
  ) {
    try {
      const intent = await claudeChat.classify(event.text);
      await router_service.dispatch(intent, {
        text: event.text,
        threadTs: event.ts,
        channelId: event.channel,
      });
    } catch (err) {
      console.error('[slack] Error dispatching message event:', err.message);
    }
  }
});

// ---------------------------------------------------------------------------
// POST /actions
// ---------------------------------------------------------------------------

/**
 * Handle Slack interactive action callbacks (button clicks, menu selections, etc.).
 *
 * This is a stub that acknowledges every inbound action with 200.
 * Full interactive-action handling can be wired here in a future iteration.
 *
 * Requirement 9.2: endpoint is registered and reachable.
 */
router.post('/actions', (req, res) => {
  // Acknowledge the action immediately; Slack requires a response within 3 s
  res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = router;
// Export helpers for unit testing (task 16.2)
module.exports.verifySlackSignature = verifySlackSignature;
module.exports.parseBody = parseBody;
