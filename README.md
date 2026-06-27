# Remote Dev Assistant

A system that lets a developer who is AFK (away from their laptop) call a phone number, have their laptop wake up automatically, and then control everything — fetching files, editing code, running tests, committing — entirely from Slack on their phone. Never touching the laptop.

---

## The Demo in One Sentence

Developer is at dinner. They call a number. Their laptop unlocks, opens Slack, and posts "Ready — here's your project." Developer types commands in Slack. Laptop executes them. Bug fixed. Laptop locks. Done.

---

## How It Works

```
[Developer Phone]
       |
       | calls Twilio number
       ▼
[Twilio] — transcribes voice → POST /call webhook
       |
       ▼
[Node.js Backend]
       |
       |──► [Claude Computer Use (Sonnet 4.6)]
       |         Unlocks Mac, opens Terminal
       |         Snapshots project directory
       |         Opens Slack, posts ready message
       |
       ▼
[Developer types in Slack from phone]
       |
       ▼
[Claude Haiku 4.5] — classifies intent
       |
       ├── "show me login.js"     → reads file → posts to Slack
       ├── "change timeout to 60" → Computer Use edits file in VS Code
       ├── "run tests"            → UiPath Robot runs test suite → posts results
       ├── "commit this"          → UiPath Robot git commits → posts hash
       └── "end session"         → locks screen → session over
```

---

## Tech Stack

| Layer | Tool |
|---|---|
| Phone call receiver | Twilio |
| Backend server | Node.js + Express |
| Intent classification | Claude Haiku 4.5 (Anthropic API) |
| Screen control | Claude Computer Use — Sonnet 4.6 (Anthropic API) |
| Test & commit automation | UiPath Robot |
| Orchestration | UiPath Maestro |
| Mobile interface | Slack Bot |
| Dev tunneling | ngrok |

---

## Project Structure

```
remote-dev-assistant/
├── server.js                  # Express app, route registration, env validation
├── .env                       # Secrets — never commit this
├── .env.example               # Template for required env vars
├── .gitignore
├── package.json
├── routes/
│   ├── call.js                # POST /call — Twilio webhook + Wake Flow
│   ├── slack.js               # POST /slack/events — Slack message handler
│   └── dashboard.js           # GET /dashboard — session log UI (Rishi's feature)
├── services/
│   ├── claudeChat.js          # Intent classifier (Claude Haiku 4.5)
│   ├── computerUse.js         # Agentic screen control loop (Claude Sonnet 4.6)
│   ├── slackBot.js            # Slack Web API wrapper
│   ├── uipath.js              # UiPath Orchestrator API client
│   ├── router.js              # Intent → service dispatch
│   └── sessionManager.js      # Active session state
└── utils/
    ├── screenshot.js           # Mac screen capture
    ├── mouseKeyboard.js        # Mouse/keyboard simulation
    └── projectSnapshot.js      # Project directory listing
```

---

## Quickstart

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Fill in your values
```

Required variables:

```
ANTHROPIC_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_CHANNEL_ID=
UIPATH_BASE_URL=
UIPATH_TENANT=
UIPATH_CLIENT_ID=
UIPATH_CLIENT_SECRET=
UIPATH_TEST_PROCESS_KEY=
UIPATH_COMMIT_PROCESS_KEY=
PROJECT_DIR=
```

### 3. Mac permissions (one-time setup)

System Settings → Privacy & Security → **Accessibility** → add Terminal  
System Settings → Privacy & Security → **Screen Recording** → add Terminal

### 4. Start ngrok

```bash
ngrok http 3000
```

Copy the `https://` URL. Set it as:
- Twilio webhook: `https://your-url/call`
- Slack Event Subscriptions URL: `https://your-url/slack/events`

### 5. Run the server

```bash
node server.js
```

---

## Running Tests

```bash
npm test
```

Property-based tests use `fast-check` (100+ iterations each). Unit tests cover wiring, edge cases, and integration paths.

---

## Demo Script (CEO Presentation)

**Setup:**
- Mac laptop locked (screen saver on)
- Slack closed
- VS Code project on the machine
- Twilio number live
- ngrok running
- Server running

**Live demo steps:**
1. Hold up phone — "I'm away from my desk. There's a bug in the login feature."
2. Dial the Twilio number, say: *"I have a problem with the login feature"*
3. Point to laptop screen — audience watches Claude unlock the Mac, open Terminal, scan the directory, open Slack, post the ready message
4. Pick up phone, show the Slack notification
5. Type: `"Show me anything related to auth"` → Claude fetches the file, posts it in Slack
6. Type: `"Change the timeout on line 47 to 60"` → Claude opens VS Code, finds the file, makes the change
7. Type: `"Run tests"` → UiPath Robot runs the suite, posts results
8. Say: *"That's it. Bug fixed. Never touched my laptop."*

---


## Cost Estimate

| Service | Cost |
|---|---|
| Anthropic API | ~$10–20 (testing + demo) |
| Twilio phone number | $1.15/month |
| Twilio call minutes | ~$0.50 (all testing) |
| Everything else | Free |
| **Total** | **~$15–20** |
