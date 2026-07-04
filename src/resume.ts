import type { Database } from "bun:sqlite";
import { readDigest } from "./transcript";
import { summarizeOne, type LlmRunner, type SessionRow } from "./summarizer";

function basename(path: string): string {
  return path.replace(/\/$/, "").split("/").pop() || path;
}

function fileEntry(path: string, cwd: string): string {
  const bn = basename(path);
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : "";

  const cwdSlash = cwd.endsWith("/") ? cwd : cwd + "/";
  if (cwd && path.startsWith(cwdSlash)) {
    const relD = dir.length > cwd.length ? dir.slice(cwdSlash.length) : "";
    return "- " + bn + "  (" + (relD || ".") + ")";
  }
  return "- " + bn + "  (" + path + ")";
}

export function buildResumePrompt(db: Database, sessionId: string): string | null {
  const session = db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId) as Record<string, any> | null;
  if (!session) return null;

  const sections: string[] = [];

  sections.push("You are resuming a prior Claude Code session. Establish context from the notes below, then confirm understanding and continue.");

  sections.push("## Working Directory\n" + (session.cwd || ""));

  // Git repository and branch
  const gitRepo = (session.git_repo as string | null) || "";
  const gitBranch = (session.git_branch as string | null) || "";
  if (gitRepo || gitBranch) {
    const parts: string[] = [];
    if (gitRepo) parts.push(gitRepo);
    if (gitBranch) parts.push("@ " + gitBranch);
    sections.push("## Repository\n" + parts.join(" "));
  }

  if (session.summary) {
    sections.push("## Where we left off\n" + session.summary);
  }

  if (session.summary_next) {
    sections.push("## What remained\n" + session.summary_next);
  }

  const openTasks = db.query(
    "SELECT title, status, blocked_on FROM tasks WHERE session_id = ? AND status NOT IN ('done', 'closed') ORDER BY opened_at DESC"
  ).all(sessionId) as Array<{ title: string; status: string; blocked_on: string | null }>;
  if (openTasks.length > 0) {
    const lines = openTasks.map(task => {
      if (task.status === "blocked" || task.status === "delegated") {
        const blockedNote = task.blocked_on ? " (blocked: " + task.blocked_on + ")" : "";
        return "- [~] " + task.title + blockedNote;
      }
      return "- [ ] " + task.title;
    }).join("\n");
    sections.push("## Open tasks\n" + lines);
  }

  const files = db.query(
    "SELECT path FROM session_files WHERE session_id = ? ORDER BY ts DESC LIMIT 10"
  ).all(sessionId) as Array<{ path: string }>;
  if (files.length > 0) {
    const cwd = session.cwd || "";
    const lines = files.map(f => fileEntry(f.path, cwd)).join("\n");
    sections.push("## Recently touched files\n" + lines);
  }

  // Links table (PR / Linear / Slack refs) — wrapped in try/catch in case table doesn't exist
  let hasSlackLinks = false;
  try {
    const links = db.query(
      "SELECT kind, ref, title FROM links WHERE session_id = ? AND kind IN ('pr','linear','slack') ORDER BY id DESC LIMIT 10"
    ).all(sessionId) as Array<{ kind: string; ref: string; title: string | null }>;
    if (links.length > 0) {
      const prLinks = links.filter(l => l.kind === "pr");
      const linearLinks = links.filter(l => l.kind === "linear");
      const slackLinks = links.filter(l => l.kind === "slack");
      if (slackLinks.length > 0) hasSlackLinks = true;
      const lines: string[] = [];
      for (const l of prLinks) {
        lines.push(l.title ? "- PR: " + l.ref + " — " + l.title : "- PR: " + l.ref);
      }
      for (const l of linearLinks) {
        lines.push("- Linear: " + l.ref);
      }
      for (const l of slackLinks) {
        lines.push("- Slack: " + l.ref);
      }
      sections.push("## Linked references\n" + lines.join("\n"));
    }
  } catch {
    // links table doesn't exist — skip silently
  }

  // Transcript tail
  const transcriptPath = (session.transcript_path as string | null) || "";
  let hasTranscriptTail = false;
  if (transcriptPath) {
    const digest = readDigest(transcriptPath, 2500);
    if (digest) {
      sections.push("## Recent activity\n" + digest);
      hasTranscriptTail = true;
    }
  }

  // Last user prompt — only when no transcript tail
  if (!hasTranscriptTail) {
    const lastPrompt: string | null = session.last_prompt ?? null;
    if (lastPrompt && !lastPrompt.trimStart().startsWith("<")) {
      sections.push("## Last user prompt\n" + lastPrompt);
    }
  }

  // Slack mentions — only when no Slack links already in linked references
  if (!hasSlackLinks) {
    const mentions = db.query(
      "SELECT author, text FROM mentions WHERE resolved = 0 AND (resolved_manual IS NULL OR resolved_manual = 0) AND session_id = ? ORDER BY last_at DESC LIMIT 5"
    ).all(sessionId) as Array<{ author: string; text: string }>;
    if (mentions.length > 0) {
      const lines = mentions.map(m => "- " + m.author + ": " + (m.text || "").slice(0, 120)).join("\n");
      sections.push("## Linked Slack mentions\n" + lines);
    }
  }

  sections.push("\nPlease confirm you have read the above and continue where we left off.");

  return sections.join("\n");
}

export async function buildResumePromptRich(
  db: Database,
  sessionId: string,
  runner: LlmRunner
): Promise<string | null> {
  const session = db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | null;
  if (!session) return null;

  if (!session.summary) {
    try {
      await summarizeOne(db, session, runner);
    } catch {
      // best-effort — ignore errors
    }
  }

  return buildResumePrompt(db, sessionId);
}
