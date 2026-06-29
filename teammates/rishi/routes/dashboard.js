/**
 * routes/dashboard.js
 * GET /dashboard — Live session log for the Remote Dev Assistant demo.
 *
 * Replaces the stub registered in server.js.
 * Reads from services/sessionLog.js and renders a self-refreshing HTML page.
 */

const router = require('express').Router();
const { getEvents, clearEvents } = require('../services/sessionLog');

// ── Optional: POST /dashboard/clear lets you reset the log between demo runs ──
router.post('/clear', (req, res) => {
  clearEvents();
  res.redirect('/dashboard');
});

// ── Main dashboard page ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const events = getEvents();

  // Build the event rows HTML
  const rows = events.length === 0
    ? `<tr class="empty-row">
         <td colspan="3">Waiting for session events…</td>
       </tr>`
    : events.map(e => {
        const time = e.timestamp.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        return `
        <tr>
          <td class="ts">${time}</td>
          <td class="ev">${e.emoji}&nbsp; ${e.label}</td>
          <td class="dt">${escapeHtml(e.details)}</td>
        </tr>`;
      }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- Auto-refresh every 5 seconds during a live demo -->
  <meta http-equiv="refresh" content="5" />
  <title>Remote Dev Assistant — Session Log</title>
  <style>
    /* ── Reset & base ───────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
      min-height: 100vh;
      padding: 0 0 48px;
    }

    /* ── Header ─────────────────────────────────────────────────── */
    header {
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 20px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .header-left h1 {
      font-size: 1.1rem;
      font-weight: 600;
      letter-spacing: 0.03em;
      color: #58a6ff;
    }

    .header-left p {
      font-size: 0.75rem;
      color: #8b949e;
      margin-top: 2px;
    }

    .status-badge {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.78rem;
      color: #3fb950;
      background: #1a2b1e;
      border: 1px solid #2ea04320;
      border-radius: 20px;
      padding: 5px 14px;
    }

    .dot {
      width: 8px; height: 8px;
      background: #3fb950;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.35; }
    }

    /* ── Count bar ──────────────────────────────────────────────── */
    .meta-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 32px;
      font-size: 0.78rem;
      color: #8b949e;
      border-bottom: 1px solid #21262d;
    }

    .meta-bar a {
      color: #f85149;
      text-decoration: none;
      font-size: 0.75rem;
    }

    .meta-bar a:hover { text-decoration: underline; }

    /* ── Table ──────────────────────────────────────────────────── */
    .log-wrap {
      padding: 24px 32px 0;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }

    thead th {
      text-align: left;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #8b949e;
      padding: 0 12px 10px;
      border-bottom: 1px solid #21262d;
    }

    tbody tr {
      border-bottom: 1px solid #161b22;
      transition: background 0.1s;
    }

    tbody tr:hover { background: #161b22; }

    /* Highlight the most recent event */
    tbody tr:last-child {
      background: #1a2332;
      border-left: 3px solid #58a6ff;
    }

    tbody tr:last-child .ts { color: #58a6ff; }

    td {
      padding: 11px 12px;
      vertical-align: middle;
    }

    td.ts {
      color: #8b949e;
      white-space: nowrap;
      width: 90px;
      font-size: 0.8rem;
    }

    td.ev {
      white-space: nowrap;
      width: 180px;
      color: #e6edf3;
      font-weight: 500;
    }

    td.dt {
      color: #c9d1d9;
    }

    tr.empty-row td {
      text-align: center;
      color: #484f58;
      padding: 40px;
      font-size: 0.85rem;
    }

    /* ── Footer ─────────────────────────────────────────────────── */
    footer {
      margin-top: 32px;
      padding: 0 32px;
      font-size: 0.72rem;
      color: #484f58;
    }
  </style>
</head>
<body>

  <header>
    <div class="header-left">
      <h1>🛰 Remote Dev Assistant — Session Log</h1>
      <p>Live event stream from the active developer session</p>
    </div>
    <div class="status-badge">
      <span class="dot"></span>
      Auto-refreshing every 5s
    </div>
  </header>

  <div class="meta-bar">
    <span>${events.length} event${events.length !== 1 ? 's' : ''} logged</span>
    <form method="POST" action="/dashboard/clear" style="display:inline">
      <button type="submit"
        style="background:none;border:none;cursor:pointer;color:#f85149;font-family:inherit;font-size:0.75rem;"
        onclick="return confirm('Clear the session log?')">
        ✕ Clear log
      </button>
    </form>
  </div>

  <div class="log-wrap">
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Event</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>

  <footer>
    Last rendered: ${new Date().toLocaleTimeString()} &nbsp;·&nbsp; Page refreshes automatically
  </footer>

</body>
</html>`;

  res.send(html);
});

// ── Tiny HTML-escape helper (no deps needed) ───────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
