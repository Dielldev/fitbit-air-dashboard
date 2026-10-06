#!/bin/zsh
# Double-click in Finder to start the Fitbit Air dashboard, then open http://localhost:8787
cd "$(dirname "$0")"
if lsof -ti :8787 >/dev/null 2>&1; then
  echo "The dashboard is already running. Opening it…"
  open "http://localhost:8787/"
  exit 0
fi
echo "Starting the Fitbit Air dashboard. Keep this window open; close it to stop."
exec python3 server.py
