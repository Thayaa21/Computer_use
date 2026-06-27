# Remote Dev Assistant

A system that lets a developer who is away from their laptop call a phone number, have their laptop wake up automatically, and control everything remotely — fetching files, editing code, running tests, and committing — entirely through Slack on their phone.

---

## How It Works

1. Developer calls a Twilio phone number and describes the issue
2. The laptop wakes up, unlocks, and snapshots the project directory
3. A Slack message is posted with the directory tree and a ready prompt
4. Developer types commands in Slack from their phone
5. Each message is classified by AI and routed to the right action:
   - **Show me a file** → file contents posted to Slack
   - **Edit code** → AI opens VS Code and makes the change
   - **Run tests** → test suite runs, results posted to Slack
   - **Commit** → git commit and push, hash posted to Slack
   - **End session** → laptop locks

---

## Tech Stack

| Layer | Tool |
|---|---|
| Phone call & transcription | Twilio |
| Backend | Node.js + Express |
| Intent classification | Claude Haiku 4.5 |
| Screen control | Claude Computer Use (Sonnet 4.6) |
| Test & commit automation | UiPath Robot |
| Orchestration | UiPath Maestro |
| Mobile interface | Slack Bot |

---

## Quickstart

```bash
npm install
cp .env.example .env   # fill in your credentials
node server.js
```

Required environment variables: `ANTHROPIC_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_CHANNEL_ID`, `UIPATH_BASE_URL`, `UIPATH_TENANT`, `UIPATH_CLIENT_ID`, `UIPATH_CLIENT_SECRET`, `UIPATH_TEST_PROCESS_KEY`, `UIPATH_COMMIT_PROCESS_KEY`, `PROJECT_DIR`

**One-time macOS setup:**  
System Settings → Privacy & Security → Accessibility → add Terminal  
System Settings → Privacy & Security → Screen Recording → add Terminal

**For local development**, expose the server with ngrok:
```bash
ngrok http 3000
```
Set the ngrok URL as the Twilio voice webhook and Slack event subscription URL.
