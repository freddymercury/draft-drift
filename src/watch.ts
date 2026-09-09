import { buildBoard } from "./board";
import type { Board } from "./types";
import type { Opts } from "./options";
import { loadState, picksUntilNextTurn } from "./state";
import { readCapture, playersInCapture, ageMinutes, CAPTURE_PATH } from "./parse";
import { readSources } from "./sources";
import { info, warn } from "./log";
import { deriveLeagueFromMarkers, detectPick } from "./yahoo";
import { diffDrafted, appendEvents } from "./events";
import type { DraftEvent } from "./events";
import { saveState } from "./state";
import { recommend, renderRecs, renderRoster } from "./recommend";

/**
 * AgentEyes has no push — it just rewrites ~/.agenteyes/context.json. Poll its
 * mtime so a capture in Chrome prints a shortlist here with no extra keystroke.
 */
const tag = (o: Opts) => (o.label ? `[${o.label}] ` : "");

export async function watch(opts: Opts): Promise<void> {
  const board = await buildBoard(opts);
  let lastSeen = 0;
  console.log(`${tag(opts)}watching ${CAPTURE_PATH} — hit Cmd+Shift+K in Chrome, pick the player list\n`);
  for (;;) {
    const f = Bun.file(CAPTURE_PATH);
    if (await f.exists()) {
      const mtime = f.lastModified;
      if (mtime !== lastSeen) {
        lastSeen = mtime;
        await runOnce(opts, board);
      }
    }
    await Bun.sleep(400);
  }
}

export async function runOnce(opts: Opts, board?: Board): Promise<void> {
  const b = board ?? (await buildBoard(opts));

  // Named watchers win over the one-shot context.json when present — they're
  // the ones that keep themselves current.
  const src = await readSources(b.players);
  const cap = src.pool
    ? { title: src.pool.title, text: src.pool.text, capturedAt: src.pool.capturedAt }
    : await readCapture();
  if (src.filtered) {
    console.log(`\n  ⚠️  ${src.filterReason} — ignoring. Click "All Positions" / clear the search.`);
    return;
  }
  if (!cap) {
    console.error(`no capture at ${CAPTURE_PATH} — is the AgentEyes server running?`);
    return;
  }
  const state = await loadState(opts.statePath);

  // Yahoo's markers beat the hand-entered config. Getting teams or slot wrong
  // silently corrupts every "picks until your turn" figure and all the tier
  // scarcity built on it, and it has been wrong for two mocks running.
  const derived = src.pool ? deriveLeagueFromMarkers(src.pool.text) : null;
  if (derived && (derived.teams !== b.config.teams || derived.slot !== b.config.my_draft_slot)) {
    console.log(
      `  ⚠️  config says ${b.config.teams} teams / slot ${b.config.my_draft_slot}, ` +
        `Yahoo says ${derived.teams} / slot ${derived.slot} — using Yahoo`,
    );
    b.config.teams = derived.teams;
    b.config.my_draft_slot = derived.slot;
  }

  // A roster watcher makes the one remaining manual step go away: we can read
  // what the user actually drafted instead of being told.
  if (src.roster && src.roster.players.length) {
    const before = state.myPicks.join(",");
    const after = src.roster.players.map((p) => p.name).join(",");
    if (before !== after) info("roster", { n: src.roster.players.length, players: src.roster.players.map((p) => p.name) });
    state.myPicks = src.roster.players.map((p) => p.name);
    for (const p of src.roster.players) {
      if (!state.drafted.includes(p.name)) state.drafted.push(p.name);
    }
    await saveState(opts.statePath, state);
  }

  // Derive the pick number from the page instead of making the user run `at`.
  const det = detectPick(cap.title ?? "", cap.text ?? "", b.config.teams, b.config.my_draft_slot);
  if (det) info("pick", { pick: det.pick, via: det.source });
  else warn("pick_undetected", { title: (cap.title ?? "").slice(0, 60) });
  if (det && det.pick !== state.currentPick) {
    state.currentPick = det.pick;
    await saveState(opts.statePath, state);
  }
  const seen = playersInCapture(cap, b.players);

  // Anyone who vanished since the last capture was drafted by someone. This is
  // what removes the manual bookkeeping — no --off calls needed.
  // Persisted rather than in-memory: one-shot `rec` runs must diff too, not
  // just the long-running watcher.
  const prevNames = new Set(state.lastSeen ?? []);
  const prevAvailable = (state.lastSeen ?? []).length
    ? b.players.filter((p) => prevNames.has(p.name))
    : null;
  const { drafted: newlyGone, ignored } = diffDrafted(prevAvailable, seen);
  if (newlyGone.length) {
    const evs: DraftEvent[] = newlyGone.map((p) => ({
      at: new Date().toISOString(),
      type: "drafted" as const,
      player: p.name,
      pos: `${p.pos}${p.posRank}`,
    }));
    await appendEvents(evs);
    info("drafted", { names: newlyGone.map((p) => `${p.name}(${p.pos}${p.posRank})`) });
    for (const p of newlyGone) if (!state.drafted.includes(p.name)) state.drafted.push(p.name);
    await saveState(opts.statePath, state);
  }
  state.lastSeen = seen.map((p) => p.name);
  await saveState(opts.statePath, state);

  const available = seen.filter((p) => !state.drafted.includes(p.name));
  const age = ageMinutes(cap);
  const wait = picksUntilNextTurn(b.config, state.currentPick);

  console.log("\n" + "─".repeat(64));
  if (src.all.length) {
    console.log(
      "  sources: " +
        src.all
          .map((x) => `${x.label}(${x.players.length}${x === src.roster ? " roster" : ""})`)
          .join(", "),
    );
  }
  console.log(
    `capture: ${seen.length} board players found` +
      (age != null ? ` · ${age.toFixed(1)}m old` : "") +
      (age != null && age > 3 ? "  ⚠️ STALE" : "") +
      (det ? ` · pick ${det.pick} auto (${det.source})` : " · pick NOT detected"),
  );
  const mine = b.players.filter((p) => state.myPicks.includes(p.name));
  if (newlyGone.length) {
    console.log(`  drafted since last look: ${newlyGone.map((p) => p.name).join(", ")}`);
  }
  if (ignored) {
    console.log("  (large list change — view/filter switch, not picks)");
    warn("diff_ignored", { reason: "too many vanished at once" });
  }

  // Local turn alert: the one timer that genuinely belongs on this machine.
  if (wait === 0) {
    console.log("\n  *** YOUR PICK — ON THE CLOCK ***\u0007");
  } else if (wait > 0 && wait <= 3) {
    console.log(`\n  *** ${wait} PICK${wait === 1 ? "" : "S"} UNTIL YOUR TURN ***\u0007`);
  }

  console.log("");
  console.log(renderRoster(b.config, mine));
  console.log("");
  const recs = recommend(b, state, available);
  info("shortlist", {
    pick: state.currentPick,
    wait,
    pool: available.length,
    top: recs.slice(0, 3).map((r) => `${r.player.name}:${r.score}`),
  });
  console.log(renderRecs(recs, state, b.config, wait));
}
