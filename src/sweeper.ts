import type { Database } from "bun:sqlite";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    if (e?.code === "EPERM") return true; // process exists, no permission — still alive
    return false; // ESRCH or anything else — dead
  }
}

const STALE_MS = 24 * 3600_000;

export function sweep(db: Database): number {
  const now = Date.now();
  let n = 0;
  const rows = db
    .query("SELECT id, pid, last_activity FROM sessions WHERE status != 'archived'")
    .all() as { id: string; pid: number | null; last_activity: number | null }[];
  for (const r of rows) {
    let reason: string | null = null;
    if (r.pid != null && !alive(r.pid)) reason = "process_died";
    else if (r.pid == null && (r.last_activity ?? 0) < now - STALE_MS) reason = "stale";
    if (reason) {
      db.run(
        "UPDATE sessions SET status='archived', archived_reason=?, ended_at=?, waiting_since=NULL WHERE id=?",
        [reason, now, r.id]
      );
      n++;
    }
  }
  return n;
}
