import { SPORTS } from "./types";
import type { Sport, SportProfile } from "./types";

/**
 * The active sport, set once from the config and read everywhere else.
 *
 * Module-level mutable state is the honest shape here: this is a CLI that runs
 * one league at a time, and threading a profile through every call site of
 * POSITIONS would be noise. `setSport` is called wherever a config is loaded.
 */
let active: SportProfile = SPORTS.nfl;

export function setSport(s: Sport | undefined): SportProfile {
  active = SPORTS[s ?? "nfl"];
  return active;
}

export function sport(): SportProfile {
  return active;
}

/** Positions for the active sport. Replaces the old NFL-only POSITIONS constant. */
export function positions(): readonly string[] {
  return active.positions;
}

/**
 * Where a sport's fetched data lives. NFL keeps the flat `data/` layout it has
 * always had; other sports get a subdirectory so their player DB and ADP blob
 * don't collide with it.
 */
export function sportDir(base: string): string {
  return active.sport === "nfl" ? base : `${base}/${active.sport}`;
}
