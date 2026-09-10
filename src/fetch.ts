import type { FfcResponse, SleeperProjRow } from "./types";
import { positions, sport, sportDir } from "./sport";
import { DATA } from "./paths";

/**
 * Resolve the season instead of hardcoding it.
 *
 * A pinned year fails silently rather than loudly: come next August the
 * projection endpoints still answer for a stale season, so the board builds
 * from the wrong data with no error. Sleeper already publishes which season
 * leagues are drafting for.
 */
export async function resolveSeason(override?: string): Promise<string> {
  if (override) return override;
  const sp = sport().sport;
  try {
    const res = await fetch(`https://api.sleeper.app/v1/state/${sp}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const st = (await res.json()) as { league_season?: string; season?: string };
      // league_season is the season leagues are drafting for; during the
      // offseason it leads `season`, which still points at the year just played.
      const s = st.league_season ?? st.season;
      if (s && /^\d{4}$/.test(s)) return s;
    }
  } catch {
    // fall through to the error below
  }
  throw new Error(
    `could not determine the ${sp.toUpperCase()} season from Sleeper. ` +
      'Set "season" in your config to override, e.g. "season": "2027".',
  );
}

async function grab(url: string, dest: string, label: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} for ${url}`);
  const body = await res.json();
  await Bun.write(dest, JSON.stringify(body));
  return body;
}

/** Pull fresh projections + ADP + player DB. Safe to re-run right up to draft time. */
export async function fetchAll(seasonOverride?: string): Promise<void> {
  const sp = sport();
  const dir = sportDir(DATA);
  const SEASON = await resolveSeason(seasonOverride);
  console.log(`-- ${sp.sport} season ${SEASON}${seasonOverride ? " (from config)" : " (from Sleeper)"}`);
  console.log(`-- Sleeper projections (${sp.pointsField}, ${sp.scale === "season" ? "season totals" : "per game"})`);
  const groups: Array<{ pos: string; rows: SleeperProjRow[] }> = [];
  for (const pos of positions()) {
    const url =
      `https://api.sleeper.app/projections/${sp.sport}/${SEASON}` +
      `?season_type=regular&position[]=${pos}&order_by=${sp.pointsField}`;
    const rows = (await grab(url, `${dir}/proj_${pos}.json`, pos)) as SleeperProjRow[];
    const scored = rows.filter((r) => r.stats?.[sp.pointsField] != null).length;
    console.log(`   ${pos}: ${rows.length} rows, ${scored} with ${sp.pointsField}`);
    if (!scored) {
      console.log(
        `   !! no ${sp.pointsField} for ${pos} in ${SEASON} — that season is probably` +
          ` not published yet. Pin an earlier one with "season" in your config.`,
      );
    }
    groups.push({ pos, rows });
  }

  console.log("-- Sleeper player DB (injury status, depth chart)");
  await grab(`https://api.sleeper.app/v1/players/${sp.sport}`, `${dir}/sleeper_players.json`, "players");

  if (sp.adpSource === "ffc") {
    console.log("-- FantasyFootballCalculator half-PPR ADP");
    // NOTE: the `teams` param is ignored by FFC — 10- and 12-team return
    // byte-identical ADP. Treat this as generic market consensus.
    const adp = (await grab(
      `https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?teams=12&year=${SEASON}`,
      `${dir}/adp_halfppr.json`,
      "adp",
    )) as FfcResponse;
    const m = adp.meta;
    console.log(`   ${m.total_drafts} drafts, ${m.start_date} -> ${m.end_date}`);
  } else {
    // FFC is football-only. Sleeper carries ADP on the projection rows
    // themselves, so reshape those into the same envelope the board reads.
    console.log(`-- Sleeper ADP (${sp.adpField})`);
    const blob = adpFromProjections(groups, SEASON);
    await Bun.write(`${dir}/adp_halfppr.json`, JSON.stringify(blob));
    console.log(`   ${blob.players.length} players with ${sp.adpField}`);
  }
}

/** Reshape Sleeper projection rows into the FFC envelope the board expects. */
export function adpFromProjections(
  groups: Array<{ pos: string; rows: SleeperProjRow[] }>,
  season: string,
): FfcResponse {
  const sp = sport();
  const field = sp.adpField;
  const players = groups
    .flatMap(({ pos, rows }) =>
      rows.map((r) => {
        const adp = field ? r.stats?.[field] : null;
        if (adp == null) return null;
        const p = r.player;
        const name = `${p?.first_name ?? ""} ${p?.last_name ?? ""}`.trim() || String(r.player_id);
        // The position comes from the query, not the row: Sleeper's projection
        // payload does not repeat it, and a multi-position player is returned
        // once per eligible slot anyway.
        return {
          name,
          position: pos,
          team: r.team ?? p?.team ?? null,
          adp,
          adp_formatted: String(adp),
          stdev: 0,
          bye: null,
        };
      }),
    )
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => a.adp - b.adp);
  return {
    meta: {
      type: `sleeper_${field}`,
      teams: 0,
      total_drafts: 0,
      start_date: season,
      end_date: season,
    },
    players,
  };
}
