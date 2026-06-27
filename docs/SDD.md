# Software Design Document — Remote Dev Assistant

**Version:** 1.0  
**Status:** Draft  
**Date:** June 2026

---

## 1. Introduction

### 1.1 Purpose
This document describes the software design of the Remote Dev Assistant — a system that enables an AFK developer to remotely control their laptop via a phone call and Slack messages, using AI-driven screen automation, voice transcription, and robotic process automation.

### 1.2 Scope
This document covers the backend architecture, component design, data models, API contracts, error handling strategy, and security considerations for the system. It does not cover UiPath Studio workflow design or Slack App configuration steps.

### 1.3 Audience
- Developers implementing the system
- Reviewers assessing technical design decisions
- Teammates building optional feature modules

---

## 2. System Overview

The system accepts two types of inbound events:
1. **Phone call** via Twilio → triggers the Wake Flow
2. **Slack message** → triggers intent classification and action routing

Every control path terminates with a Slack message posted back to the developer. There is no web UI for the developer — Slack is the sole interface.

```
[Phone Call] ──► POST /call ──► Wake Flow ──► Slack (ready message)
[Slack Msg]  ──► POST /slack/events ──► Intent Classifier ──► Router ──► Action ──► Slack (result)
```

---

## 3. Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Developer's Phone                        │
│                   Twilio Call  │  Slack App                     │
└────────────────────────────────┼────────────────────────────────┘
                                 │ webhooks
                    ┌────────────▼────────────┐
                    │    Node.js/Express       │
                    │       Backend            │
                    │  server.js               │
                    └─────┬──────────┬─────────┘
                          │          │
          ┌───────────────▼─┐     ┌──▼──────────────────┐
          │  Computer Use   │     │   Intent Classifier  │
          │  Agent          │     │   Claude Haiku 4.5   │
          │  Claude Sonnet  │     └──────────┬───────────┘
          │  4.6            │               │
          └───────┬─────────┘          ┌────▼──────┐
                  │                    │  Router   │
          ┌───────▼─────────┐          └──┬──┬──┬──┘
          │  Screenshot Util │             │  │  │
          │  Mouse/Keyboard  │       ┌─────┘  │  └──────┐
          └─────────────────┘        │        │         │
                                  File    Computer   UiPath
                                  Read    Use Agent  Robot
                                     │        │         │
                              └───────────────────────────┘
                                          │
                                   ┌──────▼──────┐
                                   │  Slack Bot  │
                                   │  (reply)    │
                                   └─────────────┘
```

### 3.2 Design Principles
- **Linear control flow** — every path enters from one of two entry points and exits via a Slack message
- **Fail loudly to Slack** — every error posts a descriptive message to Slack so the developer always gets feedback
- **Stateless routing** — the Router holds no session state; the Session Manager is the only stateful component
- **Separation of concerns** — screen control, classification, messaging, and automation are fully decoupled services

---

## 4. Component Design

### 4.1 server.js — Application Entry Point

**Responsibilities:**
- Load environment variables via `dotenv`
- Validate all required env vars at startup; exit with descriptive error if any are missing
- Register all Express routes
- Start HTTP listener

**Routes registered:**
| Method | Path | Handler |
|---|---|---|
| POST | `/call` | `routes/call.js` |
| POST | `/call/transcription` | `routes/call.js` |
| POST | `/slack/events` | `routes/slack.js` |
| POST | `/slack/actions` | `routes/slack.js` |
| GET | `/dashboard` | `routes/dashboard.js` (stub) |

**Required environment variables:**
```
ANTHROPIC_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER,
SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_CHANNEL_ID,
UIPATH_BASE_URL, UIPATH_TENANT, UIPATH_CLIENT_ID, UIPATH_CLIENT_SECRET,
UIPATH_TEST_PROCESS_KEY, UIPATH_COMMIT_PROCESS_KEY, PROJECT_DIR
```

---

### 4.2 routes/call.js — Call Handler

**Responsibilities:**
- Respond to Twilio's `POST /call` within 3 seconds with valid TwiML
- Fire the Wake Flow asynchronously (non-blocking)
- Accept transcription from `POST /call/transcription` and route to classifier

**Wake Flow sequence:**
```
1. computerUse.runLoop("Unlock the Mac screen")
2. screenshot.capture()                    // confirm desktop visible
3. projectSnapshot.snapshot(PROJECT_DIR)
4. computerUse.runLoop("Open Slack app")
5. slackBot.postMessage(readyMessage + snapshotSummary)
6. sessionManager.startSession()
```
Any step failure → `slackBot.postError(stepName, err)` → re-throw

**Stub marker (Chetan's feature):**
```javascript
// TODO: [WHISPER STUB] Replace Twilio STT with OpenAI Whisper — non-blocking
```

---

### 4.3 routes/slack.js — Slack Handler

**Responsibilities:**
- Verify Slack request signature using `SLACK_SIGNING_SECRET`
- Handle URL verification challenge
- Acknowledge event with HTTP 200 immediately (before processing)
- Pass non-bot `message` events to the Intent Classifier and Router

**Signature verification:** All requests must have a valid `X-Slack-Signature` header. Invalid requests return `403`.

---

### 4.4 services/claudeChat.js — Intent Classifier

**Model:** `claude-haiku-4-5`  
**Interface:** `classify(text: string): Promise<IntentResult>`

**Output schema:**
```typescript
interface IntentResult {
  intent: 'fetch_file' | 'edit_code' | 'run_tests' | 'commit_code'
        | 'computer_use' | 'end_session' | 'unknown';
  data: {
    filePath?:      string;
    instruction?:   string;
    commitMessage?: string;
  };
}
```

**Error handling:** Any API error or JSON parse failure returns `{ intent: 'unknown', data: {} }` — never throws.

---

### 4.5 services/computerUse.js — Computer Use Agent

**Model:** `claude-sonnet-4-5` (Sonnet 4.6)  
**Interface:** `runLoop(instruction)`, `stopLoop()`, `lockScreen()`

**Agentic loop:**
```
while (iterations < 20 && !stopRequested):
  screenshot ← capture()
  action ← callClaudeSonnet(instruction, screenshot)
  if action.type === 'complete': return { success: true }
  execute(action)
  iterations++
