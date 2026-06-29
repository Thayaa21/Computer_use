'use strict';

/**
 * server.js
 *
 * Express application entry point for GhostDev.
 *
 * Responsibilities:
 *   - Load .env via dotenv.
 *   - Validate all required environment variables; exit with a descriptive
 *     error message if any are missing.
 *   - Register Express routes:
 *       POST /call/*       → routes/call.js    (express.json body parser)
 *       POST /slack/*      → routes/slack.js   (express.raw for signature verification)
 *       GET  /dashboard    → routes/dashboard.js
 *   - Start listening on process.env.PORT ?? 3000.
 *   - Export `app` for use in tests.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.5, 9.6
 */

require('dotenv').config();

const express   = require('express');
const callRouter      = require('./routes/call');
const slackRouter     = require('./routes/slack');
const dashboardRouter = require('./routes/dashboard');

// ─── Required Environment Variables ─────────────────────────────────────────

const REQUIRED_ENV = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_CHANNEL_ID',
  'ANTHROPIC_API_KEY',
  'UIPATH_BASE_URL',
  'UIPATH_ORG',
  'UIPATH_TENANT',
  'UIPATH_CLIENT_ID',
  'UIPATH_CLIENT_SECRET',
  'PROJECT_DIR',
];

/**
 * Validate that all required environment variables are present.
 * Exits the process with a descriptive error message if any are missing.
 */
function validateEnv() {
  const missing = REQUIRED_ENV.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(
      `GhostDev startup error: missing required environment variables:\n  ${missing.join('\n  ')}`
    );
    process.exit(1);
  }
}

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();

// Request logger — shows every incoming request in the terminal
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Mount /call — handle both JSON and Twilio's form-encoded webhooks
app.use('/call', express.urlencoded({ extended: false }), express.json(), callRouter);

// Mount /slack with raw body parsing — required so the Slack SDK can verify
// the HMAC-SHA256 request signature against the raw bytes.
app.use('/slack', express.raw({ type: '*/*' }), slackRouter);

// Mount dashboard stub
app.use('/dashboard', dashboardRouter);

// ─── Start Server ─────────────────────────────────────────────────────────────

/* istanbul ignore next */
if (require.main === module) {
  validateEnv();
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => {
    console.log(`GhostDev listening on port ${PORT}`);
  });
}

// Keep the process alive on unhandled errors — never crash on background task failures
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.message || reason);
});

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = app;
module.exports.validateEnv = validateEnv;
module.exports.REQUIRED_ENV = REQUIRED_ENV;
