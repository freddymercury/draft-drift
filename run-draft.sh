#!/usr/bin/env bash
# Thursday launcher: fresh data, clean state, logs that survive a restart.
set -euo pipefail
cd "$(dirname "$0")"
CFG="${1:-config.json}"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p logs

echo "== refreshing data =="
bun run src/cli.ts -c "$CFG" all

echo "== clearing draft state =="
bun run src/cli.ts -c "$CFG" reset

echo "== starting AgentEyes server =="
pkill -f "server.js" 2>/dev/null || true
sleep 0.5
(cd ../agenteyes/server && bun server.js >> "../../draft-drift/logs/agenteyes-$STAMP.log" 2>&1 &)

echo "== starting UI =="
pkill -f "cli.ts.*serve" 2>/dev/null || true
sleep 0.5
(bun run src/cli.ts -c "$CFG" serve >> "logs/serve-$STAMP.log" 2>&1 &)
sleep 2

echo
echo "  UI:      http://localhost:8766"
echo "  logs:    logs/*-$STAMP.log  (appended, not overwritten)"
echo "  config:  $CFG"
echo
echo "  Next: reload the extension, then Cmd+Shift+Y twice —"
echo "        the player list ('Available Players') and your roster ('My Roster')."
echo "        Keep the list on All Positions with the search box empty."
