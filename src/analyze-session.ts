import type { Database } from "bun:sqlite";
import { openDb } from "./db";
import { loadConfig } from "./config";
import { summarizeOne, defaultRunner, type LlmRunner, type SessionRow } from "./summarizer";
import { extractInSessionDeadlinesForSession } from "./deadlines";

const DEBOUNCE_MS = 30 * 60 * 1000;

export async function analyzeSession(
  db: Database,
  sessionId: string,
  runner: LlmRunner,
  now: number,
): Promise<void> {
  const session = db.query("SELECT * FROM sessions WHERE id=?").get(sessionId) as (SessionRow & { summary_at: number | null }) | null;
  if (!session) return;

  const summaryAt = session.summary_at ?? 0;
  if (now - summaryAt < DEBOUNCE_MS) return;

  try {
    await summarizeOne(db, session, runner, loadConfig().language);
  } catch {}

  try {
    await extractInSessionDeadlinesForSession(db, sessionId, runner, now);
  } catch {}
}

if (import.meta.main) {
  const sessionId = process.argv[2];
  if (!sessionId) process.exit(0);
  const db = openDb();
  try {
    await analyzeSession(db, sessionId, defaultRunner, Date.now());
  } catch {}
  db.close();
  process.exit(0);
}
