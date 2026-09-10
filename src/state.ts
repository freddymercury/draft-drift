import { positions } from "./sport";
import type { Config, Player, Position } from "./types";

export interface DraftState {
  /** Board names of players I have drafted, in pick order. */
  myPicks: string[];
  /** Board names known to be off the board (mine + everyone else's). */
  drafted: string[];
  currentPick: number;
  /** Available-player names from the previous capture, for diffing. */
  lastSeen?: string[];
}

export async function loadState(path: string): Promise<DraftState> {
  const f = Bun.file(path);
  if (!(await f.exists())) return { myPicks: [], drafted: [], currentPick: 1 };
  return (await f.json()) as DraftState;
}

export async function saveState(path: string, s: DraftState): Promise<void> {
  await Bun.write(path, JSON.stringify(s, null, 1));
}

/** Snake order: how many picks pass between my turn and my next one. */
export function picksUntilNextTurn(cfg: Config, pickNo: number): number {
  const t = cfg.teams;
  const slot = cfg.my_draft_slot;
  if (!slot) return t; // unknown slot — assume an average full turn
  const round = Math.ceil(pickNo / t);
  // odd rounds run 1..t, even rounds run t..1
  const inRound = ((pickNo - 1) % t) + 1;
  const mySpot = round % 2 === 1 ? slot : t - slot + 1;
  // Not my turn: how many picks until it is. This is what scarcity needs when
  // previewing ahead of the clock — those players are gone before I choose.
  if (inRound !== mySpot) {
    let n = 0;
    for (let q = pickNo; q < pickNo + 2 * t + 2; q++) {
      const r = Math.ceil(q / t);
      const ir = ((q - 1) % t) + 1;
      const spot = r % 2 === 1 ? slot : t - slot + 1;
      if (ir === spot) return n;
      n++;
    }
    return n;
  }
  // My turn: gap until the turn after this one.
  return round % 2 === 1 ? 2 * (t - slot) + 1 : 2 * (slot - 1) + 1;
}

export interface SlotNeed {
  open: Partial<Record<Position | "FLEX", number>>;
  /** Best projection I currently roster at each position, for marginal-gain math. */
  best: Partial<Record<Position, number[]>>;
}

/** Which starting slots are still empty, given who I've already drafted. */
export function rosterNeed(cfg: Config, mine: Player[]): SlotNeed {
  const open: Partial<Record<Position | "FLEX", number>> = {};
  const best: Partial<Record<Position, number[]>> = {};
  for (const pos of positions()) {
    const have = mine.filter((p) => p.pos === pos).sort((a, b) => b.proj - a.proj);
    best[pos] = have.map((p) => p.proj);
    open[pos] = Math.max(0, (cfg.roster[pos] ?? 0) - have.length);
  }
  // leftovers past the dedicated slots can fill FLEX
  const spare = cfg.flex_eligible.reduce((n, pos) => {
    const have = mine.filter((p) => p.pos === pos).length;
    return n + Math.max(0, have - (cfg.roster[pos] ?? 0));
  }, 0);
  open.FLEX = Math.max(0, (cfg.roster.FLEX ?? 0) - spare);
  return { open, best };
}
