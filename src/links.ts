import type { Database } from "bun:sqlite";
import { basename } from "node:path";
import { readDigest, readToolUses } from "./transcript";
import { readGit, type GitRunner } from "./git";
export type { GitRunner };

export type GhRunner = (args: string[]) => Promise<string>;

export const defaultGhRunner: GhRunner = async (args: string[]) => {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text;
};


const LINEAR_RE = /\b([A-Z]{2,5}-\d+)\b/g;
const LINEAR_DENYLIST = new Set([
  "GPT", "UTF", "SHA", "RFC", "CVE", "ISO", "HTTP", "HTTPS", "MD", "IPV",
  "AES", "RSA", "SHA1", "SHA256", "UTF8", "PR",
  "ARM", "X86", "WIN", "MAC", "OSX", "AMD", "GB", "MB", "KB", "TB",
]);

const EXPLICIT_PR_RE = /\b([\w][\w-]*)#(\d+)\b/g;
const BARE_PR_RE = /(?<!\w)#(\d+)\b/g;
const PR_CONTEXT_RE = /(?:PR|pull(?:\s+request)?|github\.com\/[^/]+\/[^/]+\/pull)/i;

export function extractPRs(
  text: string,
  cwd: string = "",
  gitRepo: string | null = null
): { repo: string; number: number }[] {
  const cwdRepo = (gitRepo ?? basename(cwd)) || "unknown";
  const results: { repo: string; number: number }[] = [];
  const seen = new Set<string>();

  // Explicit <repo>#<num> — use the repo name from the text
  for (const m of text.matchAll(EXPLICIT_PR_RE)) {
    const repo = m[1];
    const num = parseInt(m[2], 10);
    const key = `${repo}#${num}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ repo, number: num });
    }
  }

  // Bare #<num> — only accept when preceded (within ~12 chars) by a PR context keyword
  for (const m of text.matchAll(BARE_PR_RE)) {
    const num = parseInt(m[1], 10);
    const key = `${cwdRepo}#${num}`;
    if (seen.has(key)) continue;
    const start = Math.max(0, m.index! - 12);
    const prefix = text.slice(start, m.index!);
    if (!PR_CONTEXT_RE.test(prefix)) continue;
    seen.add(key);
    results.push({ repo: cwdRepo, number: num });
  }

  return results;
}

export function extractLinear(text: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(LINEAR_RE)) {
    const ref = m[1];
    const prefix = ref.split("-")[0];
    if (LINEAR_DENYLIST.has(prefix)) continue;
    if (!seen.has(ref)) {
      seen.add(ref);
      results.push(ref);
    }
  }
  return results;
}

export function extractArtifacts(files: string[]): { path: string }[] {
  return files
    .filter(
      f =>
        f.includes("/docs/") ||
        f.endsWith(".md") ||
        f.endsWith(".html")
    )
    .map(path => ({ path }));
}

export function extractArtifactUrls(
  toolUses: { name: string; input: Record<string, unknown> }[],
  text: string
): { url: string; title: string }[] {
  const ARTIFACT_URL_RE = /https:\/\/claude\.ai\/(public\/)?artifacts\/[A-Za-z0-9_-]+/g;
  const seen = new Set<string>();
  const results: { url: string; title: string }[] = [];

  // Scan tool uses where name matches /artifact/i
  for (const tu of toolUses) {
    if (!/artifact/i.test(tu.name)) continue;
    // Check all string values in input for URLs
    const inputTitle =
      typeof tu.input.title === "string" ? tu.input.title :
      typeof tu.input.label === "string" ? tu.input.label : null;
    for (const val of Object.values(tu.input)) {
      if (typeof val !== "string") continue;
      for (const m of val.matchAll(ARTIFACT_URL_RE)) {
        const url = m[0];
        if (!seen.has(url)) {
          seen.add(url);
          results.push({ url, title: inputTitle ?? "Artifact" });
        }
      }
    }
  }

  // Scan full text
  for (const m of text.matchAll(ARTIFACT_URL_RE)) {
    const url = m[0];
    if (!seen.has(url)) {
      seen.add(url);
      results.push({ url, title: "Artifact" });
    }
  }

  return results;
}

