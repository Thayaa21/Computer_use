#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Remote Dev Assistant — STOP
# ─────────────────────────────────────────────────────────────

echo ""
echo "🛑 Stopping Remote Dev Assistant..."

# Kill server on port 3000
lsof -ti:3000 | xargs kill -9 2>/dev/null && echo "✅ Server stopped" || echo "ℹ️  Server was not running"

# Kill any ngrok processes
pkill -f "ngrok http" 2>/dev/null && echo "✅ ngrok stopped" || echo "ℹ️  ngrok was not running"

echo ""
echo "✅ All stopped."
echo ""
