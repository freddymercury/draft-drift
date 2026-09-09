import { POSITIONS, HARD_INJURY } from "./types";
import type { Board, Config, FfcResponse, Player, Position, SleeperProjRow } from "./types";
import { DATA, ROOT } from "./paths";
import type { Opts } from "./options";

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Normalize a player name for cross-source matching. */
export function norm(name: string): string {
  return (name ?? "")
    .toLowerCase()
    // collapse whitespace BEFORE stripping punctuation, or newlines vanish and
    // adjacent table rows glue together ("... - WR\nBrock Bowers" -> "wrbrock")
    .replace(/\s+/g, " ")
    .replace(/[^a-z ]/g, "")
    .split(" ")
    .filter((p) => p && !SUFFIXES.has(p))
    .join(" ");
}

const key = (name: string, pos: string) => `${norm(name)}|${pos}`;

type Seed = Omit<
  Player,
  "posRank" | "vor" | "tier" | "adp" | "adpFormatted" | "adpStdev" | "bye" | "overallRank" | "poolRank" | "valueVsAdp" | "flag"
>;

async function readJson<T>(path: string, hint: string): Promise<T> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`missing ${path} — run \`bun run fetch\` (${hint})`);
  return (await file.json()) as T;
}

async function loadProjections(): Promise<Map<string, Seed>> {
  const out = new Map<string, Seed>();
  for (const pos of POSITIONS) {
    const rows = await readJson<SleeperProjRow[]>(`${DATA}/proj_${pos}.json`, "projections");
    for (const row of rows) {
      const pts = row.stats?.pts_half_ppr;
      if (pts == null) continue;
      const p = row.player;
      const name = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || String(row.player_id);
      const k = key(name, pos);
      const prev = out.get(k);
      if (prev && prev.proj >= pts) continue;
      out.set(k, {
        name,
        pos,
        team: row.team ?? p?.team ?? null,
        proj: Math.round(pts * 10) / 10,
        injuryStatus: p?.injury_status ?? null,
        sleeperId: row.player_id,
      });
    }
  }
  return out;
}