export function extractSlackThreads(
  toolUses: { name: string; input: Record<string, unknown> }[]
): { channel: string; thread_ts: string }[] {
  const results: { channel: string; thread_ts: string }[] = [];
  const seen = new Set<string>();
  for (const tu of toolUses) {
    if (!/slack/i.test(tu.name)) continue;
    const ch = String(tu.input.channel ?? tu.input.channel_id ?? "");
    const ts = String(tu.input.thread_ts ?? tu.input.ts ?? "");
    if (!ch || !ts) continue;
    const key = `${ch}:${ts}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ channel: ch, thread_ts: ts });
    }
  }
  return results;
}

export async function syncLinks(
  db: Database,
  sessionId: string,
  gitRunner?: GitRunner
): Promise<void> {
  type SessionRow = {
    cwd: string | null;
    transcript_path: string | null;
    kind: string | null;
  };
  const session = db
    .query("SELECT cwd, transcript_path, kind FROM sessions WHERE id=?")
    .get(sessionId) as SessionRow | null;
  if (!session) return;
  if (session.kind === "worker") return;

  const cwd = session.cwd ?? "";
  const transcriptPath = session.transcript_path ?? "";

  const { repo: gitOwnerRepo, branch: gitBranch } = await readGit(cwd, gitRunner);
  if (gitOwnerRepo !== null || gitBranch !== null) {
    db.run(
      "UPDATE sessions SET git_repo=?, git_branch=? WHERE id=?",
      [gitOwnerRepo, gitBranch, sessionId]
    );
  }
  const gitRepoName = gitOwnerRepo ? (gitOwnerRepo.split("/")[1] ?? null) : null;

  type FileRow = { path: string };
  const files = (
    db
      .query("SELECT path FROM session_files WHERE session_id=?")
      .all(sessionId) as FileRow[]
  ).map(r => r.path);

  const toolUses = transcriptPath ? readToolUses(transcriptPath) : [];

  // Use readDigest with a large cap so all text is available for PR/Linear extraction
  const digestText = transcriptPath ? readDigest(transcriptPath, 1_000_000) : "";
  // Also append cwd and file paths — PR refs sometimes appear in branch names / file comments
  const allText = [digestText, cwd, ...files].join(" ");

  const prs = extractPRs(allText, cwd, gitRepoName);
  const linear = extractLinear(allText);
  const artifacts = extractArtifacts(files);
  const artifactUrls = extractArtifactUrls(toolUses, digestText);
  const slackThreads = extractSlackThreads(toolUses);

  const upsert = db.prepare(
    `INSERT INTO links (session_id, kind, ref) VALUES (?,?,?)
     ON CONFLICT(session_id, kind, ref) DO NOTHING`
  );
  const upsertWithUrl = db.prepare(
    `INSERT INTO links (session_id, kind, ref, url, title) VALUES (?,?,?,?,?)
     ON CONFLICT(session_id, kind, ref) DO NOTHING`
  );

  for (const pr of prs) {
    upsert.run(sessionId, "pr", `${pr.repo}#${pr.number}`);
  }
  for (const ref of linear) {
    upsert.run(sessionId, "linear", ref);
  }
  for (const art of artifacts) {
    upsert.run(sessionId, "artifact", art.path);
  }
  for (const art of artifactUrls) {
    upsertWithUrl.run(sessionId, "artifact", art.url, art.url, art.title);
  }
  for (const slack of slackThreads) {
    const ref = `${slack.channel}:${slack.thread_ts}`;
    upsert.run(sessionId, "slack", ref);

    // If a matching mention exists with no session_id, link it (certain in-session match)
    db.run(
      `UPDATE mentions SET session_id=?
       WHERE channel_id=? AND thread_ts=? AND session_id IS NULL`,
      [sessionId, slack.channel, slack.thread_ts]
    );
  }
}

export async function enrichPRs(db: Database, ghRunner: GhRunner = defaultGhRunner): Promise<void> {
  type LinkRow = { id: number; ref: string; session_id: string | null };
  const rows = db
    .query("SELECT id, ref, session_id FROM links WHERE kind='pr' AND title IS NULL")
    .all() as LinkRow[];

  for (const row of rows) {
    const m = row.ref.match(/^(.+)#(\d+)$/);
    if (!m) continue;
    const [, repoName, numStr] = m;

    if (!row.session_id) continue;
    const sessionRow = db
      .query("SELECT git_repo FROM sessions WHERE id=?")
      .get(row.session_id) as { git_repo: string | null } | null;
    const gitRepo = sessionRow?.git_repo ?? null;
    if (!gitRepo) continue;
    const gitRepoName = gitRepo.split("/")[1] ?? null;
    if (gitRepoName !== repoName) continue;

    const fullRepo = gitRepo;
    try {
      const output = await ghRunner([
        "gh", "pr", "view", numStr,
        "--repo", fullRepo,
        "--json", "title,state,statusCheckRollup",
      ]);
      const data = JSON.parse(output);
      const title = typeof data.title === "string" ? data.title : null;
      const state = typeof data.state === "string" ? data.state : null;
      const checks = Array.isArray(data.statusCheckRollup) ? data.statusCheckRollup : null;
      db.run("UPDATE links SET title=?, meta=? WHERE id=?", [
        title,
        JSON.stringify({ state, checks, fullRepo }),
        row.id,
      ]);
    } catch {
      // best-effort: skip on error
    }
  }
}

export async function runLinks(db: Database): Promise<void> {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  type IdRow = { id: string };
  const sessions = db
    .query(
      `SELECT id FROM sessions
       WHERE kind != 'worker'
         AND status != 'archived'
         AND last_activity > ?`
    )
    .all(cutoff) as IdRow[];

  for (const { id } of sessions) {
    await syncLinks(db, id);
  }
}

if (import.meta.main) {
  const { openDb } = await import("./db");
  const db = openDb();
  console.log("[links] running syncLinks for active sessions...");
  await runLinks(db);
  console.log("[links] done");
}
