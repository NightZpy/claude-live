/**
 * Fetch assigned Linear issues via MCP and persist them to the DB.
 * Zero LLM. Zero network calls in tests (inject fake fetchFn).
 */
import type { Database } from "bun:sqlite";
import { loadConfig } from "./config";
import { refreshIfNeeded } from "./linear-oauth";
import { mcpInitialize, mcpToolsList, mcpToolsCall, parseToolRows, findMyIssuesTool, buildIssueArgs } from "./mcp-client";
import type { FetchFn } from "./mcp-client";

export type LinearIssueRow = {
  identifier: string;
  title: string;
  url: string;
  state_name: string;
  state_type: string;
  team_key: string;
  priority: number;
  updated_at: string;
  fetched_at: number;
};

const MCP_ENDPOINT = "https://mcp.linear.app/mcp";

// ── DB operations ─────────────────────────────────────────────────────────

export function upsertIssues(db: Database, rows: LinearIssueRow[], runTs: number): void {
  const stmt = db.prepare(
    `INSERT INTO linear_issues
       (identifier, title, url, state_name, state_type, team_key, priority, updated_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(identifier) DO UPDATE SET
       title = excluded.title,
       url = excluded.url,
       state_name = excluded.state_name,
       state_type = excluded.state_type,
       team_key = excluded.team_key,
       priority = excluded.priority,
       updated_at = excluded.updated_at,
       fetched_at = excluded.fetched_at`
  );
  for (const r of rows) {
    stmt.run(
      r.identifier,
      r.title,
      r.url,
      r.state_name,
      r.state_type,
      r.team_key,
      r.priority,
      r.updated_at,
      runTs,
    );
  }
}

export function pruneStaleIssues(db: Database, runTs: number): void {
  db.run("DELETE FROM linear_issues WHERE fetched_at < ?", [runTs]);
}

// ── Fetch + store (deterministic, zero LLM) ──────────────────────────────

export async function fetchAssignedIssues(
  db: Database,
  fetchFn: FetchFn = fetch
): Promise<LinearIssueRow[]> {
  const token = await refreshIfNeeded(fetchFn);
  if (!token) return [];

  const runTs = Date.now();
  let rows: LinearIssueRow[] = [];

  try {
    const session = await mcpInitialize(MCP_ENDPOINT, token, fetchFn);
    const tools = await mcpToolsList(session, fetchFn);
    const tool = findMyIssuesTool(tools);
    if (!tool) return [];

    const args = buildIssueArgs(tool);
    const result = await mcpToolsCall(session, tool.name, args, fetchFn);
    const parsed = parseToolRows(result);

    rows = parsed.map(r => ({ ...r, fetched_at: runTs }));
    upsertIssues(db, rows, runTs);
    // Prune stale only on success
    pruneStaleIssues(db, runTs);
  } catch {
    // Best-effort: on any error, return what we have without pruning
    return [];
  }

  return rows;
}

// ── Config check helper ───────────────────────────────────────────────────

export function hasLinearOAuthToken(): boolean {
  const cfg = loadConfig();
  return typeof cfg.linearAccessToken === "string" && cfg.linearAccessToken.length > 0;
}