/** How many players at each position are league-wide starters. */
export function replacementRanks(cfg: Config): Record<Position, number> {
  const flexTotal = (cfg.roster.FLEX ?? 0) * cfg.teams;
  const out = {} as Record<Position, number>;
  for (const pos of POSITIONS) {
    const starters = (cfg.roster[pos] ?? 0) * cfg.teams + flexTotal * (cfg.flex_split[pos] ?? 0);
    out[pos] = Math.max(1, Math.round(starters) + 1);
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Break a VOR-sorted position list into tiers at unusually large gaps. */
export function assignTiers(players: Player[]): void {
  if (players.length < 3) {
    for (const p of players) p.tier = 1;
    return;
  }
  const gaps = players.slice(0, -1).map((p, i) => p.vor - players[i + 1]!.vor);
  const window = gaps.slice(0, 40);
  const threshold = mean(window) + stdev(window);
  let tier = 1;
  players[0]!.tier = 1;
  for (let i = 1; i < players.length; i++) {
    if (gaps[i - 1]! > threshold) tier++;
    players[i]!.tier = tier;
  }
}

export async function buildBoard(opts: Opts): Promise<Board> {
  const cfg = await readJson<Config>(opts.configPath, "config");
  if (opts.teams != null) cfg.teams = opts.teams;
  const seeds = await loadProjections();
  const adpBlob = await readJson<FfcResponse>(`${DATA}/adp_halfppr.json`, "adp");
  const repl = replacementRanks(cfg);

  const adp = new Map<string, FfcResponse["players"][number]>();
  for (const pl of adpBlob.players) {
    const pos = pl.position === "DST" ? "DEF" : pl.position;
    adp.set(key(pl.name, pos), pl);
  }

  const byPos = new Map<Position, Player[]>(POSITIONS.map((p) => [p, []]));
  for (const s of seeds.values()) {
    byPos.get(s.pos)!.push({
      ...s,
      posRank: 0, vor: 0, tier: 1,
      adp: null, adpFormatted: null, adpStdev: null, bye: null,
      overallRank: 0, poolRank: null, valueVsAdp: null, flag: "",
    });
  }

  const replacementPoints = {} as Record<Position, number>;
  const board: Player[] = [];
  for (const pos of POSITIONS) {
    const lst = byPos.get(pos)!;
    lst.sort((a, b) => b.proj - a.proj);
    replacementPoints[pos] = lst.length ? lst[Math.min(repl[pos], lst.length) - 1]!.proj : 0;
    lst.forEach((p, i) => {
      p.posRank = i + 1;
      p.vor = Math.round((p.proj - replacementPoints[pos]) * 10) / 10;
    });
    assignTiers(lst);
    board.push(...lst);
  }

  for (const p of board) {
    const meta = adp.get(key(p.name, p.pos));
    p.adp = meta?.adp ?? null;
    p.adpFormatted = meta?.adp_formatted ?? null;
    p.bye = meta?.bye ?? null;
    p.adpStdev = meta?.stdev ?? null;
  }

  board.sort((a, b) => b.vor - a.vor);
  board.forEach((p, i) => (p.overallRank = i + 1));

  // Compare like-for-like: my rank among players the market actually drafts, vs
  // their ADP pick. Ranking against all ~630 makes everyone deep on the board
  // look contested, since ADP tops out near pick 180.
  const pool = board.filter((p) => p.adp != null);
  pool.forEach((p, i) => {
    p.poolRank = i + 1;
    p.valueVsAdp = Math.round((p.adp! - (i + 1)) * 10) / 10;
  });

  for (const p of board) {
    const inj = p.injuryStatus && HARD_INJURY.has(p.injuryStatus) ? p.injuryStatus : null;
    // A 15-pick gap in round 2 is a real disagreement; in round 14 it is noise.
    const contested = p.valueVsAdp != null && p.valueVsAdp < -Math.max(15, 0.35 * p.adp!);
    p.flag = [inj ? `**${inj}**` : "", contested ? "market>proj" : ""].filter(Boolean).join(" ");
  }

  return {
    generatedAt: new Date().toISOString(),
    config: cfg,
    adpSource: adpBlob.meta,
    replacementRanks: repl,
    replacementPoints,
    players: board,
  };
}

export function renderMarkdown(b: Board): string {
  const m = b.adpSource;
  const lines = [
    `# Draft Board — ${b.config.scoring}, ${b.config.teams} teams`,
    `_generated ${b.generatedAt} · ADP from ${m?.total_drafts} drafts (${m?.start_date} → ${m?.end_date})_`,
    "",
    "Replacement level: " + POSITIONS.map((p) => `${p}${b.replacementRanks[p]}`).join(", "),
    "",
    "| # | Player | Pos | Tm | Proj | VOR | Tier | ADP | Val | Bye | Flag |",
    "|--:|---|---|---|--:|--:|:-:|--:|--:|--:|---|",
  ];
  for (const p of b.players.filter((x) => x.adp != null).slice(0, 200)) {
    const v = p.valueVsAdp!;
    lines.push(
      `| ${p.poolRank} | ${p.name} | ${p.pos}${p.posRank} | ${p.team ?? ""} | ${p.proj} | ` +
        `${p.vor} | T${p.tier} | ${p.adpFormatted ?? ""} | ${v > 0 ? "+" : ""}${v} | ${p.bye ?? ""} | ${p.flag} |`,
    );
  }
  return lines.join("\n") + "\n";
}

export async function writeBoard(b: Board, opts: Opts): Promise<void> {
  // Label artifacts per config so a mock board never clobbers the real one.
  const sfx = opts.label ? `.${opts.label}` : "";
  const json = `board${sfx}.json`;
  const md = `board${sfx}.md`;
  await Bun.write(`${DATA}/${json}`, JSON.stringify(b, null, 1));
  await Bun.write(`${ROOT}/${md}`, renderMarkdown(b));
  const pool = b.players.filter((p) => p.adp != null).length;
  console.log(`board: ${b.players.length} players, ${pool} with ADP -> data/${json}, ${md}`);
}
