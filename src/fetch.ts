import { POSITIONS } from "./types";
import type { FfcResponse } from "./types";
import { DATA } from "./paths";

const SEASON = "2026";

async function grab(url: string, dest: string, label: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} for ${url}`);
  const body = await res.json();
  await Bun.write(dest, JSON.stringify(body));
  return body;
}

/** Pull fresh projections + ADP + player DB. Safe to re-run right up to draft time. */
export async function fetchAll(): Promise<void> {
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
