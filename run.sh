#!/usr/bin/env bash
# Runs the app without Docker: the API on SQLite (port 8000) and the frontend dev server (port 5173).
set -euo pipefail
cd "$(dirname "$0")"

for tool in uv node; do
  if ! command -v "$tool" >/dev/null; then
    echo "$tool is missing. Install both with: brew install uv node" >&2
    exit 1
  fi
done

# npm ci refuses a Node version outside "engines" in frontend/package.json (engine-strict in .npmrc).
[ -d frontend/node_modules ] || (cd frontend && npm ci)

# Ctrl+C (or either server stopping) stops both.
trap 'kill 0' EXIT
(cd backend && SEED_DEMO=1 uv run fastapi run app/main.py --host 127.0.0.1 --port 8000) &
(cd frontend && npm run dev -- --port 5173 --strictPort) &
echo "Open http://localhost:5173 and sign in as demo@example.com / demo-password"
wait
