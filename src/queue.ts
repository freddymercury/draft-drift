import type { Board, Player } from "./types";
import type { DraftState } from "./state";
import { rosterNeed } from "./state";
import { recommend, starterShare } from "./recommend";

export interface QueueNote {
  /** "reorder" changes what you take next; "angle" is context that might. */
  kind: "reorder" | "angle" | "warning";
  player: string;
  headline: string;
  /** The reasoning, spelled out — the point is to be arguable, not obeyed. */
  because: string;
}

export interface QueueAnalysis {
  queue: Array<{ name: string; pos: string; vor: number; score: number; survival: number }>;
  /** True when the user's order already matches the recommended one. */
  orderMatches: boolean;
  notes: QueueNote[];
}

/**
 * Rough odds a player is still there at your next turn.
 *
 * Not a real model: it asks how many players at this position tend to go in a
 * given number of picks, against how many are left in the same tier. Good
 * enough to separate "he will last" from "he will not", which is the only
 * question that changes a queue's order.
 */
function survival(p: Player, board: Board, available: Player[], wait: number, teams: number): number {
  if (wait <= 0) return 1;
  const tierLeft = available.filter((o) => o.pos === p.pos && o.tier === p.tier).length;
  // Share of picks that tend to go to this position, by starter demand. Taken
  // from the roster config rather than a table of football positions, so this
  // holds for any sport.
  const share = starterShare(board.config, p.pos);
  const expectedGone = wait * share;
  if (expectedGone <= 0) return 1;
  // Where the player sits inside his tier matters: the best of five goes first.
  const rank = available.filter((o) => o.pos === p.pos && o.tier === p.tier && o.vor > p.vor).length;
  const cushion = tierLeft - rank;
  const odds = 1 - Math.min(1, expectedGone / Math.max(1, cushion));
  return Math.round(odds * 100) / 100;
}

/**
 * Read a queue and say something useful about it.
 *
 * Two jobs. If the order disagrees with the board, say what to move and why.
 * If it agrees, the queue is not the interesting thing any more — so surface
 * the fact most likely to change it: a player who will not survive the wait, a
 * bye stack, a tier about to empty, a falling price.
 */
