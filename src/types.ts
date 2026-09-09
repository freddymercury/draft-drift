export const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type Position = (typeof POSITIONS)[number];

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
  team: string;
  adp: number;
  adp_formatted: string;
  stdev: number;
  bye: number;
}

export interface FfcResponse {
  meta: { type: string; teams: number; total_drafts: number; start_date: string; end_date: string };
  players: FfcPlayer[];
}

export interface Player {
  name: string;
  pos: Position;
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
