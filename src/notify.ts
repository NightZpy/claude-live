import type { Database } from "bun:sqlite";

export type NotifyRunner = (args: string[]) => void | Promise<void>;

export const osascriptRunner: NotifyRunner = (args: string[]) => {
  Bun.spawn(["osascript", ...args], { stdout: "ignore", stderr: "ignore" });
};

export function notify(
  title: string,
  body: string,
  runner: NotifyRunner = osascriptRunner
): void | Promise<void> {
  // JSON.stringify produces a valid AppleScript string literal — no shell injection possible
  return runner(["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`]);
}

// Module-level map tracking last notified waiting_since per session id.
// Injectable via _state parameter for test isolation.
const _notifiedWaitingSince = new Map<string, number>();

type WaitRow = { id: string; name: string | null; summary: string | null; waiting_since: number; kind: string | null };

export function checkNotifications(
  db: Database,
  notifyFn: (title: string, body: string) => void = (t, b) => notify(t, b),
  _state: Map<string, number> = _notifiedWaitingSince
): void {
  const waiting = db.query(
    "SELECT id, name, summary, waiting_since, kind FROM sessions WHERE status='waiting_input' AND kind != 'worker' AND waiting_since IS NOT NULL"
  ).all() as WaitRow[];

  const waitingIds = new Set(waiting.map(r => r.id));
  // Clean up stale entries
  for (const id of _state.keys()) {
    if (!waitingIds.has(id)) _state.delete(id);
  }

  for (const row of waiting) {
    if (_state.get(row.id) === row.waiting_since) continue; // already notified for this episode
    _state.set(row.id, row.waiting_since);
    const title = row.name || row.id;
    const body = row.summary ? row.summary.slice(0, 100) : "waiting for input";
    notifyFn(title, body);
  }
}
