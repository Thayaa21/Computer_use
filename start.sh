#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Remote Dev Assistant — START
# Run this once before the demo. Keep both terminals open.
# ─────────────────────────────────────────────────────────────

PROJECT_DIR="/Users/thayaananthan/Desktop/Qbotica/Computer_use"

echo ""
echo "🚀 Starting Remote Dev Assistant..."
echo ""

# 1. Kill anything on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null

# 2. Start Node server in background, log to /tmp/rda.log
cd "$PROJECT_DIR"
nohup node server.js > /tmp/rda.log 2>&1 &
SERVER_PID=$!
echo "✅ Server started (PID $SERVER_PID) — logs at /tmp/rda.log"

# 3. Wait for server to be ready
sleep 2

# 4. Check server is up
if curl -s http://localhost:3000 > /dev/null 2>&1 || lsof -i:3000 > /dev/null 2>&1; then
  echo "✅ Server is listening on port 3000"
else
  echo "⚠️  Server may not be ready yet — check /tmp/rda.log"
fi

echo ""
echo "─────────────────────────────────────────────"
echo "  NOW: Open a new terminal and run ngrok:"
echo "  ngrok http 3000"
echo ""
echo "  Then update Twilio webhook to:"
echo "  https://YOUR-NGROK-URL/call"
echo "─────────────────────────────────────────────"
echo ""
echo "  Dashboard: http://localhost:3000/dashboard"
echo ""
echo "  To tail logs:  tail -f /tmp/rda.log"
echo "─────────────────────────────────────────────"
echo ""
