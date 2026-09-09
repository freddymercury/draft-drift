import { parseRows, matchRows } from "./yahoo";
import type { Player } from "./types";
import { readdir } from "node:fs/promises";
import { info, warn } from "./log";

const WATCH_DIR = `${process.env.HOME}/.agenteyes/watch`;

export interface Source {
  watchId: string;
  label: string;
  title: string;
  capturedAt: string;
  text: string;
  players: Player[];
}

const POOL_STATE = `${process.env.HOME}/.agenteyes/watch/.pool-high-water`;

/**
 * Yahoo's search box filters the watched element down to matches, so a pool
 * that suddenly collapses is a search — not ninety players being drafted at
 * once. Keep a high-water mark and reject captures far below it.
 */
function isSinglePosition(players: { pos: string }[]): boolean {
  // Yahoo's position tabs ("Running Backs") narrow the list to one position.
  // That is never what a real draft pool looks like past the first round.
  if (players.length < 10) return false;
  const first = players[0]!.pos;
  return players.every((p) => p.pos === first);
}

async function isFilteredView(count: number): Promise<boolean> {
  const f = Bun.file(POOL_STATE);
  const high = (await f.exists()) ? Number(await f.text()) || 0 : 0;
  if (count > high) {
    await Bun.write(POOL_STATE, String(count));
    return false;
  }
  // a real draft drains the pool slowly; a search cuts it to a handful
  return high >= 30 && count < high * 0.5;
}

export interface Sources {
  /** The available-players list — the big one. */
  pool: Source | null;
  /** The user's own roster pane, if they're watching it. */
  roster: Source | null;
  /** The user's queue, if they're watching it — their own stated priority. */
  queue: Source | null;
  all: Source[];
  /** True when the pool looked filtered (search or position tab) and was rejected. */
  filtered: boolean;
  filterReason: string;
  /**
   * The filtered view itself. Rejected as *the pool*, but not worthless — if
   * someone has filtered to kickers, the best available kickers are very
   * likely what they want to know.
   */
  filteredView: Source | null;
}

/**
 * Read every named watcher and work out what each one is.
 *
 * Label wins when it says so, since the user names them; otherwise the pool is
 * simply whichever watcher yields the most player rows.
 */
export async function readSources(board: Player[]): Promise<Sources> {
  let files: string[] = [];
  try {
    files = (await readdir(WATCH_DIR)).filter((f) => f.endsWith(".json") && f !== "latest.json");
  } catch {
    return { pool: null, roster: null, queue: null, all: [], filtered: false, filterReason: "", filteredView: null };
  }

  // A watcher whose page has gone leaves its file behind — the in-page timer
  // dies with the tab, so no tombstone is sent and nothing cleans up. Without
  // an age check, recommendations keep being made from a board frozen at
  // whatever the page last showed.
  const MAX_AGE_SECONDS = 600;

  const all: Source[] = [];
  for (const f of files) {
    const data = (await Bun.file(`${WATCH_DIR}/${f}`).json()) as Record<string, string>;
    const text = data.text ?? "";
    const rows = parseRows(text);
    const { matched, missed } = matchRows(rows, board);

    // Parse yield is the tell for silent breakage: the roster pane read 0 for
    // an hour because a header line was eaten as a player. Log rows-vs-matched
    // and the names we dropped, so that shows up instead of hiding.
    const posMix: Record<string, number> = {};
    for (const m of matched) posMix[m.pos] = (posMix[m.pos] ?? 0) + 1;
    const label = data.label ?? f;
    info("capture", {
      w: label,
      chars: text.length,
      rows: rows.length,
      matched: matched.length,
      pos: Object.entries(posMix).map(([k, v]) => `${k}:${v}`).join(",") || "none",
    });
    if (missed.length) {
      warn("unmatched", { w: label, n: missed.length, names: missed.slice(0, 6).map((r) => r.raw) });
    }
    if (rows.length && matched.length === 0) {
      warn("parse_yield_zero", { w: label, rows: rows.length });
    }

    const ageSeconds = data.capturedAt
      ? (Date.now() - Date.parse(String(data.capturedAt))) / 1000
      : Number.POSITIVE_INFINITY;
    if (ageSeconds > MAX_AGE_SECONDS) {
      warn("watcher_abandoned", { w: data.label ?? f, ageMinutes: Math.round(ageSeconds / 60) });
      continue;
    }

    all.push({
      watchId: data.watchId ?? f,
      label,
      title: data.title ?? "",
      capturedAt: data.capturedAt ?? "",
      text,
      players: matched,
    });
  }

  const byLabel = (re: RegExp) => all.find((s) => re.test(s.label));
  // Content first, then the label. A watcher keeps an auto-generated name when
  // the user skips the naming prompt, and the roster pane is unmistakable in
  // its own text — Yahoo heads it "YOUR TEAM (4/15)".
  const roster =
    all.find((s) => /your team\s*\(/i.test(s.text)) ??
    byLabel(/roster|my team|my squad/i) ??
    null;
  // The queue is small and ordered; the label is the only reliable signal,
  // since its rows look exactly like the pool's.
  const queue = all.find((s) => s !== roster && /queue/i.test(s.label)) ?? null;
  let pool =
    byLabel(/player|available|pool|board/i) ??
    all.filter((s) => s !== roster && s !== queue).sort((a, b) => b.players.length - a.players.length)[0] ??
    null;

  if (!roster) warn("no_roster_watcher", { watchers: all.map((s) => s.label) });

  let filtered = false;
  let filterReason = "";
  let filteredView: Source | null = null;
  if (pool && isSinglePosition(pool.players)) {
    filtered = true;
    filterReason = `list is filtered to ${pool.players[0]!.pos} only`;
    warn("pool_filtered", { reason: filterReason, n: pool.players.length });
    filteredView = pool;
    pool = null;
  } else if (pool && (await isFilteredView(pool.players.length))) {
    filtered = true;
    filterReason = "list looks search-filtered";
    warn("pool_filtered", { reason: filterReason, n: pool.players.length });
    filteredView = pool;
    pool = null;
  }

  return { pool, roster, queue, all, filtered, filterReason, filteredView };

}
