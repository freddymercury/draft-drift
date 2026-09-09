#!/usr/bin/env bash
# UserPromptSubmit hook — injects the live draft shortlist into the agent's
# context on every prompt, so asking "go" costs no tool call.
#
# Stays silent unless a draft is actually live: a watcher file must exist and
# have changed in the last 5 minutes. Otherwise this prints nothing and adds
# nothing to context.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WATCH="$HOME/.agenteyes/watch"

# newest watcher file, if any
newest=$(ls -t "$WATCH"/*.json 2>/dev/null | head -1) || exit 0
[ -n "${newest:-}" ] || exit 0

# only speak up if it's fresh (mtime within 300s)
now=$(date +%s)
mtime=$(stat -f %m "$newest" 2>/dev/null || stat -c %Y "$newest" 2>/dev/null) || exit 0
age=$(( now - mtime ))
[ "$age" -lt 300 ] || exit 0

# Which league config is live. A mock writes "mock.json" here so the hook
# doesn't report the real league's board during a practice draft.
CFG="config.json"
[ -f "$DIR/.claude/hooks/active-config" ] && CFG=$(cat "$DIR/.claude/hooks/active-config")

out=$(cd "$DIR" && timeout 20 bun run src/cli.ts -c "$CFG" rec 2>/dev/null) || exit 0
[ -n "$out" ] || exit 0

echo "<live-draft-state config=\"$CFG\" age=\"${age}s\">"
echo "$out"
echo "</live-draft-state>"
