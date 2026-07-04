import type { Database } from "bun:sqlite";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { openDb, addEvent } from "./db";

export type HookPayload = {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name: string;
  prompt?: string;
  message?: string;
  reason?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

export function instanceFromTranscript(p?: string): string {
  const m = p?.match(/\.claude([A-Za-z0-9_-]*)\//);
  if (!m) return "unknown";
  return m[1] ? m[1].replace(/^-/, "") : "personal";
}

export function filePathFromToolInput(toolName?: string, input?: Record<string, unknown>): string | null {
  if (!toolName || !input) return null;
  if (["Edit", "Write", "MultiEdit"].includes(toolName) && typeof input.file_path === "string") return input.file_path;
  if (toolName === "NotebookEdit" && typeof input.notebook_path === "string") return input.notebook_path;
  return null;
}

export function findClaudePid(startPid: number): number | null {
  let pid = startPid;
  for (let i = 0; i < 6; i++) {
    let out = "";
    try {
      out = execFileSync("ps", ["-o", "ppid=,command=", "-p", String(pid)], { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
    if (!out) return null;
    const sp = out.indexOf(" ");
    if (sp < 0) return null;
    const ppid = Number(out.slice(0, sp).trim());
    const command = out.slice(sp + 1).replaceAll("claude-live", "");
    if (/claude/.test(command)) return pid;
    if (!Number.isFinite(ppid) || ppid <= 1) return null;
    pid = ppid;
  }
  return null;
}

const trunc = (s: string | undefined, n: number) => (s ?? "").slice(0, n);

const HOOK_DEBOUNCE_MS = 5 * 60 * 1000;

function spawnAnalysis(db: Database, sessionId: string, now: number): void {
  try {
    // Cheap guard: skip spawn if summarized recently (inner debounce in analyze-session.ts is second line of defense).
    const row = db.query("SELECT summary_at FROM sessions WHERE id=?").get(sessionId) as { summary_at: number | null } | null;
    if (row && typeof row.summary_at === "number" && now - row.summary_at < HOOK_DEBOUNCE_MS) return;
    // process.execPath = absolute bun binary; "bun" alone fails when not on launchd/GUI PATH.
    // Child is best-effort — if reaped, the server's periodic poll is the safety net.
    const proc = Bun.spawn(
      [process.execPath, join(import.meta.dir, "analyze-session.ts"), sessionId],
      {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        env: { ...process.env, CLAUDE_LIVE_IGNORE: "1" },
      },
    );
    proc.unref();
  } catch {}
}

export async function resolvePidIfMissing(
  db: Database,
  sessionId: string,
  hookPid: number,
  resolver: (pid: number) => Promise<number | null> = async (pid) => findClaudePid(pid),
): Promise<void> {
  const row = db.query("SELECT pid FROM sessions WHERE id=?").get(sessionId) as { pid: number | null } | null;
  if (!row || row.pid !== null) return;
  const pid = await resolver(hookPid);
  if (pid !== null) {
    db.run("UPDATE sessions SET pid=? WHERE id=?", [pid, sessionId]);
  }
}

export async function handle(db: Database, p: HookPayload, hookPid: number, sessionKind: string = process.env.CLAUDE_LIVE_SESSION_KIND ?? 'session'): Promise<void> {
  if (!p?.session_id || !p.hook_event_name) return;
  const now = Date.now();
  const instance = instanceFromTranscript(p.transcript_path);
  db.run(
    `INSERT INTO sessions (id, instance, cwd, transcript_path, started_at, last_activity, status, kind)
     VALUES (?,?,?,?,?,?, 'running', ?)
     ON CONFLICT(id) DO UPDATE SET
       last_activity = excluded.last_activity,
       cwd = COALESCE(sessions.cwd, excluded.cwd),
       transcript_path = COALESCE(sessions.transcript_path, excluded.transcript_path)`,
    [p.session_id, instance, p.cwd ?? null, p.transcript_path ?? null, now, now, sessionKind],
  );

  switch (p.hook_event_name) {
    case "SessionStart": {
      const pid = findClaudePid(hookPid);
      db.run(
        "UPDATE sessions SET status='running', pid=?, started_at=COALESCE(started_at, ?), ended_at=NULL, archived_reason=NULL WHERE id=?",
        [pid, now, p.session_id],
      );
      addEvent(db, p.session_id, now, "session_start", p.source ?? "");
      break;
    }
    case "UserPromptSubmit":
      db.run("UPDATE sessions SET status='running', waiting_since=NULL, last_prompt=? WHERE id=?", [
        trunc(p.prompt, 500),
        p.session_id,
      ]);
      addEvent(db, p.session_id, now, "prompt", trunc(p.prompt, 200));
      break;
    case "PostToolUse": {
      db.run("UPDATE sessions SET status='running', waiting_since=NULL WHERE id=?", [p.session_id]);
      const fp = filePathFromToolInput(p.tool_name, p.tool_input);
      if (fp)
        db.run(
          `INSERT INTO session_files (session_id, path, change_kind, ts) VALUES (?,?,?,?)
           ON CONFLICT(session_id, path) DO UPDATE SET ts=excluded.ts, change_kind=excluded.change_kind`,
          [p.session_id, fp, p.tool_name ?? "", now],
        );
      break;
    }
    case "Stop":
      db.run("UPDATE sessions SET status='idle', waiting_since=NULL WHERE id=?", [p.session_id]);
      addEvent(db, p.session_id, now, "stop", "");
      spawnAnalysis(db, p.session_id, now);
      break;
    case "Notification":
      db.run("UPDATE sessions SET status='waiting_input', waiting_since=? WHERE id=?", [now, p.session_id]);
      addEvent(db, p.session_id, now, "waiting", trunc(p.message, 200));
      break;
    case "SessionEnd":
      db.run("UPDATE sessions SET status='archived', ended_at=?, archived_reason=?, waiting_since=NULL WHERE id=?", [
        now,
        p.reason ?? "exit",
        p.session_id,
      ]);
      addEvent(db, p.session_id, now, "session_end", p.reason ?? "");
      spawnAnalysis(db, p.session_id, now);
      break;
  }

  // For events that aren't SessionStart (which sets pid explicitly), resolve pid
  // when it's still NULL — covers sessions that started before hooks were installed.
  if (p.hook_event_name !== "SessionStart") {
    await resolvePidIfMissing(db, p.session_id, hookPid);
  }
}

if (import.meta.main) {
  if (process.env.CLAUDE_LIVE_IGNORE === "1") process.exit(0);
  try {
    const raw = await Bun.stdin.text();
    const payload = JSON.parse(raw) as HookPayload;
    const db = openDb();
    await handle(db, payload, process.ppid);
    db.close();
  } catch {
    // never break a Claude session
  }
  process.exit(0);
}
