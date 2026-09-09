# Configuration reference

`config.json` (copy from `config.example.json`) holds everything league-specific.
Everything below is a compiled-in constant with no runtime setting — this is the
complete list of what is hardcoded, where, and what changing it affects.

---

## League settings — `config.json`

| Key | Meaning |
|---|---|
| `teams` | league size; drives replacement level and all snake math |
| `my_draft_slot` | 1-based; determines your pick numbers and the gap between turns |
| `roster` | starting slots + bench. Replacement level is derived from these, so a 10-team 3-WR league values a WR very differently from a 12-team 2-WR one |
| `flex_split` | how FLEX demand is apportioned across RB/WR/TE when computing replacement |
| `pick_clock_seconds` | display only |
| `scoring_detail` | documentation only — **not** used in scoring (see caveat below) |
| `season` | *optional*. Omit to resolve from Sleeper at fetch time |

Each config keeps its own state and board artifacts, so a mock can never
clobber a real draft:

| config | state | board |
|---|---|---|
| `config.json` | `data/state.json` | `board.md`, `data/board.json` |
| `mock.json` | `data/state.mock.json` | `board.mock.md`, `data/board.mock.json` |

## Network

| Value | Default | Where |
|---|--:|---|
| Web UI port | `8766` | `src/serve.ts` `PORT` |
| AgentEyes watch dir | `~/.agenteyes/watch` | `src/sources.ts` `WATCH_DIR` |
| AgentEyes capture file | `~/.agenteyes/context.json` | `src/parse.ts` `CAPTURE_PATH` |
| Chrome DevTools port | `9222` | `src/cdp.ts` `PORT` (unused — see below) |
| UI refresh interval | 3 s | inline in the page script, `src/serve.ts` |
| Watch poll interval | 400 ms | `src/watch.ts` (file mtime poll; cheap) |

The two AgentEyes paths are a **cross-repo contract**. They must match what the
AgentEyes server writes; changing either side alone silently yields zero
captures, which looks identical to "nothing has been captured yet".

## Heuristics — the ones that change recommendations

| Value | Default | Where | Why it matters |
|---|--:|---|---|
| `maxPlausiblePicks` | `4` | `src/events.ts` | more than this many players vanishing at once is treated as a scroll/filter change, not picks. **Never validated against a full live draft** — if you see "large list change" repeatedly, this is the number to raise |
| Single-position guard | ≥10 players, all one position | `src/sources.ts` | catches Yahoo's position tabs |
| Search-filter guard | pool < 50% of high-water | `src/sources.ts` | catches the search box |
| Stale capture warning | 3 min | `src/watch.ts` | display only |
| Hook silence window | 5 min | `.claude/hooks/draft-status.sh` | the hook emits nothing if no capture is newer than this |
| Name match minimum | 4 chars | `src/parse.ts` | fallback matcher only |

## Scoring model — read this before trusting the board

| Multiplier | Value | Where |
|---|--:|---|
| fills an open starting slot | ×1.25 | `src/recommend.ts` |
| fills FLEX | ×1.10 | |
| position already covered | ×0.75 | |
| last ≤2 in tier before your next turn | ×1.35 | |
| falling past ADP by >8 | ×1.12 | |
| hard injury tag (IR/PUP/NA/Out) | ×0.55 | |
| bye-week stacking ≥2 | ×0.95 | |

These were chosen by judgement, not fitted to anything. They are the most
opinionated numbers in the codebase.

**Two known modelling gaps:**

1. **Scoring bonuses are not modelled.** Sleeper's `pts_half_ppr` does not know
   about yardage bonuses, non-default interception penalties, or pick-sixes, so
   `scoring_detail` in the config is documentation rather than input. Net effect:
   high-ceiling rushers and receivers are slightly underrated, quarterbacks
   slightly overrated.
2. **`Questionable` is ignored** as an injury signal. In the preseason player DB
   it sits on fully-projected starters, so only IR/PUP/NA/Out/Doubtful count.

## Data sources

| Source | Endpoint | Auth |
|---|---|---|
| Sleeper projections | `api.sleeper.app/projections/nfl/<season>` | none |
| Sleeper player DB | `api.sleeper.app/v1/players/nfl` | none |
| Sleeper season state | `api.sleeper.app/v1/state/nfl` | none |
| ADP | `fantasyfootballcalculator.com/api/v1/adp/half-ppr` | none |

The ADP endpoint's `teams` parameter **is ignored** — 10- and 12-team requests
return byte-identical data. Treat it as generic market consensus, not
league-specific.

## Unused code

`src/cdp.ts` speaks the Chrome DevTools Protocol and is not wired into anything.
It was written as an alternative to AgentEyes for reading the page directly and
set aside because it needs a separate Chrome profile and a fresh login. Kept
because it works; delete it if that path is not going to be taken.

## What should become configurable

1. **`maxPlausiblePicks`** — the only constant that has silently changed a
   recommendation, and the least validated.
2. **Web UI port** — the one likely to collide.
3. **Scoring multipliers** — currently requires editing TypeScript to tune the
   thing most worth tuning.
