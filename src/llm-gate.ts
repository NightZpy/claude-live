import { Database } from "bun:sqlite";
import type { Config } from "./config";

export function logLlmCall(
  db: Database,
  kind: string,
  model: string | null,
  durationMs: number,
  ok: boolean
): void {
  db.run(
    "INSERT INTO llm_calls (ts, kind, model, duration_ms, ok) VALUES (?,?,?,?,?)",
    [Date.now(), kind, model, durationMs, ok ? 1 : 0]
  );
}

export function llmAllowed(
  db: Database,
  cfg: Config,
  now: number
): { allowed: boolean; reason?: "paused" | "cap" } {
  if (cfg.llmPaused === true) return { allowed: false, reason: "paused" };
  const startOfToday = now - (now % 86400000);
  const row = db.query("SELECT COUNT(*) as cnt FROM llm_calls WHERE ts > ?").get(startOfToday) as { cnt: number };
  if (row.cnt >= (cfg.llmDailyCap ?? 100)) return { allowed: false, reason: "cap" };
  return { allowed: true };
}

export async function runGated(
  db: Database,
  cfg: Config,
  kind: string,
  runnerFn: () => Promise<string>
): Promise<string> {
  const result = llmAllowed(db, cfg, Date.now());
  if (!result.allowed) throw new Error("LLM_BLOCKED:" + result.reason);
  const start = Date.now();
  try {
    const output = await runnerFn();
    logLlmCall(db, kind, null, Date.now() - start, true);
    return output;
  } catch (err) {
    logLlmCall(db, kind, null, Date.now() - start, false);
    throw err;
  }
}