return { success: false, lastScreenshot, iterations }
```

**Tool config for Anthropic API:**
```javascript
{ type: 'computer_20241022', name: 'computer',
  display_width_px: 1920, display_height_px: 1080 }
```

**Supported actions:** `mouse_move`, `left_click`, `double_click`, `type`, `key`, `screenshot`

---

### 4.6 services/slackBot.js — Slack Bot

**Interface:**
- `postMessage(text)` — plain text to channel
- `postFile(filePath, content)` — code block with language hint; truncates at 3000 chars
- `postImage(buffer, message)` — PNG screenshot attachment
- `postError(step, err)` — error message with step name and error details

**Truncation rule:** If `content.length > 3000`, post first 3000 chars and append `_Showing X of Y lines_`.

---

### 4.7 services/uipath.js — UiPath Service

**Interface:** `triggerAndPoll(processKey, inputArgs): Promise<UiPathJobResult>`

**Auth:** OAuth2 client credentials flow against `UIPATH_BASE_URL`

**Job lifecycle:**
```
triggerJob() → jobId
poll every 5s:
  Successful → return { success: true, output }
  Faulted    → return { success: false, error }
  timeout (5 min) → cancelJob() → return { success: false, timedOut: true }
```

**Process keys:**
- `UIPATH_TEST_PROCESS_KEY` — runs `npm test` in `PROJECT_DIR`
- `UIPATH_COMMIT_PROCESS_KEY` — runs `git add . && git commit -m "{message}" && git push`

---

### 4.8 services/router.js — Request Router

**Interface:** `dispatch(intent: IntentResult, context): Promise<void>`

**Dispatch table:**

| Intent | Handler | Action |
|---|---|---|
| `fetch_file` | `fetchFile` | `fs.readFile` → `slackBot.postFile` |
| `edit_code` | `editCode` | `computerUse.runLoop` → `slackBot.postMessage` |
| `run_tests` | `runTests` | `uipath.triggerAndPoll(TEST_KEY)` → `slackBot.postMessage` |
| `commit_code` | `commitCode` | `uipath.triggerAndPoll(COMMIT_KEY, {msg})` → `slackBot.postMessage` |
| `computer_use` | `computerUse` | `computerUse.runLoop` → `slackBot.postImage` |
| `end_session` | `endSession` | `sessionManager.endSession()` → `computerUse.lockScreen()` → `slackBot.postMessage` |
| `unknown` | `unknown` | `slackBot.postMessage("Please clarify...")` |

---

### 4.9 services/sessionManager.js — Session Manager

**Interface:** `startSession(stopToken)`, `endSession()`, `isActive()`

**State:**
```typescript
{ active: boolean, stopToken: (() => void) | null }
```

Single in-memory object. No persistence — session state resets on server restart.

---

### 4.10 utils/screenshot.js

**Interface:** `capture(): Promise<Buffer>`  
**Library:** `screenshot-desktop`  
**Output:** PNG buffer

---

### 4.11 utils/mouseKeyboard.js

**Interface:** `execute(action: ComputerAction): Promise<void>`  
**Library:** `@nut-tree/nut-js`

**Supported action types:**
```javascript
{ type: 'mouse_move',  coordinate: [x, y] }
{ type: 'left_click',  coordinate: [x, y] }
{ type: 'double_click', coordinate: [x, y] }
{ type: 'type',        text: string }
{ type: 'key',         text: string }  // e.g. 'cmd+space'
```

---

### 4.12 utils/projectSnapshot.js

**Interface:** `snapshot(dir: string): Promise<string>`  
**Behavior:** Recursively lists `dir` up to 2 levels deep. Excludes `node_modules/`, `.git/`, hidden files.  
**Output:** Formatted string suitable for Slack message.

---

## 5. Data Models

```typescript
interface IntentResult {
  intent: 'fetch_file' | 'edit_code' | 'run_tests' | 'commit_code'
        | 'computer_use' | 'end_session' | 'unknown';
  data: { filePath?: string; instruction?: string; commitMessage?: string; };
}

