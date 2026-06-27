# What We Are Building

## The Problem

Developers get interrupted. A bug is reported. A teammate needs a code review. A deployment breaks. But the developer is at dinner, commuting, or away from their desk. Their options are:

- SSH into their machine (requires it to be awake and accessible)
- VPN + remote desktop (slow, clunky on a phone)
- Wait until they get back to their laptop

None of these work well from a phone. None of them feel natural. And all of them assume the machine is already awake and set up.

---

## The Solution

A system where the developer's laptop **wakes itself up** when called, and then the developer controls it entirely through Slack — from their phone, in natural language, without ever touching the laptop.

### The flow

1. Developer is AFK. An issue comes up.
2. They call a phone number.
3. Their laptop wakes up, unlocks, scans the project directory, opens Slack, and posts: *"Ready. Here's your project. What do you need?"*
4. Developer opens Slack on their phone and types: *"Show me the auth module"*
5. The system reads the file and posts it in Slack.
6. Developer types: *"Change the session timeout on line 47 to 60 seconds"*
7. The system opens VS Code, finds the file, makes the change.
8. Developer types: *"Run tests"*
9. Tests run. Results posted to Slack.
10. Developer types: *"Commit this — fix session timeout"*
11. Git commit pushed. Commit hash posted to Slack.
12. Developer types: *"End session"*
13. Laptop locks. Done.

The developer never touched their laptop.

---

## What Each Part Does

### Phone Call (Twilio)
The entry point. Developer calls a number. Twilio receives the call, transcribes what they say, and fires a webhook to the backend. This is what wakes everything up.

### Backend (Node.js + Express)
The brain. Receives webhooks from Twilio and Slack. Coordinates all other services. Decides what to do with each incoming message.

### Screen Control (Claude Computer Use — Sonnet 4.6)
The hands. An AI that looks at a screenshot of the screen and decides what to click, type, or press. Used to:
- Unlock the Mac
- Open Terminal and scan the project directory
- Open Slack
- Open VS Code and edit files

It runs in a loop: take screenshot → decide action → execute action → repeat until done.

### Intent Classification (Claude Haiku 4.5)
The interpreter. Every Slack message from the developer is sent to Claude Haiku, which classifies it into one of seven actions:
- `fetch_file` — show me a file
- `edit_code` — change something in the code
- `run_tests` — run the test suite
- `commit_code` — commit and push
- `computer_use` — freeform screen instruction
- `end_session` — lock the laptop and end the session
- `unknown` — ask for clarification

### Test & Commit Automation (UiPath Robot)
The executor for deterministic tasks. Running tests and committing to git are reliable, repeatable operations — UiPath Robot handles these via terminal commands. Results are returned to the backend and posted to Slack.

### Orchestration (UiPath Maestro)
The coordinator. Manages the process flow: waiting for human input, routing to the right actor, tracking state. Adds enterprise-grade process management to the system.

### Slack Bot
The interface. Everything the developer sees and types goes through Slack. The bot posts the ready message, file contents, test results, confirmations, and error messages. The developer never needs to use a browser or a laptop — just Slack on their phone.

---

## What We Are NOT Building

- A general-purpose remote desktop replacement
- A production-grade security system
- A multi-user or multi-machine system
- A mobile app

This is a focused, demo-ready prototype that proves the core concept: **an AFK developer can fix a bug and commit it without ever touching their laptop.**

---

## Team Breakdown

### Core system (main developer)
Everything that makes the demo work:
- Node.js backend (`server.js`, all routes, all services)
- Claude Computer Use agentic loop
- Intent classification and routing
- Slack bot integration
- UiPath API integration
- Wake Flow (unlock → snapshot → open Slack → post ready message)

### Voice Enhancement — Chetan (`teammates/chetan/`)
Optional upgrade: replace Twilio's built-in speech-to-text with OpenAI Whisper for higher transcription accuracy. The system works without this — it's a quality improvement. Chetan's task is isolated to `routes/call.js`.

### Web Dashboard — Rishi (`teammates/rishi/`)
Optional feature: a simple webpage showing the live session log — files fetched, edits made, tests run, commits pushed. Useful as a "mission control" screen during a CEO demo. Rishi's task is isolated to `routes/dashboard.js`.

---

## Success Criteria

The project is complete when a live demo can show:

1. Developer calls the Twilio number and speaks a command
2. Laptop unlocks and opens Slack (audience watches this happen)
3. Developer types a file request in Slack → file appears in Slack
4. Developer types an edit instruction → VS Code opens and makes the change (audience watches)
5. Developer types "run tests" → test results appear in Slack
6. Developer types "commit this" → commit is pushed, hash appears in Slack
7. Developer says "End session" → laptop locks

**Total time for the demo: under 3 minutes.**
