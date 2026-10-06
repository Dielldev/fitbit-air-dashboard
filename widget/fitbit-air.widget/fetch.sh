#!/bin/sh
# Fetches /api/widget for index.jsx. Prints the JSON body, then a last line with the HTTP status
# ("000" = dashboard not reachable, "nosecret" = no key file yet). Always exits 0 so the widget
# decides how to show a failure.
# The key goes to curl on stdin, never on its command line where other processes could see it.
BASE="${1:-http://127.0.0.1:8787}"
KEY_FILE="$(dirname "$0")/secret"

if [ ! -s "$KEY_FILE" ]; then
  printf '\nnosecret\n'
  exit 0
fi

printf 'Authorization: Bearer %s\n' "$(tr -d '[:space:]' < "$KEY_FILE")" |
  curl -sS -m 8 -H @- -w '\n%{http_code}\n' "$BASE/api/widget" 2>/dev/null
exit 0
