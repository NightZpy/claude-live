import type { Database } from "bun:sqlite";
import { upsertDeadline } from "./deadlines";

// Injectable so tests never hit the real Linear API.
export type LinearRunner = (identifier: string, token: string) => Promise<string>;

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

// Resolve a Linear issue by its human identifier (e.g. "AG-1382") to title + state + dueDate + estimate.
export const defaultLinearRun: LinearRunner = async (identifier: string, token: string) => {
  const query =
    "query($id:String!){ issue(id:$id){ identifier title dueDate estimate state{ name } url } }";
  const res = await fetch(LINEAR_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables: { id: identifier } }),
  });
  return res.text();
};

// Fetch due date and estimate for a single Linear issue ref. Returns null on error or empty token.
export async function fetchLinearDeadline(
  ref: string,
  token: string,
  run: LinearRunner = defaultLinearRun,
): Promise<{ title: string; due_at: number | null; estimate_hours: number | null } | null> {
  if (!token) return null;
  try {
    const raw = await run(ref, token);
    const data = JSON.parse(raw);
    const issue = data?.data?.issue;
    if (!issue || typeof issue.title !== "string") return null;
    const due_at =
      typeof issue.dueDate === "string"
        ? new Date(issue.dueDate + "T00:00:00").getTime()
        : null;
    // 1 Linear story point = 1 hour (placeholder; points don't map directly to hours)
    const estimate_hours = typeof issue.estimate === "number" ? issue.estimate : null;
    return { title: issue.title, due_at, estimate_hours };
  } catch {
    return null;
  }
}

// Sync deadlines for all linear links in the db. Best-effort; skips refs with no due_at and no estimate.
export async function syncLinearDeadlines(
  db: Database,
  token: string,
  run: LinearRunner = defaultLinearRun,
): Promise<void> {
  if (!token) return;
  type LinkRow = { ref: string };
  const rows = db
    .query("SELECT DISTINCT ref FROM links WHERE kind='linear'")
    .all() as LinkRow[];
  const now = Date.now();
  for (const row of rows) {
    const deadline = await fetchLinearDeadline(row.ref, token, run);
    if (!deadline) continue;
    if (deadline.due_at === null && deadline.estimate_hours === null) continue;
    upsertDeadline(
      db,
      {
        source: "linear",
        ref: row.ref,
        title: deadline.title,
        due_at: deadline.due_at,
        estimate_hours: deadline.estimate_hours,
        url: `https://linear.app/issue/${row.ref}`,
        confidence: 1.0,
      },
      now,
    );
  }
}

// Best-effort enrichment: fills title/url/state for `linear` links when a token is set.
// No token → no-op. Any error per-ref is swallowed (never crashes the caller).
export async function enrichLinear(
  db: Database,
  token: string | undefined,
  run: LinearRunner = defaultLinearRun,
): Promise<void> {
  if (!token) return;

  type LinkRow = { id: number; ref: string };
  const rows = db
    .query("SELECT id, ref FROM links WHERE kind='linear' AND title IS NULL")
    .all() as LinkRow[];

  for (const row of rows) {
    try {
      const raw = await run(row.ref, token);
      const data = JSON.parse(raw);
      const issue = data?.data?.issue;
      if (!issue || typeof issue.title !== "string") continue;
      const state = typeof issue?.state?.name === "string" ? issue.state.name : null;
      const url =
        typeof issue.url === "string" ? issue.url : `https://linear.app/issue/${row.ref}`;
      db.run("UPDATE links SET title=?, url=?, meta=? WHERE id=?", [
        issue.title,
        url,
        JSON.stringify({ state }),
        row.id,
      ]);
    } catch {
      // best-effort: skip on error
    }
  }
}
