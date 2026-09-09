import { POSITIONS } from "./types";
import type { Player, Position } from "./types";
import { norm } from "./board";

const POS_SET = new Set<string>(POSITIONS);
/** Short status markers Yahoo interleaves between the name and the position. */
const MARKERS = new Set(["Q", "D", "O", "P", "IR", "SUS", "NA", "PUP", "DTD", "GTD"]);

export interface YahooRow {
  raw: string;
  /** normalized "j gibbs" — Yahoo abbreviates first names */
  initial: string;
  lastPart: string;
  pos: Position;
  team: string;
  bye: number | null;
  /** Yahoo's own ADP from the stats row, used to break name collisions. */
  yahooAdp: number | null;
}

/**
 * Yahoo's draft client renders each available player as a run of lines:
 *
 *   J. Gibbs
 *   RB
 *   Det
 *   Bye 6
 *
 * with optional status markers ("Q", "IR") between the name and the position.
 * Parsing that structure beats substring matching, because the name alone is
 * abbreviated and ambiguous ("C. Brown") while name+pos+team is not.
 */
export function parseRows(text: string): YahooRow[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rows: YahooRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const name = lines[i]!;
    // "J. Gibbs" in the player table, possibly "Jahmyr Gibbs" in the roster
    // pane. Requiring pos+team+Bye below filters the false positives.
    if (!/^[A-Z][A-Za-z'’.\-]*\.?\s+\S/.test(name)) continue;
    // Roster panes start with a header like "YOUR TEAM (1/15)", which matches
    // the name shape and would otherwise swallow the slot labels beneath it as
    // its position and team — consuming the real player row behind it.
    if (/[0-9()\/]/.test(name)) continue;

    let j = i + 1;
    while (j < lines.length && MARKERS.has(lines[j]!)) j++;
    const pos = lines[j];
    if (!pos || !POS_SET.has(pos)) continue;
    const team = lines[j + 1];
    if (!team || !/^[A-Za-z]{2,3}$/.test(team)) continue;
    // A roster pane lists empty slots as bare position labels ("WR" under
    // "QB"); a real row always has a team here, never another position.
    if (POS_SET.has(team)) continue;
    const byeLine = lines[j + 2] ?? "";
    const bye = /^Bye\s+(\d+)$/.exec(byeLine);

    // The stats row after the bye is "<XRank>\t<ADP>\t<Bye>\t<Proj>…".
    // Two players can share an initial, surname, position and team
    // (B. Robinson / RB / Atl is both Bijan and Brian), so ADP is the tiebreak.
    const statLine = lines[j + 3] ?? "";
    const stats = statLine.split(/\t+/).map((x) => x.trim()).filter(Boolean);
    const adpRaw = stats.length >= 2 ? Number(stats[1]) : NaN;
    const yahooAdp = Number.isFinite(adpRaw) ? adpRaw : null;

    const n = norm(name); // "j gibbs", "a st brown", "j cook"
    const space = n.indexOf(" ");
    if (space <= 0) continue;

    rows.push({
      raw: name,
      initial: n.slice(0, space),
      lastPart: n.slice(space + 1),
      pos: pos as Position,
      team: team.toUpperCase(),
      bye: bye ? Number(bye[1]) : null,
      yahooAdp,
    });
    i = j + 2;
  }
  return rows;
}

/** Resolve parsed rows against the board, using pos+team to break name ties. */
export function matchRows(rows: YahooRow[], board: Player[]): { matched: Player[]; missed: YahooRow[] } {
  const matched: Player[] = [];
  const missed: YahooRow[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    const cands = board.filter((p) => {
      if (p.pos !== r.pos) return false;
      const n = norm(p.name);
      const first = n.slice(0, n.indexOf(" "));
      // r.initial is "j" from "J. Gibbs" or "jahmyr" from a spelled-out name
      return first.startsWith(r.initial) && n.endsWith(` ${r.lastPart}`);
    });
    // team disambiguates "C. Brown" style collisions; fall back if Yahoo and
    // Sleeper disagree on the team (post-trade rosters drift).
    const exact = cands.filter((p) => (p.team ?? "").toUpperCase() === r.team);
    const narrowed = exact.length ? exact : cands;

    let hit: Player | undefined;
    if (narrowed.length === 1) {
      hit = narrowed[0];
    } else if (narrowed.length > 1) {
      // Still ambiguous. Prefer the candidate whose ADP is nearest Yahoo's own,
      // else the one the market rates highest — never drop the row silently,
      // which is how Bijan Robinson disappeared behind Brian Robinson.
      const scored = narrowed
        .map((p) => ({
          p,
          d: r.yahooAdp != null && p.adp != null ? Math.abs(p.adp - r.yahooAdp) : Number.POSITIVE_INFINITY,
        }))
        .sort((a, b) => (a.d - b.d) || ((a.p.adp ?? 999) - (b.p.adp ?? 999)));
      hit = scored[0]!.p;
    }

    if (hit && !seen.has(hit.name)) {
      seen.add(hit.name);
      matched.push(hit);
    } else if (!hit) {
      missed.push(r);
    }
  }
  return { matched, missed };
}

/** My pick numbers, in order, for a snake draft. */
export function turnSchedule(teams: number, slot: number, rounds = 20): number[] {
  const out: number[] = [];
  for (let r = 1; r <= rounds; r++) {
    const inRound = r % 2 === 1 ? slot : teams - slot + 1;
    out.push((r - 1) * teams + inRound);
  }
  return out;
}

/**
 * Work out the current pick from the page itself, so no manual `at` is needed.
 *
 * Yahoo gives us two independent signals:
 *   - the title: "YOUR TURN, DRAFT NOW" / "9 picks until your turn"
 *   - inline markers: "YOUR TURN - 31ST PICK" — the *next* turn, not the current
 */
export function detectPick(
  title: string,
  text: string,
  teams: number,
  slot: number | null,
): { pick: number; source: string } | null {
  const marker = /YOUR TURN - (\d+)(?:ST|ND|RD|TH) PICK/i.exec(text);
  const nextTurn = marker ? Number(marker[1]) : null;

  const until = /(\d+)\s+picks?\s+until\s+your\s+turn/i.exec(title);
  if (until && nextTurn != null) {
    return { pick: nextTurn - Number(until[1]), source: `title+marker (next turn ${nextTurn})` };
  }

  const onClock = /YOUR TURN,\s*DRAFT NOW/i.test(title);
  if (onClock && nextTurn != null && slot) {
    // markers list upcoming turns, so my current pick is the turn just before
    const sched = turnSchedule(teams, slot);
    const prior = sched.filter((p) => p < nextTurn).pop();
    if (prior != null) return { pick: prior, source: `on the clock (next turn ${nextTurn})` };
  }
  if (onClock && nextTurn != null) return { pick: nextTurn - 1, source: "on the clock" };

  // pre-draft view: "You pick 10th"
  const pre = /You pick (\d+)(?:st|nd|rd|th)/i.exec(title);
  if (pre) return { pick: Number(pre[1]), source: "pre-draft title" };

  return null;
}


/**
 * Work out the league size and draft slot from Yahoo's own turn markers.
 *
 * The config is hand-entered and has been wrong for two mocks running, which
 * silently corrupts every "picks until your turn" figure and all the tier
 * scarcity that depends on it. The markers are authoritative: consecutive gaps
 * in a snake alternate 2*(teams-slot)+1 and 2*(slot-1)+1, which sum to 2*teams
 * and pin both numbers exactly.
 */
export function deriveLeagueFromMarkers(text: string): { teams: number; slot: number } | null {
  const marks = [...text.matchAll(/YOUR TURN - (\d+)(?:ST|ND|RD|TH) PICK/gi)].map((m) => Number(m[1]));
  if (marks.length < 3) return null;
  const gaps: number[] = [];
  for (let i = 1; i < marks.length; i++) gaps.push(marks[i]! - marks[i - 1]!);

  const a = gaps[0]!;
  const b = gaps[1]!;
  // A consistent snake alternates exactly two gap sizes.
  for (let i = 2; i < gaps.length; i++) {
    if (gaps[i] !== (i % 2 === 0 ? a : b)) return null;
  }
  const teams = (a + b) / 2;
  if (!Number.isInteger(teams) || teams < 2 || teams > 20) return null;

  // The first gap after a pick is the one going back down the snake.
  const slot = teams - (a - 1) / 2;
  if (!Number.isInteger(slot) || slot < 1 || slot > teams) return null;

  // Confirm against the markers themselves rather than trusting the algebra.
  const sched = turnSchedule(teams, slot, Math.ceil((marks[marks.length - 1]! + teams) / teams));
  return marks.every((m) => sched.includes(m)) ? { teams, slot } : null;
}
