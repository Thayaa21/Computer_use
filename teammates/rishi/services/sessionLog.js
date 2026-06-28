/**
 * sessionLog.js
 * In-memory session event store for the Remote Dev Assistant dashboard.
 *
 * INTERFACE (for the main developer to wire into services/router.js):
 *
 *   const { logEvent } = require('./sessionLog');
 *
 *   logEvent('wake',         { details: 'Wake flow started' });
 *   logEvent('fetch_file',   { details: 'auth/login.js' });
 *   logEvent('edit_code',    { details: 'login.js — timeout changed to 60' });
 *   logEvent('run_tests',    { details: '14 passed, 0 failed' });
 *   logEvent('commit_code',  { details: '"fix login timeout" → abc1234' });
 *   logEvent('end_session',  { details: 'Screen locked' });
 */

const events = [];

// Event type metadata — emoji + label used by the dashboard renderer
const EVENT_META = {
  wake:        { emoji: '🔓', label: 'Wake Flow'    },
  fetch_file:  { emoji: '📄', label: 'File Fetched' },
  edit_code:   { emoji: '✏️',  label: 'Edit Applied' },
  run_tests:   { emoji: '🧪', label: 'Tests Run'    },
  commit_code: { emoji: '📦', label: 'Committed'    },
  end_session: { emoji: '🔒', label: 'Session Ended'},
  info:        { emoji: 'ℹ️',  label: 'Info'         },
};

/**
 * Append a new event to the session log.
 *
 * @param {string} type    - One of the EVENT_META keys (or any string for ad-hoc events)
 * @param {string} details - Human-readable description of what happened
 */
function logEvent(type, details = '') {
  const meta = EVENT_META[type] || { emoji: '📌', label: type };
  events.push({
    id:        events.length + 1,
    timestamp: new Date(),
    type,
    emoji:     meta.emoji,
    label:     meta.label,
    details,
  });
}

/**
 * Return a copy of all logged events (newest last).
 */
function getEvents() {
  return [...events];
}

/**
 * Clear the log (useful between demo runs).
 */
function clearEvents() {
  events.length = 0;
}

module.exports = { logEvent, getEvents, clearEvents, EVENT_META };
