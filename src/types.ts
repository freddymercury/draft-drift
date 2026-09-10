export type Sport = "nfl" | "nba";

/**
 * Everything that differs between sports, in one place.
 *
 * The board maths — replacement level, tiers, VOR — is sport-agnostic. What
 * changes is which positions exist, where the numbers come from, and whether a
 * projection is a season total or a per-game rate.
 */
export interface SportProfile {
  sport: Sport;
  positions: readonly string[];
  /** Sleeper's field for fantasy points under this sport's default scoring. */
  pointsField: string;
  /** Sleeper's ADP field, when the sport has one. */
  adpField?: string;
  /** Season totals (NFL) or per-game rates (NBA) — affects nothing but wording. */
  scale: "season" | "per_game";
  /** Football has bye weeks; basketball does not. */
  hasByes: boolean;
  /** Positions worth nothing until the last rounds (kickers, defenses). */
  lateOnly: readonly string[];
  /** Where ADP comes from: FantasyFootballCalculator, or Sleeper's own field. */
  adpSource: "ffc" | "sleeper";
}

export const SPORTS: Record<Sport, SportProfile> = {
  nfl: {
    sport: "nfl",
    positions: ["QB", "RB", "WR", "TE", "K", "DEF"],
    pointsField: "pts_half_ppr",
    scale: "season",
    hasByes: true,
    lateOnly: ["K", "DEF"],
    adpSource: "ffc",
  },
  nba: {
    sport: "nba",
    positions: ["PG", "SG", "SF", "PF", "C"],
    pointsField: "pts_std",
    // No FantasyFootballCalculator equivalent, so ADP comes from Sleeper.
    adpField: "adp_std",
    scale: "per_game",
    hasByes: false,
    lateOnly: [],
    adpSource: "sleeper",
  },
};

export const POSITIONS = SPORTS.nfl.positions;
export type Position = string;

/** "Questionable" is a stale week-level tag in Sleeper's preseason DB — it sits
 *  on fully-projected studs (Nacua, Chase, McCaffrey) and carries no signal. */
export const HARD_INJURY = new Set(["IR", "PUP", "NA", "Out", "Doubtful", "Sus"]);

export interface Config {
  league_name: string;
  league_id: string;
  draft_time: string;
  pick_clock_seconds: number;
  teams: number;
  scoring: string;
  roster: Partial<Record<Position | "BN" | "IR" | "FLEX", number>>;
  flex_eligible: Position[];
  flex_split: Partial<Record<Position, number>>;
  my_draft_slot: number | null;
  /** Pin the NFL season. Omit to resolve it from Sleeper at fetch time. */
  season?: string;
  /** Which sport. Defaults to nfl for every config written before this existed. */
  sport?: Sport;
  scoring_detail?: unknown;
}

export interface SleeperProjRow {
  player_id: string;
  team: string | null;
  stats: Record<string, number> | null;
  player: {
    first_name?: string;
    last_name?: string;
    team?: string | null;
    injury_status?: string | null;
  } | null;
}

export interface FfcPlayer {
  name: string;
  position: string;
  // Nullable because the Sleeper-derived envelope (non-NFL sports) has no bye
  // weeks and does not always carry a team.
  team: string | null;
  adp: number;
  adp_formatted: string;
  stdev: number;
  bye: number | null;
}

export interface FfcResponse {
  meta: { type: string; teams: number; total_drafts: number; start_date: string; end_date: string };
  players: FfcPlayer[];
}

export interface Player {
  name: string;
  pos: Position;
  /** Every position this player is draftable at. One entry outside basketball. */
  eligible: Position[];
  team: string | null;
  proj: number;
  injuryStatus: string | null;
  sleeperId: string;
  posRank: number;
  vor: number;
  tier: number;
  adp: number | null;
  adpFormatted: string | null;
  adpStdev: number | null;
  bye: number | null;
  overallRank: number;
  poolRank: number | null;
  valueVsAdp: number | null;
  flag: string;
}

export interface Board {
  generatedAt: string;
  config: Config;
  adpSource: FfcResponse["meta"] | null;
  replacementRanks: Record<Position, number>;
  replacementPoints: Record<Position, number>;
  players: Player[];
}
