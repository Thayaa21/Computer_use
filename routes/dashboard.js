// TODO: [DASHBOARD STUB] Rishi's session log web dashboard — non-blocking
'use strict';

const router  = require('express').Router();
const maestro = require('../services/maestro');

const EMOJI = {
  session_started: '🔓',
  fetch_file:      '📄',
  send_file:       '📎',
  edit_code:       '✏️',
  run_tests:       '🧪',
  commit_code:     '📦',
  take_screenshot: '📸',
  open_app:        '🖥️',
  open_url:        '🌐',
  browse_url:      '🌐',
  search_code:     '🔍',
  computer_use:    '🤖',
  end_session:     '🔒',
  unknown:         '❓',
};

router.get('/', (req, res) => {
  const log = maestro.getSessionLog();

  const rows = log.length === 0
    ? '<tr><td colspan="3" style="text-align:center;color:#888">No events yet — start a session by calling the Twilio number.</td></tr>'
    : log.map(e => {
        const emoji = EMOJI[e.type] || '•';
        const time  = new Date(e.timestamp).toLocaleTimeString();
        const detail = Object.entries(e.details || {})
          .map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`)
          .join(' | ') || '—';
        return `<tr>
          <td style="color:#888;white-space:nowrap">${time}</td>
          <td>${emoji} <strong>${e.type}</strong></td>
          <td style="color:#ccc;font-size:13px">${detail}</td>
        </tr>`;
      }).join('');

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="5">
  <title>Remote Dev Assistant — Session Log</title>
  <style>
    body { background: #1a1a1a; color: #e0e0e0; font-family: -apple-system, sans-serif; padding: 32px; }
    h1   { font-size: 20px; margin-bottom: 4px; }
    p    { color: #888; font-size: 13px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th   { text-align: left; padding: 8px 12px; border-bottom: 1px solid #333; color: #888; font-size: 12px; text-transform: uppercase; }
    td   { padding: 10px 12px; border-bottom: 1px solid #222; vertical-align: top; }
    tr:hover td { background: #222; }
  </style>
</head>
<body>
  <h1>🤖 Remote Dev Assistant — Session Log</h1>
  <p>Auto-refreshes every 5 seconds &nbsp;·&nbsp; ${log.length} event${log.length !== 1 ? 's' : ''}</p>
  <table>
    <thead><tr><th>Time</th><th>Event</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`);
});

module.exports = router;
