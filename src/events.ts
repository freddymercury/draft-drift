import type { Player } from "./types";
import { DATA } from "./paths";

export interface DraftEvent {
  at: string;
  type: "drafted" | "pick";
  player?: string;
  pos?: string;
  pick?: number;
}

export const EVENTS_PATH = `${DATA}/events.jsonl`;

export async function appendEvents(events: DraftEvent[]): Promise<void> {
  if (!events.length) return;
  const f = Bun.file(EVENTS_PATH);
  const prev = (await f.exists()) ? await f.text() : "";
  await Bun.write(EVENTS_PATH, prev + events.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

/**
 * Players that vanished between two captures are presumed drafted.
 *
 * The guard matters: Yahoo's list is virtualized and filterable, so scrolling
 * or switching to "Wide Receivers" makes dozens of players disappear at once.
 * A real pick removes one or two. Large deltas are view changes, not picks.
 */
export function diffDrafted(
  prev: Player[] | null,
  next: Player[],
  maxPlausiblePicks = 4,
): { drafted: Player[]; ignored: boolean } {
  if (!prev || !prev.length) return { drafted: [], ignored: false };
  const nextNames = new Set(next.map((p) => p.name));
  const gone = prev.filter((p) => !nextNames.has(p.name));
  if (!gone.length) return { drafted: [], ignored: false };
  if (gone.length > maxPlausiblePicks) return { drafted: [], ignored: true };
  return { drafted: gone, ignored: false };
}
