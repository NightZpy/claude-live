import type { Database } from "bun:sqlite";
import { basename } from "node:path";

export type ProjectDetail = {
  sessions: (SessionRow & { file_count: number; mentions_open: number })[];
  tasks: any[];
  mentions: any[];
  prs: any[];
};

export type SessionRow = {
  id: string;
  git_repo: string | null;
  cwd: string | null;
  status: string;
  kind: string | null;
  last_activity: number | null;
  ended_at: number | null;
  waiting_since: number | null;
  summary: string | null;
};

export type ProjectSummary = {
  key: string;
  name: string;
  sessions_active: number;
  sessions_waiting: number;
  sessions_archived_today: number;
  last_activity: number | null;
  open_tasks: number;
  blocked_tasks: number;
  mentions_open: number;
  prs_open: number;
  latest_summary: string | null;
};

/** Derives the project key for a session. */
export function projectKeyForSession(session: { git_repo: string | null; cwd: string | null }): string {
  if (session.git_repo) {
    const parts = session.git_repo.split("/");
    return parts[parts.length - 1] || session.git_repo;
  }
  if (session.cwd) {
    const b = basename(session.cwd);
    if (b) return b;
  }
  return "(sin proyecto)";
}

type AggRow = SessionRow & {
  open_tasks: number;
  blocked_tasks: number;
  mentions_open: number;
};

type ProjectAccum = {
  sessions_active: number;
  sessions_waiting: number;
  sessions_archived_today: number;
  last_activity: number | null;
  open_tasks: number;
  blocked_tasks: number;
  mentions_open: number;
  // for latest_summary: track the summary from the most recently active non-archived session
  best_activity: number;
  latest_summary: string | null;
  // collect non-archived session ids for per-project PR dedup query
  session_ids: string[];
};

/** Returns one ProjectSummary per project, sorted: waiting first, then by last_activity DESC. */
export function listProjects(db: Database, now: number): ProjectSummary[] {
  const startOfDay = now - (now % 86400000);

  const rows = db.query(`
    SELECT
      s.id,
      s.git_repo,
      s.cwd,
      s.status,
      s.kind,
      s.last_activity,
      s.ended_at,
      s.waiting_since,
      s.summary,
      COALESCE((
        SELECT COUNT(*) FROM tasks t
        WHERE t.session_id = s.id AND t.status IN ('open','in_progress')
      ), 0) AS open_tasks,
      COALESCE((
        SELECT COUNT(*) FROM tasks t
        WHERE t.session_id = s.id AND t.status = 'blocked'
      ), 0) AS blocked_tasks,
      COALESCE((
        SELECT COUNT(*) FROM mentions m
        WHERE m.session_id = s.id
          AND m.resolved = 0
          AND (m.resolved_manual IS NULL OR m.resolved_manual = 0)
      ), 0) AS mentions_open
    FROM sessions s
    WHERE s.kind IS NULL OR s.kind != 'worker'
  `).all() as AggRow[];

  const byKey = new Map<string, ProjectAccum>();

  for (const row of rows) {
    const key = projectKeyForSession(row);

    if (!byKey.has(key)) {
      byKey.set(key, {
        sessions_active: 0,
        sessions_waiting: 0,
        sessions_archived_today: 0,
        last_activity: null,
        open_tasks: 0,
        blocked_tasks: 0,
        mentions_open: 0,
        best_activity: 0,
        latest_summary: null,
        session_ids: [],
      });
    }
    const g = byKey.get(key)!;

    // Track max last_activity across all sessions (including archived)
    if (row.last_activity !== null) {
      if (g.last_activity === null || row.last_activity > g.last_activity) {
        g.last_activity = row.last_activity;
      }
    }

    if (row.status === "archived") {
      if (row.ended_at !== null && row.ended_at >= startOfDay) {
        g.sessions_archived_today++;
      }
      // Archived sessions do not contribute to task/mention/pr counts
      continue;
    }

    // Non-archived sessions
    g.session_ids.push(row.id);

    if (row.status === "waiting_input") {
      g.sessions_waiting++;
    } else {
      g.sessions_active++;
    }

    g.open_tasks += row.open_tasks;
    g.blocked_tasks += row.blocked_tasks;
    g.mentions_open += row.mentions_open;

    // latest_summary from most-recently-active non-archived session
    const act = row.last_activity ?? 0;
    if (act > g.best_activity) {
      g.best_activity = act;
      g.latest_summary = row.summary ?? null;
    }
  }

  // Count distinct PR refs per project (across all non-archived sessions)
  const prsOpen = new Map<string, number>();
  for (const [key, g] of byKey.entries()) {
    if (g.session_ids.length === 0) {
      prsOpen.set(key, 0);
      continue;
    }
    const placeholders = g.session_ids.map(() => "?").join(",");
    const countRow = db.query(
      `SELECT COUNT(DISTINCT ref) AS n FROM links WHERE kind='pr' AND session_id IN (${placeholders})`
    ).get(...g.session_ids) as { n: number } | null;
    prsOpen.set(key, countRow?.n ?? 0);
  }

  // Build result list
  const result: ProjectSummary[] = [];
  for (const [key, g] of byKey.entries()) {
    result.push({
      key,
      name: key,
      sessions_active: g.sessions_active,
      sessions_waiting: g.sessions_waiting,
      sessions_archived_today: g.sessions_archived_today,
      last_activity: g.last_activity,
      open_tasks: g.open_tasks,
      blocked_tasks: g.blocked_tasks,
      mentions_open: g.mentions_open,
      prs_open: prsOpen.get(key) ?? 0,
      latest_summary: g.latest_summary,
    });
  }

  // Sort: waiting first, then by last_activity DESC
  result.sort((a, b) => {
    const aWaiting = a.sessions_waiting > 0 ? 0 : 1;
    const bWaiting = b.sessions_waiting > 0 ? 0 : 1;
    if (aWaiting !== bWaiting) return aWaiting - bWaiting;
    return (b.last_activity ?? 0) - (a.last_activity ?? 0);
  });

  return result;
}

