import { HARD_INJURY } from "./types";
import { positions as POSITION_LIST, sport } from "./sport";
import type { Board, Config, Player, Position } from "./types";
import { picksUntilNextTurn, rosterNeed } from "./state";
import type { DraftState } from "./state";

export interface Rec {
  player: Player;
  score: number;
  reasons: string[];
}

/**
 * Share of league-wide starting slots belonging to a position — a rough proxy
 * for how fast that position drains while you wait.
 */
export function starterShare(cfg: Config, pos: Position): number {
  const dedicated = (p: Position) => cfg.roster[p] ?? 0;
  const flex = cfg.roster.FLEX ?? 0;
  const total = POSITION_LIST().reduce((n, p) => n + dedicated(p), 0) + flex;
  const own = dedicated(pos) + flex * (cfg.flex_split[pos] ?? 0);
  return total > 0 ? own / total : 0;
}

/** Kickers and defenses are worth nothing until the very end of the draft. */
function lateOnly(pos: Position, cfg: Config, pickNo: number): boolean {
  if (!sport().lateOnly.includes(pos)) return false;
  const totalRounds = Object.values(cfg.roster).reduce<number>((a, b) => a + (b ?? 0), 0) - (cfg.roster.IR ?? 0);
  const round = Math.ceil(pickNo / cfg.teams);
  return round < totalRounds - 1;
}

export function recommend(
  board: Board,
  state: DraftState,
  available: Player[],
  limit = 5,
): Rec[] {
  const cfg = board.config;
  const mine = board.players.filter((p) => state.myPicks.includes(p.name));
  const { open } = rosterNeed(cfg, mine);
  const wait = picksUntilNextTurn(cfg, state.currentPick);
  const byName = new Set(available.map((p) => p.name));

  const recs: Rec[] = [];
  for (const p of available) {
    if (lateOnly(p.pos, cfg, state.currentPick)) continue;
    const reasons: string[] = [];

    // Base: value over a replacement-level starter at the same position.
    let score = p.vor;

    // Does he fill a hole in my starting lineup, or just ride the bench?
    const fillsSlot = (open[p.pos] ?? 0) > 0;
    const fillsFlex = !fillsSlot && cfg.flex_eligible.includes(p.pos) && (open.FLEX ?? 0) > 0;
    if (fillsSlot) {
      score *= 1.25;
      reasons.push(`fills open ${p.pos}`);
    } else if (fillsFlex) {
      score *= 1.1;
      reasons.push("fills FLEX");
    } else {
      score *= 0.75;
      reasons.push(`${p.pos} already covered — bench/upside`);
    }

    // Tier scarcity, scaled by how long I actually wait. At the turn (slot 10
    // of 10) pick N has wait=1 and pick N+1 has wait=19 — the same tier is
    // safe at the first and gone by the second, so this cannot be binary.
    const tierLeft = available.filter(
      (o) => o.pos === p.pos && o.tier === p.tier && byName.has(o.name),
    ).length;
    const expectedGone = wait * starterShare(cfg, p.pos);
    const survivors = tierLeft - expectedGone;
    if (wait > 0) {
      if (survivors <= 0) {
        score *= 1.35;
        reasons.push(`${p.pos} tier ${p.tier} (${tierLeft}) likely gone in ${wait}`);
      } else if (survivors <= 1) {
        score *= 1.2;
        reasons.push(`${tierLeft} left in tier ${p.tier}, ~${expectedGone.toFixed(1)} go`);
      } else if (survivors <= 3) {
        score *= 1.08;
        reasons.push(`${tierLeft} left in tier ${p.tier}`);
      }
    }

    // Market drift: he is still here later than the field usually takes him.
    if (p.valueVsAdp != null && p.valueVsAdp > 8) {
      score *= 1.12;
      reasons.push(`falling — ADP ${p.adpFormatted}`);
    }

    // Hard injury tags: real discount, not a veto (handcuff value is real).
    if (p.injuryStatus && HARD_INJURY.has(p.injuryStatus)) {
      score *= 0.55;
      reasons.push(`**${p.injuryStatus}**`);
    }

    // Bye-week collision among my starters.
    const clash = mine.filter((o) => o.bye && o.bye === p.bye).length;
    if (clash >= 2) {
      score *= 0.95;
      reasons.push(`bye ${p.bye} stacks ${clash}`);
    }

    recs.push({ player: p, score: Math.round(score * 10) / 10, reasons });
  }

  recs.sort((a, b) => b.score - a.score);
  return recs.slice(0, limit);
}

/** Roster accounting: what's filled, what's still open, what to prioritise. */
export function renderRoster(cfg: Config, mine: Player[]): string {
  const { open } = rosterNeed(cfg, mine);
  const lines: string[] = ["ROSTER"];
  for (const pos of POSITION_LIST()) {
    const have = mine.filter((p) => p.pos === pos).sort((a, b) => b.proj - a.proj);
    const want = cfg.roster[pos] ?? 0;
    if (!want && !have.length) continue;
    const mark = have.length >= want ? "OK " : "   ";
    const names = have.length ? have.map((p) => p.name).join(", ") : "—";
    lines.push(`  ${mark}${pos.padEnd(4)} ${have.length}/${want}  ${names}`);
  }
  const flexHave = (cfg.roster.FLEX ?? 0) - (open.FLEX ?? 0);
  lines.push(`  ${flexHave >= (cfg.roster.FLEX ?? 0) ? "OK " : "   "}FLEX ${flexHave}/${cfg.roster.FLEX ?? 0}`);
  const need = Object.entries(open).filter(([, v]) => v && v > 0).map(([k, v]) => `${k}x${v}`);
  lines.push("", "NEED: " + (need.length ? need.join(", ") : "roster complete"));
  return lines.join("\n");
}

export function renderRecs(recs: Rec[], state: DraftState, cfg: Config, wait: number): string {
  const round = Math.ceil(state.currentPick / cfg.teams);
  const out = [
    `PICK ${state.currentPick} (round ${round})` +
      (wait > 0 ? ` · ${wait} picks until your next turn` : ""),
    "",
  ];
  recs.forEach((r, i) => {
    const p = r.player;
    out.push(
      `${i + 1}. ${p.name}  ${p.pos}${p.posRank} ${p.team ?? ""}  ` +
        `proj ${p.proj} · VOR ${p.vor} · T${p.tier} · ADP ${p.adpFormatted ?? "—"}`,
    );
    out.push(`   ${r.reasons.join(" · ")}`);
  });
  if (!recs.length) out.push("no candidates — is the capture the available-players list?");
  return out.join("\n");
}
