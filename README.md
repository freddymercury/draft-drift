# draft-drift

Live draft assistant for a Yahoo fantasy football draft. Measures the *drift*
between the market's board (ADP) and yours (projection-based VOR), and between
the draft as it's going and the draft you planned for.

Written for a 10-team half-PPR league with QB/WR×3/RB×2/TE/FLEX/K/DEF + 5 BN,
but the roster shape, team count and draft slot all come from `config.json` —
replacement level and snake math are derived from them, not hardcoded.

## Setup

```bash
bun install
cp config.example.json config.json   # then edit for your league
bun run all                          # fetch fresh data + build the board
```

`config.json` is gitignored — it holds your league's id, scoring and draft
slot. `config.example.json` carries the same shape with the specifics removed.

## During a draft

**The whole workflow:** start the two processes below, hit **Cmd+Shift+Y** once
on the Yahoo draft tab, then leave it alone. The page re-sends itself every 5
seconds (only when it actually changed), the shortlist refreshes automatically,
drafted players remove themselves, and the terminal beeps when you're up.

You never type a command mid-draft.


Terminal 1 — the AgentEyes bridge (from the `agenteyes` repo):

```bash
cd ../agenteyes/server && bun server.js
```

Terminal 2 — the watcher:

```bash
bun run watch
```

Then in Chrome, on the Yahoo draft page, press **Cmd+Shift+Y** and click the
element you want watched. Do it twice:

1. the **available players list** — the draft pool
2. your **roster / my team pane** — so your own picks are read, not typed

Label them when prompted (anything with "roster" in it is recognised as yours).
That's the only interaction of the whole draft.

Manual fallbacks, if auto-watch misbehaves:

```bash
bun run pick "Bijan Robinson"   # record your own pick
bun run at 30                   # correct the pick counter
bun run reset                   # start over
```

### How it stays current without you

| what | how |
|---|---|
| new captures | extension re-sends every 5s, only when the page changed |
| current pick | parsed from Yahoo's title + "YOUR TURN - Nth PICK" markers |
| drafted players | diffed against the previous capture — vanished = drafted |
| your roster | read from the roster watcher — no `pick` commands |
| turn alert | terminal bell at ≤3 picks out, and again on the clock |
| draft history | appended to `data/events.jsonl` |

Large list changes (>4 players vanishing at once) are treated as a scroll or
filter switch, not picks — Yahoo's list is virtualized, so this guard matters.

Watchers are independent: each polls its own element, each writes its own file
under `~/.agenteyes/watch/`, and you can remove them one at a time from the
extension popup (or `GET localhost:8765/watch` to see what's live).

## Commands

| command | does |
|---|---|
| `bun run fetch` | pull fresh projections + ADP |
| `bun run build` | rebuild the board |
| `bun run all` | both |
| `bun run watch` | auto-recommend on every AgentEyes capture |
| `bun run rec` | recommend once from the current capture |
| `bun run pick [--off] <name>` | record a pick |
| `bun run at <n>` | set the current pick number |
| `bun run reset` | clear draft state |

## Flags

Every command takes:

| flag | does |
|---|---|
| `--config, -c <path>` | which league config to use (default `config.json`) |
| `--teams, -t <n>` | override `teams` for one run, without editing the file |

Each config keeps its **own** draft state and its **own** board artifacts, so a
mock can never clobber the real draft:

| config | state | board |
|---|---|---|
| `config.json` | `data/state.json` | `board.md`, `data/board.json` |
| `mock.json` | `data/state.mock.json` | `board.mock.md`, `data/board.mock.json` |

```bash
bun run src/cli.ts -c mock.json all           # build the mock board
bun run src/cli.ts -c mock.json watch         # run the mock draft
bun run src/cli.ts -c mock.json -t 14 build   # 14-team lobby, one-off
```

Set `mock.json` to match whatever the Yahoo lobby actually uses. If it doesn't
match, the snake math and tier-scarcity urgency will both be wrong, and you'll
be testing a model that isn't the one you'll draft with.

## Configuration

`config.json` holds your league. Everything else is a compiled-in constant —
see **[docs/configuration.md](docs/configuration.md)** for the complete list of
ports, heuristics and scoring multipliers, including which ones are unvalidated.

The NFL season is resolved from Sleeper at fetch time rather than pinned, so the
board does not silently build from a stale season next year. Override with
`"season": "2027"` in the config if needed.

## Data sources

- **Sleeper** `pts_half_ppr` season projections + player DB (injury tags). Free, no auth.
- **FantasyFootballCalculator** half-PPR ADP. Free, no auth.

## Known limits

- **Scoring bonuses aren't modeled.** Sleeper's `pts_half_ppr` doesn't know your
  150/175/200-yard bonuses, `-2` INT (vs Yahoo default `-1`), or `-3` pick-sixes.
  High-ceiling rushers/WRs are slightly underrated here; QBs slightly overrated.
- **FFC's `teams` param is a no-op** — 10- and 12-team requests return identical
  ADP. Treat it as generic market consensus. With only 10 teams your real board
  is shallower than ADP implies (replacement is WR35/RB26), so don't panic-reach.
- **`Questionable` is ignored** as an injury signal — in the preseason DB it sits
  on fully-projected studs (Nacua, Chase, McCaffrey). Only IR/PUP/NA/Out/Doubtful count.
- **Yahoo's list is virtualized** — a capture only sees the rows currently
  rendered. That's fine for "best available" but it is not the full pool.