export function analyzeQueue(
  board: Board,
  state: DraftState,
  available: Player[],
  queueNames: string[],
  wait: number,
): QueueAnalysis {
  const byName = new Map(available.map((p) => [p.name, p]));
  const queued = queueNames.map((n) => byName.get(n)).filter(Boolean) as Player[];

  const recs = recommend(board, state, queued, queued.length);
  const scoreOf = new Map(recs.map((r) => [r.player.name, r.score]));

  const rows = queued.map((p) => ({
    name: p.name,
    pos: `${p.pos}${p.posRank}`,
    vor: p.vor,
    score: scoreOf.get(p.name) ?? 0,
    survival: survival(p, board, available, wait, board.config.teams),
  }));

  const recommendedOrder = [...queued].sort((a, b) => (scoreOf.get(b.name) ?? 0) - (scoreOf.get(a.name) ?? 0));
  const orderMatches = recommendedOrder.every((p, i) => p.name === queued[i]?.name);

  const notes: QueueNote[] = [];
  const mine = board.players.filter((p) => state.myPicks.includes(p.name));
  const { open } = rosterNeed(board.config, mine);

  // 1. Order disagreements. Report the largest displacement, not only the top
  //    slot — a queue can agree on its first pick and still be wrong below it.
  if (!orderMatches && queued.length > 1) {
    let worst: { p: Player; from: number; to: number; gap: number } | null = null;
    queued.forEach((p, from) => {
      const to = recommendedOrder.findIndex((r) => r.name === p.name);
      const gap = from - to;
      if (gap > 0 && (!worst || gap > worst.gap)) worst = { p, from, to, gap };
    });
    if (worst) {
      const { p, from, to } = worst as { p: Player; from: number; to: number };
      const myScore = scoreOf.get(p.name) ?? 0;
      // Name someone he actually outranks. Using whoever currently sits in the
      // target slot produces a contradiction when that player scores higher:
      // "move Cook above McCaffrey, who scores more than Cook".
      const leapfrogged = queued
        .slice(to, from)
        .filter((o) => (scoreOf.get(o.name) ?? 0) < myScore)
        .sort((a, z) => (scoreOf.get(a.name) ?? 0) - (scoreOf.get(z.name) ?? 0));
      const displaced = leapfrogged[0] ?? queued[to]!;
      const fills = (open[p.pos] ?? 0) > 0;
      notes.push({
        kind: "reorder",
        player: p.name,
        headline: `move ${p.name} up — ${from + 1} to ${to + 1}`,
        because:
          `Scores ${Math.round(myScore)} against ${Math.round(scoreOf.get(displaced.name) ?? 0)} ` +
          `for ${displaced.name}, on VOR ${p.vor} vs ${displaced.vor}` +
          (leapfrogged.length > 1 ? ` — and ${leapfrogged.length} players above him score lower` : "") +
          (fills
            ? `, and he fills an open ${p.pos}.`
            : `. Neither fills a starting slot, so this is about raw value.`),
      });
    }
  }

  // 2. The angle that most often changes a correct order: who will not last.
  const doomed = rows.filter((r) => r.survival < 0.35);
  const safe = rows.filter((r) => r.survival > 0.8);

  // Say so even without a safe counterpart. Requiring both meant a queue where
  // everyone is at risk produced no risk note at all, and then a fallback
  // claiming nobody was — the output contradicting its own numbers.
  if (doomed.length && !safe.length) {
    notes.push({
      kind: "warning",
      player: doomed[0]!.name,
      headline: `${doomed.length} of these probably will not last ${wait} picks`,
      because:
        `${doomed.map((d) => d.name).join(", ")} are unlikely to survive to your next turn. ` +
        `Nobody in the queue is safe either, so this is not about order — it is that you ` +
        `will get roughly one of them. Put the one you actually want first.`,
    });
  }

  if (doomed.length && safe.length) {
    const d = doomed[0]!;
    const s = safe[0]!;
    if (rows.indexOf(d) > rows.indexOf(s)) {
      notes.push({
        kind: "reorder",
        player: d.name,
        headline: `take ${d.name} before ${s.name}`,
        because:
          `${d.name} has roughly a ${Math.round(d.survival * 100)}% chance of lasting your ${wait}-pick wait; ` +
          `${s.name} has ${Math.round(s.survival * 100)}%. Taking the one who survives first loses you the other. ` +
          `This is worth doing even though ${s.name} is the better player.`,
      });
    } else {
      notes.push({
        kind: "angle",
        player: d.name,
        headline: `${d.name} is the one at risk`,
        because:
          `About ${Math.round(d.survival * 100)}% to last ${wait} picks, against ${Math.round(s.survival * 100)}% ` +
          `for ${s.name}. Your order already accounts for that.`,
      });
    }
  }

  // 3. Bye stacking among starters.
  for (const p of queued.slice(0, 3)) {
    const clash = mine.filter((o) => o.bye && o.bye === p.bye);
    if (clash.length >= 2) {
      notes.push({
        kind: "warning",
        player: p.name,
        headline: `${p.name} makes ${clash.length + 1} players on bye ${p.bye}`,
        because: `Already ${clash.map((c) => c.name).join(", ")}. Not disqualifying, but a thin week.`,
      });
    }
  }

  // 4. Queued players who no longer help the starting lineup. Collapsed into
  //    one note: three separate lines saying the same thing is noise.
  const bench = queued.slice(0, 5).filter((p) => {
    const fillsSlot = (open[p.pos] ?? 0) > 0;
    const fillsFlex = board.config.flex_eligible.includes(p.pos) && (open.FLEX ?? 0) > 0;
    return !fillsSlot && !fillsFlex;
  });
  if (bench.length) {
    const needs = Object.entries(open).filter(([, v]) => v && v > 0).map(([k]) => k);
    notes.push({
      kind: "angle",
      player: bench[0]!.name,
      headline:
        bench.length === queued.slice(0, 5).length
          ? "your whole queue is bench depth"
          : `${bench.length} of these are bench depth`,
      because:
        `${bench.map((p) => p.name).join(", ")} sit behind full ${[...new Set(bench.map((p) => p.pos))].join("/")} slots — ` +
        `they add depth, not points. ` +
        (needs.length
          ? `You still need ${needs.join(", ")}, and nothing in the queue addresses that.`
          : `Every slot is filled, so this is upside shopping, which is fine here.`),
    });
  }

  // 5. Market disagreement worth knowing.
  for (const p of queued.slice(0, 3)) {
    if (p.valueVsAdp != null && p.valueVsAdp > 15) {
      notes.push({
        kind: "angle",
        player: p.name,
        headline: `${p.name} is falling`,
        because: `Market takes him around ${p.adpFormatted}; he is still here. Either the field knows something, or it is value.`,
      });
    }
  }

  if (!notes.length) {
    const atRisk = rows.filter((r) => r.survival < 0.5);
    notes.push({
      kind: "angle",
      player: queued[0]?.name ?? "",
      headline: orderMatches ? "order looks right" : "nothing pressing",
      because: atRisk.length
        ? `${atRisk.map((r) => r.name).join(", ")} may not last ${wait} picks, but the order already ` +
          `puts the right player first. No bye stacking, and each fills a slot you need.`
        : `Nobody in the queue is at real risk over ${wait} picks, no bye stacking, ` +
          `and each fills a slot you need. Take them in order.`,
    });
  }

  return { queue: rows, orderMatches, notes };
}