interface AgentLoopResult {
  success: boolean;
  lastScreenshot: Buffer;
  iterations: number;       // 0–20
  finalMessage?: string;
}

interface UiPathJobResult {
  success: boolean;
  output?: Record<string, unknown>;
  error?: string;
  timedOut?: boolean;
}

interface SessionState {
  active: boolean;
  stopToken: (() => void) | null;
}
```

---

## 6. Error Handling

| Scenario | Response |
|---|---|
| Wake Flow step throws | `slackBot.postError(stepName, err)`; session not started |
| Intent Classifier API error | Return `unknown` intent; Slack asks for clarification |
| File not found (`fetch_file`) | Slack posts not-found + top-level directory listing |
| Computer Use reaches 20 iterations | Slack posts failure + last screenshot |
| UiPath job fails to start | Slack posts error with rejection reason |
| UiPath job times out (5 min) | Job cancelled; Slack notifies developer |
| Slack signature invalid | HTTP 403; no processing |
| Missing env vars at startup | `process.exit(1)` with list of missing variables |
| `end_session` with no active session | Slack posts "no active session to end" |

All async route handlers wrap in try/catch. All catch blocks guarantee a Slack reply.

---

## 7. Security Considerations

- All secrets loaded exclusively from `.env`; `.env` is git-ignored
- `MAC_PASSWORD` (if used) must never be hardcoded; loaded from env at runtime
- Slack request signatures verified on every inbound event
- Twilio webhooks should be validated using Twilio's request validator in production
- UiPath credentials use OAuth2 client credentials (no username/password)
- Screenshot buffers are held in memory only; never written to disk in production
- The system has full access to the developer's screen — it must only run on a trusted machine

---

## 8. Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | HTTP port (default: 3000) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `TWILIO_ACCOUNT_SID` | Yes | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Yes | Inbound Twilio number |
| `SLACK_BOT_TOKEN` | Yes | Slack bot OAuth token |
| `SLACK_SIGNING_SECRET` | Yes | Slack signing secret |
| `SLACK_CHANNEL_ID` | Yes | Target Slack channel ID |
| `UIPATH_BASE_URL` | Yes | UiPath Orchestrator URL |
| `UIPATH_TENANT` | Yes | UiPath tenant name |
| `UIPATH_CLIENT_ID` | Yes | UiPath OAuth client ID |
| `UIPATH_CLIENT_SECRET` | Yes | UiPath OAuth client secret |
| `UIPATH_TEST_PROCESS_KEY` | Yes | UiPath test runner process key |
| `UIPATH_COMMIT_PROCESS_KEY` | Yes | UiPath git commit process key |
| `PROJECT_DIR` | Yes | Absolute path to project on laptop |

---

## 9. Testing Strategy

### Unit Tests
- Wiring tests for all route handlers (mock all external services)
- Edge cases: file not found, unknown intent, max iterations, UiPath timeout, end session with no active session

### Property-Based Tests (fast-check, 100+ iterations each)
16 properties covering: snapshot completeness, intent classification validity, dispatch exhaustiveness, file content fidelity, truncation correctness, loop termination, commit round-trip, server startup behaviour.

### Integration Tests
- Twilio webhook → TwiML response within 3 seconds
- Voice transcription → classify → dispatch pipeline
- UiPath job trigger → poll → result

### Smoke Tests
- All endpoints return non-5xx on valid requests
- `.gitignore` excludes `.env` and artifacts
- Stub TODO comments present in correct files

---

## 10. Deployment (Development)

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in all values

# 3. Grant macOS permissions (one-time)
# System Settings → Privacy → Accessibility → add Terminal
# System Settings → Privacy → Screen Recording → add Terminal

# 4. Start tunnel
ngrok http 3000
# Copy HTTPS URL

# 5. Configure webhooks
# Twilio: set Voice webhook to https://<ngrok>/call
# Slack: set Event Subscriptions URL to https://<ngrok>/slack/events

# 6. Start server
node server.js
```
