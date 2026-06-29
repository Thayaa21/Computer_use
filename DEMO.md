# Remote Dev Assistant — Demo Guide

## Before the Demo (5 min setup)

```bash
# 1. Start everything
bash start.sh

# 2. In a NEW terminal — start ngrok
ngrok http 3000

# 3. Copy the ngrok https:// URL and update:
#    - Twilio: console.twilio.com → your number → Voice webhook → https://YOUR-URL/call
#    - (Slack events URL was set once and doesn't change unless ngrok URL changes)

# 4. Open the dashboard on your screen
open http://localhost:3000/dashboard

# 5. Reset the demo project to baseline
echo 'const SESSION_TIMEOUT = 30; // minutes' | head -1
# (or just verify auth.js has SESSION_TIMEOUT = 30)
```

---

## Demo Flow

### Step 1 — Lock the laptop
Press **Ctrl+Cmd+Q** to lock the screen.

### Step 2 — Call from your phone
Dial: **+1 (531) 324-5471**
Say: *"I have a bug in the login feature"*
Hang up.

### Step 3 — Watch the laptop
Claude unlocks the Mac → opens Terminal → snapshots the project → opens Slack → posts ready message.

### Step 4 — Control from Slack
Open `#qbotica-service` in Slack and type commands (see below).

---

## Slack Commands Cheat Sheet

### View a file
```
show me the auth file
show me src/auth.js
show me the utils module
```
→ Posts file contents to Slack AND opens VS Code with the file

### Edit code
```
change the session timeout to 60 seconds
change SESSION_TIMEOUT in auth.js from 30 to 60
fix the error message in the login function to say "Invalid username or password"
add a console.log to the login function
```
→ Haiku applies the change, VS Code opens to show the result

### Run tests
```
run the tests
run test suite
check if everything is passing
```
→ Runs npm test in the demo project, posts pass/fail counts

### Commit code
```
commit with message: fix session timeout
save my changes as "update login validation"
push the changes
```
→ git add + commit + push to GitHub, posts the commit hash

### Search the codebase
```
search for SESSION_TIMEOUT
find where login is defined
search for "Invalid credentials"
```
→ grep across project, posts matching lines

### Take a screenshot
```
take a screenshot
show me what's on screen
capture the screen
```
→ Screenshots the current Mac display, posts to Slack

### Open an app
```
open VS Code
open Slack
open Terminal
open Chrome
```
→ Opens the app using AppleScript (instant, no CU needed)

### Browse a URL
```
go to https://github.com/Thayaa21/demo-project and show me
open localhost:3000/dashboard and screenshot it
show me what's on the GitHub page
```
→ Opens Chrome, waits 3 seconds, takes screenshot, posts to Slack

### Send a file from Mac
```
send me the report.pdf from Downloads
get me the file presentation.pdf from Desktop
send the auth.js file from the project
```
→ Finds the file on disk, uploads it directly to Slack

### End session
```
end session
lock the laptop
we're done
close the session
```
→ Locks the Mac screen, posts confirmation

---

## Dashboard
Open **http://localhost:3000/dashboard** — shows every command in real time with timestamps. Keep this visible on a second screen during the demo.

---

## UiPath Maestro
Show **cloud.uipath.com → Maestro** → your "Solution 1" BPMN process. This is the orchestration layer that would manage the process flow in a production deployment.

---

## Demo Reset (between runs)
```bash
# Reset auth.js to baseline
cd /Users/thayaananthan/Desktop/Qbotica/Computer_use/demo-project
git checkout src/auth.js

# Clear the dashboard log
curl -X POST http://localhost:3000/dashboard/clear
```

---

## Stop Everything
```bash
bash stop.sh
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Application error" on call | ngrok is down — restart with `ngrok http 3000`, update Twilio webhook |
| Bot not responding in Slack | ngrok URL changed — update Slack Event Subscriptions Request URL |
| "I didn't understand" | GPT-4o mini is classifying — try rephrasing, check OPENAI_API_KEY in .env |
| VS Code not opening | Run `which code` — if missing, open VS Code → Cmd+Shift+P → "Install 'code' command in PATH" |
| Mac not unlocking | Check MAC_PASSWORD in .env matches your actual password |
| Port 3000 in use | Run `lsof -ti:3000 \| xargs kill -9` |
