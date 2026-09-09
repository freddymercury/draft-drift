import { basename, isAbsolute, join } from "node:path";
import { DATA, ROOT } from "./paths";

export interface Opts {
  configPath: string;
  /** Mock picks must not pollute the real draft's state, so each config gets its own. */
  statePath: string;
  /** Override config.teams without editing the file — the usual mock/real delta. */
  teams: number | null;
  label: string;
}

export interface Parsed {
  cmd: string;
  rest: string[];
  opts: Opts;
}

export function parseFlags(argv: string[]): Parsed {
  const args = [...argv];
  let configArg = "config.json";
  let teams: number | null = null;
  const rest: string[] = [];

  while (args.length) {
    const a = args.shift()!;
    if (a === "--config" || a === "-c") {
      const v = args.shift();
      if (!v) throw new Error("--config needs a path");
      configArg = v;
    } else if (a === "--teams" || a === "-t") {
      const v = args.shift();
      const n = Number(v);
      if (!v || !Number.isInteger(n) || n < 2) throw new Error("--teams needs an integer >= 2");
      teams = n;
    } else {
      rest.push(a);
    }
  }

  const configPath = isAbsolute(configArg) ? configArg : join(ROOT, configArg);
  const stem = basename(configPath).replace(/\.json$/, "");
  const statePath = join(DATA, stem === "config" ? "state.json" : `state.${stem}.json`);
  const label = stem === "config" ? "" : stem;

  return { cmd: rest.shift() ?? "all", rest, opts: { configPath, statePath, teams, label } };
}
