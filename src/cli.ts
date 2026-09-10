import { fetchAll } from "./fetch";
import { buildBoard, writeBoard } from "./board";
import { loadState, saveState } from "./state";
import { watch, runOnce } from "./watch";
import { serve } from "./serve";
import { parseFlags } from "./options";
import { setSport } from "./sport";
import type { Sport } from "./types";

const USAGE = `usage: bun run src/cli.ts [--config <path>] [--teams <n>] <command>

commands:
  fetch                 pull fresh projections + ADP
  build                 rebuild board.md / data/board.json
  all                   fetch then build
  watch                 auto-recommend on every AgentEyes capture
  serve                 live web UI on :8766, refreshes itself
  rec                   recommend once from the current capture
  pick [--off] <name>   record a pick (--off = someone else took him)
  at <n>                set the current pick number (no per-pick bookkeeping)
  reset                 clear draft state

flags:
  --config, -c <path>   league config to use (default config.json)
                        each config keeps its own draft state
  --teams,  -t <n>      override config.teams for this run`;

let parsed;
try {
  parsed = parseFlags(Bun.argv.slice(2));
} catch (e) {
  console.error(`${(e as Error).message}\n\n${USAGE}`);
  process.exit(1);
}
const { cmd, rest, opts } = parsed;
const tag = opts.label ? `[${opts.label}] ` : "";

switch (cmd) {
  case "fetch": {
    const cfg = (await Bun.file(opts.configPath).json()) as { season?: string; sport?: Sport };
    setSport(cfg.sport);
    await fetchAll(cfg.season);
    break;
  }
  case "build":
    await writeBoard(await buildBoard(opts), opts);
    break;
  case "all": {
    // Read the config directly; buildBoard would fail here on a first run,
    // before any projections have been fetched.
    const cfg = (await Bun.file(opts.configPath).json()) as { season?: string; sport?: Sport };
    setSport(cfg.sport);
    await fetchAll(cfg.season);
    await writeBoard(await buildBoard(opts), opts);
    break;
  }
  case "serve":
    await serve(opts);
    await new Promise(() => {});
    break;
  case "watch":
    await watch(opts);
    break;
  case "rec":
    await runOnce(opts);
    break;
  case "pick": {
    const mine = rest[0] !== "--off";
    const name = (mine ? rest : rest.slice(1)).join(" ").trim();
    if (!name) {
      console.error(`pick needs a player name\n\n${USAGE}`);
      process.exit(1);
    }
    const board = await buildBoard(opts);
    const hit = board.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!hit) {
      console.error(`no board player matching "${name}"`);
      process.exit(1);
    }
    const s = await loadState(opts.statePath);
    if (mine && !s.myPicks.includes(hit.name)) s.myPicks.push(hit.name);
    if (!s.drafted.includes(hit.name)) s.drafted.push(hit.name);
    s.currentPick += 1;
    await saveState(opts.statePath, s);
    console.log(
      `${tag}${mine ? "YOU" : "off board"}: ${hit.name} (${hit.pos}${hit.posRank}) · now pick ${s.currentPick}`,
    );
    break;
  }
  case "at": {
    // A capture only ever shows *available* players, so picks made by other
    // teams drop out on their own. The only thing that needs correcting after
    // a wait is the pick counter, which drives the snake math.
    const n = Number(rest[0]);
    if (!Number.isInteger(n) || n < 1) {
      console.error(`at needs a pick number, e.g. \`at 30\``);
      process.exit(1);
    }
    const s = await loadState(opts.statePath);
    s.currentPick = n;
    await saveState(opts.statePath, s);
    const cfg = (await buildBoard(opts)).config;
    console.log(`${tag}now at pick ${n} (round ${Math.ceil(n / cfg.teams)})`);
    break;
  }
  case "reset":
    await saveState(opts.statePath, { myPicks: [], drafted: [], currentPick: 1 });
    console.log(`${tag}draft state reset`);
    break;
  default:
    console.error(USAGE);
    process.exit(1);
}
