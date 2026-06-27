# Rishi's Feature: Web Dashboard (Session Log)

## What This Is

The Remote Dev Assistant lets a developer call a phone number while AFK, and their laptop wakes up, opens Slack, and they control everything from their phone. The full session log (files fetched, edits made, tests run, commits pushed) lives in the Slack thread.

Your job is to build a simple web dashboard that shows the same session log as a webpage — useful for a CEO demo where you want a visible "mission control" screen in the background.

---

## Your Task (Task 13 in the project)

**This is non-blocking** — the core system works perfectly without your dashboard. It's a nice-to-have visual layer.

### What to implement

Create `routes/dashboard.js` (the stub is already registered in `server.js`):

```javascript
// TODO: [DASHBOARD STUB] Rishi's session log web dashboard — non-blocking
const router = require('express').Router();
router.get('/', (req, res) => res.send('Dashboard coming soon.'));
module.exports = router;
```

Replace the stub with a real dashboard:

1. **Session log store** — Maintain an in-memory array of session events (or read from a simple JSON file). Each event has: `timestamp`, `type` (wake, fetch_file, edit_code, run_tests, commit_code, end_session), `details` (file name, result, etc.)

2. **Log events from the router** — In `services/router.js`, after each action completes, call a `logEvent(type, details)` function that appends to the store. The main developer will add a hook for this — just define the interface and they'll wire it in.

3. **Serve the dashboard** — `GET /dashboard` returns an HTML page showing the log. Keep it simple: a table or list with timestamps, event types, and details. No frontend framework needed — plain HTML + a tiny bit of inline CSS is fine.

4. **Auto-refresh** — Add `<meta http-equiv="refresh" content="5">` so it updates every 5 seconds during a live demo.

### What the HTML should show

```
Remote Dev Assistant — Session Log

[10:42:01]  🔓 Wake Flow started
[10:42:15]  ✅ Laptop unlocked, Slack opened
[10:42:16]  👋 Session ready — developer notified
[10:43:02]  📄 File fetched: auth/login.js
[10:44:10]  ✏️  Edit applied: login.js — timeout changed to 60
[10:45:33]  🧪 Tests run — 14 passed, 0 failed
[10:46:01]  📦 Committed: "fix login timeout" → abc1234
[10:46:45]  🔒 Session ended — screen locked
```

---

## File to create

`routes/dashboard.js` — this is your only file.

You may also create:
- `services/sessionLog.js` — optional helper module for the in-memory log store

---

## What NOT to touch

- `server.js` (the route `GET /dashboard` is already registered there — don't change it)
- Anything in `services/` except optionally adding `sessionLog.js`
- `routes/call.js`, `routes/slack.js`
- Anything in `utils/`

---

## How to test your dashboard

1. Start the server: `node server.js`
2. Open `http://localhost:3000/dashboard` in a browser
3. For the demo, open it on a second screen so the audience can see events appear in real time

---

## Tech stack

- Plain Node.js / Express — already installed
- No new npm packages needed
- Plain HTML string returned from the route handler (or a simple `res.sendFile` if you want a `.html` file)

---

## Resources

- [Express res.send()](https://expressjs.com/en/api.html#res.send)
- Ask the main developer for the `.env` file if you need to run the server locally
