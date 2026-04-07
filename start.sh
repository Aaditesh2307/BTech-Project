#!/bin/bash
# ─────────────────────────────────────────────
#  LexAI — Start Script
#  Launches the AI backend + website server
#  Usage:  ./start.sh
# ─────────────────────────────────────────────

PROJECT="$(cd "$(dirname "$0")" && pwd)"
TEST_DIR="$PROJECT/Test"
WEBSITE_DIR="$PROJECT/legal-ai-website"
VENV="$TEST_DIR/legal_venv/bin/python3"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       LexAI — Starting Up...         ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Check venv exists ──────────────────────
if [ ! -f "$VENV" ]; then
  echo "❌ Virtual env not found at $TEST_DIR/legal_venv"
  echo "   Run: python3 -m venv Test/legal_venv && Test/legal_venv/bin/pip install transformers torch gradio pypdf fastapi uvicorn motor pymongo accelerate"
  exit 1
fi

# ── Kill anything already on ports 8000 / 3000 ──
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:3000 | xargs kill -9 2>/dev/null

# ── Start AI backend ───────────────────────
echo "🧠 Starting AI backend (port 8000)..."
cd "$TEST_DIR"
"$VENV" backend.py > /tmp/lexai_backend.log 2>&1 &
BACKEND_PID=$!
echo "   PID: $BACKEND_PID  |  Log: /tmp/lexai_backend.log"

# ── Wait for backend to be ready ──────────
echo "   Waiting for models to load (this takes ~30s)..."
for i in $(seq 1 60); do
  sleep 2
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    break
  fi
done

if ! curl -sf http://localhost:8000/health > /dev/null 2>&1; then
  echo "❌ Backend failed to start. Check log: /tmp/lexai_backend.log"
  exit 1
fi
echo "   ✅ Backend ready!"

# ── Start website server ───────────────────
echo ""
echo "🌐 Starting website (port 3000)..."
cd "$WEBSITE_DIR"
python3 -m http.server 3000 > /tmp/lexai_website.log 2>&1 &
WEB_PID=$!
echo "   PID: $WEB_PID  |  Log: /tmp/lexai_website.log"

# ── Open browser ───────────────────────────
sleep 1
open "http://localhost:3000" 2>/dev/null || true

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  ✅  LexAI is running!               ║"
echo "║                                      ║"
echo "║  Website  →  http://localhost:3000   ║"
echo "║  Backend  →  http://localhost:8000   ║"
echo "║                                      ║"
echo "║  Press Ctrl+C to stop both servers   ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── Keep script alive; kill both on Ctrl+C ─
trap "echo ''; echo 'Stopping servers...'; kill $BACKEND_PID $WEB_PID 2>/dev/null; exit 0" INT TERM
wait
