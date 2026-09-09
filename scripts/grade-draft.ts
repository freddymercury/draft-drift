#!/usr/bin/env bun
/**
 * Compare the official draft results against what the captures recorded, and
 * grade every pick against the board.
 *
 *   bun run grade [results.txt]
 */
import { buildBoard, norm } from "../src/board";
import { parseFlags } from "../src/options";
import type { Player } from "../src/types";

const TEAMS = 12;
const ME = "Dns";

const file = Bun.argv[2] ?? "data/official-results.txt";
const text = await Bun.file(file).text();

interface Pick { overall: number; round: number; inRound: number; team: string; name: string; pos: string; player?: Player; }

const { opts } = parseFlags(["-c", "mock.json"]);
const board = await buildBoard(opts);

// Yahoo prints "Last, First"; the board holds "First Last".
const byKey = new Map<string, Player>();
for (const p of board.players) {
  const n = norm(p.name);
  const sp = n.indexOf(" ");
  if (sp > 0) byKey.set(`${n[0]}|${n.slice(sp + 1)}|${p.pos}`, p);
}
const findPlayer = (raw: string, pos: string): Player | undefined => {
  const m = /^(.+?),\s*(.+)$/.exec(raw);
  const full = m ? `${m[2]} ${m[1]}` : raw;
  const n = norm(full);
  const sp = n.indexOf(" ");
  if (sp <= 0) return undefined;
  return byKey.get(`${n[0]}|${n.slice(sp + 1)}|${pos}`);
};

const picks: Pick[] = [];
let round = 0;
for (const line of text.split("\n").map((l) => l.trim())) {
  const r = /^Round (\d+)$/.exec(line);
  if (r) { round = Number(r[1]); continue; }
  const m = /^\((\d+)\)\s+(.+?)\s+-\s+(.+?)\s+\([A-Za-z]{2,3}\s*-\s*(QB|RB|WR|TE|K|DEF)\)$/.exec(line);
  if (!m || !round) continue;
  const inRound = Number(m[1]);
  picks.push({
    overall: (round - 1) * TEAMS + inRound,
    round, inRound, team: m[2]!, name: m[3]!, pos: m[4]!,
    player: findPlayer(m[3]!, m[4]!),
  });
}

const state = (await Bun.file("data/state.mock.json").json()) as { myPicks: string[]; drafted: string[] };
const mine = picks.filter((p) => p.team === ME);

console.log(`official: ${picks.length} picks, ${new Set(picks.map((p) => p.team)).size} teams`);
console.log(`matched to board: ${picks.filter((p) => p.player).length}/${picks.length}\n`);

// --- how accurate was the roster tracking? ---
const officialMine = new Set(mine.map((p) => p.player?.name ?? p.name));
const trackedMine = new Set(state.myPicks);
const missedMine = [...officialMine].filter((n) => !trackedMine.has(n));
const wrongMine = [...trackedMine].filter((n) => !officialMine.has(n));
console.log("ROSTER TRACKING");
console.log(`  official picks: ${mine.length}   tracked: ${trackedMine.size}`);
console.log(`  correct: ${[...trackedMine].filter((n) => officialMine.has(n)).length}`);
console.log(`  missed : ${missedMine.length}${missedMine.length ? " -> " + missedMine.join(", ") : ""}`);
console.log(`  wrong  : ${wrongMine.length}${wrongMine.length ? " -> " + wrongMine.join(", ") : ""}`);

// --- how accurate was the drafted-pool tracking? ---
const officialAll = new Set(picks.map((p) => p.player?.name).filter(Boolean) as string[]);
const trackedAll = new Set(state.drafted);
const falsePos = [...trackedAll].filter((n) => !officialAll.has(n));
console.log("\nDRAFTED-POOL TRACKING");
console.log(`  officially drafted (matched to board): ${officialAll.size}`);
console.log(`  detected as drafted: ${trackedAll.size}`);
console.log(`  correct: ${[...trackedAll].filter((n) => officialAll.has(n)).length}`);
console.log(`  false positives: ${falsePos.length}${falsePos.length ? " -> " + falsePos.slice(0, 6).join(", ") : ""}`);
