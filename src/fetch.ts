import { POSITIONS } from "./types";
import type { FfcResponse } from "./types";
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
  try {
    const res = await fetch("https://api.sleeper.app/v1/state/nfl", {
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
    "could not determine the NFL season from Sleeper. " +
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
  const SEASON = await resolveSeason(seasonOverride);
  console.log(`-- season ${SEASON}${seasonOverride ? " (from config)" : " (from Sleeper)"}`);
  console.log("-- Sleeper projections (half-PPR)");
  for (const pos of POSITIONS) {
    const url =
      `https://api.sleeper.app/projections/nfl/${SEASON}` +
      `?season_type=regular&position[]=${pos}&order_by=pts_half_ppr`;
    const rows = (await grab(url, `${DATA}/proj_${pos}.json`, pos)) as unknown[];
    console.log(`   ${pos}: ${rows.length} rows`);
  }

  console.log("-- Sleeper player DB (injury status, depth chart)");
  await grab("https://api.sleeper.app/v1/players/nfl", `${DATA}/sleeper_players.json`, "players");

  console.log("-- FantasyFootballCalculator half-PPR ADP");
  // NOTE: the `teams` param is ignored by FFC — 10- and 12-team return
  // byte-identical ADP. Treat this as generic market consensus.
  const adp = (await grab(
    `https://fantasyfootballcalculator.com/api/v1/adp/half-ppr?teams=12&year=${SEASON}`,
    `${DATA}/adp_halfppr.json`,
    "adp",
  )) as FfcResponse;
  const m = adp.meta;
  console.log(`   ${m.total_drafts} drafts, ${m.start_date} -> ${m.end_date}`);
}
