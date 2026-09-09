import { appendFileSync, mkdirSync } from "node:fs";
import { ROOT } from "./paths";

/**
 * This tool fails silently — every bug found in testing produced confident
 * wrong output, never an exception. So the log records what was *understood*
 * from each capture, not merely that one arrived: parse yield, position mix,
 * roster contents, and the names we failed to match. Those are the four places
 * a silent failure actually shows itself.
 */

export type Level = "info" | "warn" | "error";

export interface LogEvent {
  t: string;
  level: Level;
  event: string;
  [k: string]: unknown;
}

const stamp = new Date().toISOString().slice(0, 10);
const LOG_DIR = `${ROOT}/logs`;
const JSONL = `${LOG_DIR}/draft-${stamp}.jsonl`;
const TEXT = `${LOG_DIR}/draft-${stamp}.log`;

mkdirSync(LOG_DIR, { recursive: true });

function human(e: LogEvent): string {
  const { t, level, event, ...rest } = e;
  const tag = level === "info" ? " " : level === "warn" ? "!" : "X";
  // One event must stay one line, or grep and tail stop being useful.
  const clean = (v: unknown) => String(v).replace(/\s+/g, " ").trim().slice(0, 120);
  const detail = Object.entries(rest)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.map(clean).join("|")}]` : clean(v)}`)
    .join(" ");
  return `${t.slice(11, 19)} ${tag} ${event.padEnd(16)} ${detail}\n`;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const e: LogEvent = { t: new Date().toISOString(), level, event, ...fields };
  try {
    // Synchronous on purpose: one-shot `rec` runs exit immediately, and an
    // async write loses the very events worth having.
    appendFileSync(JSONL, JSON.stringify(e) + "\n");
    appendFileSync(TEXT, human(e));
  } catch {
    // logging must never break a draft
  }
}

export const info = (event: string, f?: Record<string, unknown>) => log("info", event, f);
export const warn = (event: string, f?: Record<string, unknown>) => log("warn", event, f);
export const error = (event: string, f?: Record<string, unknown>) => log("error", event, f);
