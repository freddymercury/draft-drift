# draft-drift — notes for the agent

A live fantasy-draft assistant. If the user is mid-draft and asks "who do I
take?", the fastest path is:

```bash
bun run rec
```

That reads the latest AgentEyes capture (`~/.agenteyes/context.json`),
intersects it with the board, and prints a ranked shortlist.

## How the pieces fit

- `src/board.ts` — merges Sleeper projections + FFC ADP into VOR-ranked,
  tiered players. `data/board.json` is the artifact; `board.md` is for humans.
- `src/parse.ts` — pulls board players out of a capture.
- `src/yahoo.ts` — parses Yahoo's rows structurally (name → pos → team → "Bye N")
  because the pool abbreviates first names ("J. Gibbs") while the roster pane
  may spell them out.
- `src/sources.ts` — reads every named watcher and decides which is the pool
  and which is the roster.
- `src/events.ts` — diffs captures into draft events.
- `src/state.ts` — my picks, everyone's picks, current pick number, snake math.
- `src/recommend.ts` — the scoring model (see below).
- `src/watch.ts` — polls the capture file's mtime and re-runs on change.

## The scoring model

Base is VOR (projection minus a replacement-level starter at that position),
then multiplied by: roster need (fills a starting slot 1.25×, FLEX 1.1×,
already covered 0.75×), tier scarcity (last ≤2 in tier 1.3×), market drift
(falling past ADP 1.12×), hard injury tag (0.55×), bye stacking (0.95×).
K and DEF are suppressed until the last two rounds.

## How the agent gets the state

Three ways, cheapest first:

1. **It's already in context.** A `UserPromptSubmit` hook
   (`.claude/hooks/draft-status.sh`) runs `rec` on every prompt and injects a
   `<live-draft-state>` block — but only while a draft is live (a watcher file
   changed in the last 5 minutes). If that block is present, use it; do not
   re-run anything.
2. **`bun run rec`** — one command, reads every watcher and prints the same thing.
3. **Raw files** — `~/.agenteyes/watch/*.json` for captures, `data/board.json`
   for rankings, `data/state.json` for draft state, `data/events.jsonl` for history.

Nothing pushes to the agent and nothing can. `FileChanged` hooks exist but their
stdout is not added to context, so they cannot start a turn — the watcher's job
is to keep state correct so that *whenever* the agent looks, the answer is right.

## Bookkeeping (mostly automatic now)

With auto-watch on (Cmd+Shift+Y), the pick number is parsed from the page and
drafted players are diffed out automatically — `state.lastSeen` holds the
previous capture so even one-shot `rec` runs diff correctly.

If a **roster watcher** is running, the user's own picks are read straight off
the page and nothing needs recording at all. Check the `sources:` line — it
names each watcher and marks which one was treated as the roster.

If there is no roster watcher, `myPicks` is only what was recorded manually.
Ask rather than assume: assuming it once produced a confidently wrong roster
that poisoned several recommendations.

## Logs

`logs/draft-<date>.log` (human) and `.jsonl` (structured), written synchronously
so a one-shot `rec` can't lose events. They record what was *understood* from
each capture, not just that one arrived — parse yield, position mix, roster
contents, unmatched names. Every bug found in testing produced confident wrong
output rather than an exception, so those four fields are the actual signal.

Warnings worth grepping: `pool_filtered`, `no_roster_watcher`, `unmatched`,
`parse_yield_zero`, `pick_undetected`, `diff_ignored`.

## Gotchas that already bit once

- `norm()` must collapse whitespace **before** stripping punctuation. Doing it
  the other way deletes newlines and glues table rows together.
- Compare my rank to ADP using `poolRank` (rank among players the market
  actually drafts), not `overallRank` (rank among all ~630). ADP tops out near
  pick 180, so `overallRank` makes everyone deep on the board look "contested".
- Tier scarcity must scale with `picksUntilNextTurn`, not just `> 0`. At the
  turn (slot 10 of 10) consecutive picks have wait 1 and wait 19; a binary
  check made both recommend the identical list.
- Yahoo abbreviates first names, so `B. Robinson / RB / Atl` matches **both**
  Bijan and Brian Robinson (same team in 2026). Ties break on Yahoo's own ADP
  column from the stats row, falling back to the better-ranked player — never
  drop the row, which silently removed the #2 overall pick from the pool.
- Captures are pull-only and can be stale. `runOnce` prints the age and warns
  past 3 minutes — believe the warning.
