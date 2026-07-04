import type { Database } from "bun:sqlite";

export interface SearchResult {
  session: Record<string, unknown>;
  snippet: string;
  matched_kind: string;
}

const FTS_STRIP = /["':*()\-,]/g;

export function sanitizeQ(q: string): string {
  return q.replace(FTS_STRIP, " ").replace(/\s+/g, " ").trim();
}

export function search(db: Database, q: string): SearchResult[] {
  const clean = sanitizeQ(q);
  if (!clean) return [];

  const matchQ = clean + "*";

  let rows: Array<{ session_id: string; matched_kind: string; snippet: string }>;
  try {
    rows = db.query(`
      SELECT session_id, kind AS matched_kind,
             snippet(search_fts, 2, '[', ']', '…', 10) AS snippet
      FROM search_fts
      WHERE search_fts MATCH ?
      ORDER BY bm25(search_fts)
      LIMIT 90
    `).all(matchQ) as Array<{ session_id: string; matched_kind: string; snippet: string }>;
  } catch {
    return [];
  }

  const seen = new Map<string, { matched_kind: string; snippet: string }>();
  for (const m of rows) {
    if (!seen.has(m.session_id)) {
      seen.set(m.session_id, { matched_kind: m.matched_kind, snippet: m.snippet ?? "" });
    }
    if (seen.size >= 30) break;
  }

  if (seen.size === 0) return [];

  const ids = [...seen.keys()];
  const ph = ids.map(() => "?").join(",");
  const sessions = db.query(
    `SELECT * FROM sessions WHERE id IN (${ph})`
  ).all(...ids) as Record<string, unknown>[];

  const sessionMap = new Map(sessions.map(s => [s.id as string, s]));

  return ids
    .map(sid => {
      const meta = seen.get(sid)!;
      const session = sessionMap.get(sid);
      if (!session) return null;
      return { session, snippet: meta.snippet, matched_kind: meta.matched_kind };
    })
    .filter((r): r is SearchResult => r !== null);
}
