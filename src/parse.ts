import type { Player } from "./types";
import { norm } from "./board";
import { parseRows, matchRows } from "./yahoo";

export interface Capture {
  title?: string;
  url?: string;
  text?: string;
  outerHTML?: string;
  capturedAt?: string;
  elementPicked?: boolean;
}

export const CAPTURE_PATH = `${process.env.HOME}/.agenteyes/context.json`;

export async function readCapture(path = CAPTURE_PATH): Promise<Capture | null> {
  const f = Bun.file(path);
  if (!(await f.exists())) return null;
  return (await f.json()) as Capture;
}

/** Minutes since the capture was taken — AgentEyes has no push, so staleness matters. */
export function ageMinutes(cap: Capture): number | null {
  if (!cap.capturedAt) return null;
  const t = Date.parse(cap.capturedAt);
  return Number.isNaN(t) ? null : (Date.now() - t) / 60_000;
}

/**
 * Find which board players appear in a capture. Yahoo's draft client renders
 * rows like "Ja'Marr Chase CIN - WR", so we match normalized full names as a
 * contiguous token run rather than substring — "Josh Allen" must not match
 * inside "Joshua Allender".
 */
export function playersInCapture(cap: Capture, board: Player[]): Player[] {
  // Yahoo abbreviates first names ("J. Gibbs"), so structural row parsing —
  // name + position + team — is the primary path.
  const rows = parseRows(cap.text ?? "");
  if (rows.length) return matchRows(rows, board).matched;

  // Fallback for any other page shape: whole-name substring match.
  const haystack = ` ${norm(`${cap.text ?? ""} ${cap.outerHTML ?? ""}`)} `;
  return board.filter((p) => {
    const n = norm(p.name);
    return n.length > 3 && haystack.includes(` ${n} `);
  });
}