/** Returns sessions, tasks, mentions, and PR links for a single project key. */
export function projectDetail(db: Database, key: string): ProjectDetail | null {
  type DetailRow = SessionRow & { file_count: number; mentions_open: number };

  const allRows = db.query(`
    SELECT s.*,
      COALESCE((SELECT COUNT(*) FROM session_files f WHERE f.session_id = s.id), 0) AS file_count,
      COALESCE((SELECT COUNT(*) FROM mentions m
        WHERE m.session_id = s.id
          AND m.resolved = 0
          AND (m.resolved_manual IS NULL OR m.resolved_manual = 0)), 0) AS mentions_open
    FROM sessions s
    WHERE s.kind IS NULL OR s.kind != 'worker'
    ORDER BY CASE s.status
      WHEN 'waiting_input' THEN 0
      WHEN 'running' THEN 1
      WHEN 'idle' THEN 2
      ELSE 3
    END, s.last_activity DESC
  `).all() as DetailRow[];

  const sessions = allRows.filter(s => projectKeyForSession(s) === key);
  if (sessions.length === 0) return null;

  const nonArchivedIds = sessions
    .filter(s => s.status !== "archived")
    .map(s => s.id);

  if (nonArchivedIds.length === 0) {
    return { sessions, tasks: [], mentions: [], prs: [] };
  }

  const ph = nonArchivedIds.map(() => "?").join(",");

  const tasks = db.query(
    `SELECT * FROM tasks WHERE session_id IN (${ph})
     ORDER BY CASE status
       WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'open' THEN 2
       ELSE 3 END, opened_at DESC`
  ).all(...nonArchivedIds);

  const mentions = db.query(
    `SELECT * FROM mentions
     WHERE session_id IN (${ph})
       AND resolved = 0
       AND (resolved_manual IS NULL OR resolved_manual = 0)
     ORDER BY last_at DESC`
  ).all(...nonArchivedIds);

  const prs = db.query(
    `SELECT ref, title, meta, url FROM links
     WHERE kind = 'pr' AND session_id IN (${ph})
     GROUP BY ref`
  ).all(...nonArchivedIds);

  return { sessions, tasks, mentions, prs };
}
