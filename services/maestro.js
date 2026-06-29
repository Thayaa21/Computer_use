'use strict';

/**
 * services/maestro.js — UiPath Maestro Integration
 *
 * Logs every Remote Dev Assistant action to UiPath Maestro as a process
 * execution event. This gives the Maestro dashboard a full audit trail
 * of what happened during a session — which commands were run, when, and
 * what the outcome was.
 *
 * The integration uses the UiPath Orchestrator Jobs API to trigger a
 * lightweight "logger" process in Maestro for each event.
 *
 * All errors are swallowed — Maestro logging is fire-and-forget.
 * It must never block or crash the main flow.
 */

require('dotenv').config();

// Use Rishi's sessionLog for the dashboard events
const sessionLog = require('./sessionLog');

// ─── Event type → Rishi's sessionLog type mapping ────────────────────────────
const EVENT_TYPE_MAP = {
  session_started: 'wake',
  fetch_file:      'fetch_file',
  send_file:       'fetch_file',
  edit_code:       'edit_code',
  run_tests:       'run_tests',
  commit_code:     'commit_code',
  end_session:     'end_session',
};

/**
 * Log an event to Rishi's session log dashboard and (if configured) to UiPath Maestro.
 */
async function logEvent(eventType, details = {}) {
  const mappedType = EVENT_TYPE_MAP[eventType] || 'info';
  const detailStr = typeof details === 'string' ? details : Object.values(details).join(' | ').slice(0, 100);

  // Log to Rishi's dashboard
  sessionLog.logEvent(mappedType, detailStr);
  console.log(`[Maestro] ${new Date().toISOString()} — ${eventType}`, details);

  // Fire-and-forget to UiPath Maestro cloud if credentials set
  if (process.env.UIPATH_BASE_URL && process.env.UIPATH_CLIENT_ID && process.env.UIPATH_MAESTRO_PROCESS_KEY) {
    notifyMaestro({ timestamp: new Date().toISOString(), type: eventType, details }).catch(err => {
      console.error('[Maestro] Failed to log to UiPath:', err.message);
    });
  }
}

// ─── UiPath Maestro API ───────────────────────────────────────────────────────

let _cachedToken = null;
let _tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpiresAt - 30_000) return _cachedToken;

  const tokenUrl = `${process.env.UIPATH_BASE_URL}/identity_/connect/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.UIPATH_CLIENT_ID,
    client_secret: process.env.UIPATH_CLIENT_SECRET,
    scope: 'OR.Jobs',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) throw new Error(`Token request failed [${response.status}]`);

  const data = await response.json();
  _cachedToken = data.access_token;
  _tokenExpiresAt = now + (data.expires_in ?? 3600) * 1000;
  return _cachedToken;
}

async function notifyMaestro(entry) {
  const token = await getAccessToken();
  const org    = process.env.UIPATH_ORG;
  const tenant = process.env.UIPATH_TENANT;
  const base   = process.env.UIPATH_BASE_URL;

  const url = `${base}/${org}/${tenant}/orchestrator_/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs`;

  const payload = {
    startInfo: {
      ReleaseKey: process.env.UIPATH_MAESTRO_PROCESS_KEY,
      RobotIds: [],
      NoOfRobots: 0,
      Source: 'Manual',
      InputArguments: JSON.stringify({
        eventType: entry.type,
        timestamp: entry.timestamp,
        details: JSON.stringify(entry.details),
      }),
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-UIPATH-TenantName': tenant,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Maestro job start failed [${response.status}]: ${text}`);
  }
}

module.exports = { logEvent };
