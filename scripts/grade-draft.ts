#!/usr/bin/env bun
/**
 * Grade an official draft-results capture against our board.
 *
 * Yahoo's Results tab lists every pick in order. Matching each against the
 * board says what the market thought of it (ADP) and what our projections did,
 * so a draft can be reviewed pick by pick rather than by feel.
 *
 *   bun run grade [capture.json]
 */
import { buildBoard, norm } from "../src/board";
import { parseFlags } from "../src/options";
import type { Player } from "../src/types";

const file = Bun.argv[2] ?? `${process.env.HOME}/.agenteyes/context.json`;
const cap = (await Bun.file(file).json()) as { title?: string; text?: string };
const text = cap.text ?? "";

const { opts } = parseFlags(["-c", "mock.json"]);
const board = await buildBoard(opts);

const byKey = new Map<string, Player>();
for (const p of board.players) {
  const n = norm(p.name);
  const sp = n.indexOf(" ");
  if (sp <= 0) continue;
  byKey.set(`${n[0]}|${n.slice(sp + 1)}|${p.pos}`, p);
}

// Yahoo prints rows like "12 J. Chase Cin - WR"; be liberal about the prefix.
const rows: Array<{ pick: number; raw: string; pos: string }> = [];
for (const line of text.split("\n").map((l) => l.trim())) {
  const m = /^\(?(\d{1,3})\)?[.)]?\s+(.+?)\s+([A-Za-z]{2,3})\s*-\s*(QB|RB|WR|TE|K|DEF|D\/ST)$/.exec(line);
  if (m) rows.push({ pick: Number(m[1]), raw: m[2]!, pos: m[4] === "D/ST" ? "DEF" : m[4]! });
}

if (!rows.length) {
  console.log("  no draft rows recognised in that capture.");
  console.log("  title:", cap.title);
  console.log("  sample lines:");
  for (const l of text.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 30)) {
    console.log("   ", JSON.stringify(l.slice(0, 70)));
  }
} else {
  const graded = rows.map((r) => {
    const n = norm(r.raw);
    const sp = n.indexOf(" ");
    const player = sp > 0 ? byKey.get(`${n[0]}|${n.slice(sp + 1)}|${r.pos}`) : undefined;
    return { ...r, player, value: player?.adp != null ? Math.round((player.adp - r.pick) * 10) / 10 : null };
  });
  const matched = graded.filter((g) => g.player);
  console.log(`  parsed ${rows.length} picks, matched ${matched.length} to the board\n`);

  const withValue = matched.filter((g) => g.value !== null) as Array<
    (typeof matched)[number] & { value: number; player: Player }
  >;
  console.log("  BIGGEST VALUES — fell furthest past where the market takes them");
  for (const g of [...withValue].sort((a, b) => b.value - a.value).slice(0, 8)) {
    console.log(`    pick ${String(g.pick).padStart(3)}  ${g.player.name.padEnd(22)} adp ${String(g.player.adpFormatted).padEnd(6)} +${g.value}`);
  }
  console.log("\n  BIGGEST REACHES — taken earliest relative to market");
  for (const g of [...withValue].sort((a, b) => a.value - b.value).slice(0, 8)) {
    console.log(`    pick ${String(g.pick).padStart(3)}  ${g.player.name.padEnd(22)} adp ${String(g.player.adpFormatted).padEnd(6)} ${g.value}`);
  }
}
