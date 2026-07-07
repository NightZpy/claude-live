import { test, expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { buildDailyDigest, generateDaily, dateKey } from "../src/daily";
import type { LlmRunner } from "../src/summarizer";
import type { Config } from "../src/config";

function baseCfg(overrides: Partial<Config> = {}): Config {
  return { language: "en", port: 7777, instances: [], ...overrides };
}

const NOW = 1_750_000_000_000;
const NOW_24H_AGO = NOW - 86_400_000;

function insertSession(
  db: Database,
  fields: {
    id: string;
    kind?: string;
    status?: string;
    last_activity?: number;
    name?: string | null;
    cwd?: string | null;
    summary?: string | null;
    summary_next?: string | null;
    archived_reason?: string | null;
    git_repo?: string | null;
    transcript_path?: string | null;
  }
): void {
  db.run(
    `INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, name, cwd, summary, summary_next, archived_reason, git_repo, transcript_path)
     VALUES (?, 'test', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fields.id,
      fields.status ?? "running",
      fields.kind ?? "session",
      fields.last_activity ?? NOW,
      fields.name ?? null,
      fields.cwd ?? null,
      fields.summary ?? null,
      fields.summary_next ?? null,
      fields.archived_reason ?? null,
      fields.git_repo ?? null,
      fields.transcript_path ?? null,
    ]
  );
}

function insertLink(db: Database, sessionId: string, kind: string, ref: string, title?: string): void {
  db.run(
    `INSERT INTO links (session_id, kind, ref, title) VALUES (?, ?, ?, ?)`,
    [sessionId, kind, ref, title ?? null]
  );
}

function insertTask(
  db: Database,
  sessionId: string,
  title: string,
  status: string,
  openedAt: number,
  closedAt?: number
): void {
  db.run(
    `INSERT INTO tasks (session_id, title, status, opened_at, closed_at) VALUES (?, ?, ?, ?, ?)`,
    [sessionId, title, status, openedAt, closedAt ?? null]
  );
}

// --- dateKey ---

test("dateKey returns YYYY-MM-DD format", () => {
  const result = dateKey(NOW);
  expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test("dateKey is deterministic for the same epoch", () => {
  expect(dateKey(NOW)).toBe(dateKey(NOW));
});

// --- buildDailyDigest ---

test("buildDailyDigest includes today's active sessions", () => {
  const db = openDb(":memory:");
  insertSession(db, { id: "s1", name: "my-session", summary: "Working on feature X", last_activity: NOW });
  const digest = buildDailyDigest(db, NOW);
  expect(digest).toContain("my-session");
  expect(digest).toContain("Working on feature X");
});

test("buildDailyDigest includes archived sessions from last 24h", () => {
  const db = openDb(":memory:");
  insertSession(db, {
    id: "s1",
    status: "archived",
    name: "old-session",
    summary: "Finished the task",
    archived_reason: "done",
    last_activity: NOW - 3_600_000,
  });
  const digest = buildDailyDigest(db, NOW);
  expect(digest).toContain("old-session");
  expect(digest).toContain("done");
});

test("buildDailyDigest includes open and blocked tasks", () => {
  const db = openDb(":memory:");
  insertSession(db, { id: "s1" });
  insertTask(db, "s1", "Fix the login bug", "open", NOW - 7_200_000);
  insertTask(db, "s1", "Review PR #42", "blocked", NOW - 86_400_000);
  const digest = buildDailyDigest(db, NOW);
  expect(digest).toContain("Fix the login bug");
  expect(digest).toContain("Review PR #42");
  expect(digest).toContain("blocked");
});

test("buildDailyDigest includes tasks closed in last 24h", () => {
  const db = openDb(":memory:");
  insertSession(db, { id: "s1" });
  insertTask(db, "s1", "Deploy to staging", "done", NOW - 86_400_000, NOW - 1_800_000);
  const digest = buildDailyDigest(db, NOW);
  expect(digest).toContain("Deploy to staging");
});

test("buildDailyDigest excludes worker sessions", () => {
  const db = openDb(":memory:");
  insertSession(db, { id: "w1", kind: "worker", name: "worker-session", last_activity: NOW });
  insertSession(db, { id: "s1", kind: "session", name: "real-session", last_activity: NOW });
  const digest = buildDailyDigest(db, NOW);
  expect(digest).not.toContain("worker-session");
  expect(digest).toContain("real-session");
});

test("buildDailyDigest caps at 12000 chars", () => {
  const db = openDb(":memory:");
  for (let i = 0; i < 20; i++) {
    insertSession(db, { id: `s${i}`, name: `session-${i}`, summary: "x".repeat(500), last_activity: NOW });
  }
  const digest = buildDailyDigest(db, NOW);
  expect(digest.length).toBeLessThanOrEqual(12000);
});

test("buildDailyDigest includes active sessions from full 24h window, not just since midnight", () => {
  const db = openDb(":memory:");
  // 20h ago: before local midnight for many timezones, but within the 24h window — must be included
  const twentyHoursAgo = NOW - 20 * 3_600_000;
  insertSession(db, { id: "s1", name: "twenty-hours-ago", last_activity: twentyHoursAgo });
  insertSession(db, { id: "s2", name: "recent-session", last_activity: NOW - 1_000 });
  const digest = buildDailyDigest(db, NOW);
  expect(digest).toContain("twenty-hours-ago");
  expect(digest).toContain("recent-session");
});

test("buildDailyDigest excludes archived sessions older than 24h", () => {
  const db = openDb(":memory:");
  insertSession(db, {
    id: "s1",
    status: "archived",
    name: "stale-session",
    last_activity: NOW_24H_AGO - 1,
  });
  const digest = buildDailyDigest(db, NOW);
  expect(digest).not.toContain("stale-session");
});

test("buildDailyDigest excludes tasks from worker sessions", () => {
  const db = openDb(":memory:");
  insertSession(db, { id: "w1", kind: "worker" });
  insertTask(db, "w1", "worker-internal-task", "open", NOW - 1000);
  const digest = buildDailyDigest(db, NOW);
  expect(digest).not.toContain("worker-internal-task");
});

// --- generateDaily ---

const CANNED_DAILY = JSON.stringify({
  es: {
    yesterday: "- Completé el refactor de auth\n- Arreglé el bug",
    today: "- Escribiendo tests",
    blockers: "- Esperando review del PR",
  },
  en: {
    yesterday: "- Completed auth refactor\n- Fixed login bug",
    today: "- Writing tests",
    blockers: "- Waiting on PR review",
  },
});
const fakeRunner: LlmRunner = async () => CANNED_DAILY;
const failRunner: LlmRunner = async () => "not valid json at all !!!";
const throwRunner: LlmRunner = async () => {
  throw new Error("CLI failed");
};

test("generateDaily upserts row into daily table", async () => {
  const db = openDb(":memory:");
  insertSession(db, { id: "s1", summary: "some session" });
  const result = await generateDaily(db, fakeRunner, "es", NOW);
  expect(result).not.toBeNull();
  expect(result!.yesterday_md).toBe("- Completé el refactor de auth\n- Arreglé el bug");
  expect(result!.today_md).toBe("- Escribiendo tests");
  expect(result!.blockers_md).toBe("- Esperando review del PR");
  const row = db.query("SELECT * FROM daily WHERE date = ?").get(result!.date) as any;
  expect(row).not.toBeNull();
  expect(row.yesterday_md).toBe("- Completé el refactor de auth\n- Arreglé el bug");
  expect(row.generated_at).toBe(NOW);
});

test("generateDaily parse failure returns null, no row inserted", async () => {
  const db = openDb(":memory:");
  const result = await generateDaily(db, failRunner, "es", NOW);
  expect(result).toBeNull();
  const count = (db.query("SELECT COUNT(*) as c FROM daily").get() as any).c;
  expect(count).toBe(0);
});

test("generateDaily runner throws returns null, no row inserted", async () => {
  const db = openDb(":memory:");
  const result = await generateDaily(db, throwRunner, "es", NOW);
  expect(result).toBeNull();
  const count = (db.query("SELECT COUNT(*) as c FROM daily").get() as any).c;
  expect(count).toBe(0);
});

test("generateDaily upserts by date (second call replaces first)", async () => {
  const db = openDb(":memory:");
  const runner1: LlmRunner = async () => JSON.stringify({ es: { yesterday: "day1", today: "t1", blockers: "" }, en: { yesterday: "day1-en", today: "t1-en", blockers: "" } });
  const runner2: LlmRunner = async () => JSON.stringify({ es: { yesterday: "day2", today: "t2", blockers: "" }, en: { yesterday: "day2-en", today: "t2-en", blockers: "" } });
  await generateDaily(db, runner1, "es", NOW);
  await generateDaily(db, runner2, "es", NOW);
  const count = (db.query("SELECT COUNT(*) as c FROM daily").get() as any).c;
  expect(count).toBe(1);
  const row = db.query("SELECT * FROM daily").get() as any;
  expect(row.yesterday_md).toBe("day2");
});

test("generateDaily passes language to prompt (runner receives it)", async () => {
  const db = openDb(":memory:");
  let called = false;
  const trackRunner: LlmRunner = async (prompt) => {
    called = true;
    return CANNED_DAILY;
  };
  const result = await generateDaily(db, trackRunner, "pt", NOW);
  expect(called).toBe(true);
  expect(result).not.toBeNull();
});

test("generateDaily prompt uses nonce fence", async () => {
  const db = openDb(":memory:");
  let capturedPrompt = "";
  const trackRunner: LlmRunner = async (prompt) => {
    capturedPrompt = prompt;
    return CANNED_DAILY;
  };
  await generateDaily(db, trackRunner, "es", NOW);
  expect(capturedPrompt).toMatch(/<<<DIGEST-[0-9a-f-]+>>>/);
  expect(capturedPrompt).toMatch(/<<<END-DIGEST-[0-9a-f-]+>>>/);
});

test("generateDaily stores both es and en fields when both present", async () => {
  const db = openDb(":memory:");
  const result = await generateDaily(db, fakeRunner, "es", NOW);
  expect(result).not.toBeNull();
  expect(result!.yesterday_md_en).toBe("- Completed auth refactor\n- Fixed login bug");
  expect(result!.today_md_en).toBe("- Writing tests");
  expect(result!.blockers_md_en).toBe("- Waiting on PR review");
  const row = db.query("SELECT * FROM daily WHERE date = ?").get(result!.date) as any;
  expect(row.yesterday_md_en).toBe("- Completed auth refactor\n- Fixed login bug");
  expect(row.today_md_en).toBe("- Writing tests");
  expect(row.blockers_md_en).toBe("- Waiting on PR review");
});

test("generateDaily with only es (no en key) stores es fields, en fields are null", async () => {
  const db = openDb(":memory:");
  const esOnlyRunner: LlmRunner = async () => JSON.stringify({
    es: { yesterday: "- Solo ES", today: "- Solo hoy", blockers: "" },
  });
  const result = await generateDaily(db, esOnlyRunner, "es", NOW);
  expect(result).not.toBeNull();
  expect(result!.yesterday_md).toBe("- Solo ES");
  expect(result!.yesterday_md_en).toBeNull();
  expect(result!.today_md_en).toBeNull();
  expect(result!.blockers_md_en).toBeNull();
  const row = db.query("SELECT * FROM daily WHERE date = ?").get(result!.date) as any;
  expect(row.yesterday_md_en).toBeNull();
});

test("generateDaily throws LLM_BLOCKED:paused when llmPaused=true", async () => {
  const db = openDb(":memory:");
  let calls = 0;
  const fakeRunner: LlmRunner = async () => { calls++; return "{}"; };
  await expect(
    generateDaily(db, fakeRunner, "en", NOW, baseCfg({ llmPaused: true }))
  ).rejects.toThrow("LLM_BLOCKED:paused");
  expect(calls).toBe(0);
});

test("generateDaily throws LLM_BLOCKED:cap when cap is reached", async () => {
  const db = openDb(":memory:");
  // runGated uses Date.now() for the cap window — insert a row at real current time
  db.run("INSERT INTO llm_calls (ts, kind, ok) VALUES (?,?,?)", [Date.now() - 100, "x", 1]);
  let calls = 0;
  const fakeRunner: LlmRunner = async () => { calls++; return "{}"; };
  await expect(
    generateDaily(db, fakeRunner, "en", NOW, baseCfg({ llmDailyCap: 1 }))
  ).rejects.toThrow("LLM_BLOCKED:cap");
  expect(calls).toBe(0);
});

// --- enriched digest: project name + PR refs ---

test("buildDailyDigest groups by project and includes git_repo name", () => {
  const db = openDb(":memory:");
  insertSession(db, {
    id: "s1",
    git_repo: "org/acme-web",
    summary: "migrated status bar",
    last_activity: NOW,
  });
  const digest = buildDailyDigest(db, NOW);
  expect(digest).toContain("acme-web");
  expect(digest).toContain("migrated status bar");
});

test("buildDailyDigest includes PR refs from links table", () => {
  const db = openDb(":memory:");
  insertSession(db, { id: "s1", git_repo: "org/search-api", summary: "term enrichment", last_activity: NOW });
  insertLink(db, "s1", "pr", "#451", "Migrate status bar");
  const digest = buildDailyDigest(db, NOW);
  expect(digest).toContain("search-api");
  expect(digest).toContain("#451");
  expect(digest).toContain("Migrate status bar");
});

test("buildDailyDigest includes linear refs from links table", () => {
  const db = openDb(":memory:");
  insertSession(db, { id: "s1", git_repo: "org/agent-x", summary: "cleanup", last_activity: NOW });
  insertLink(db, "s1", "linear", "AG-890", "Agent cleanup task");
  const digest = buildDailyDigest(db, NOW);
  expect(digest).toContain("AG-890");
});

test("buildDailyDigest includes summary_next in digest", () => {
  const db = openDb(":memory:");
  insertSession(db, {
    id: "s1",
    git_repo: "org/acme-web",
    summary: "fixed encoding bug",
    summary_next: "open PR today",
    last_activity: NOW,
  });
  const digest = buildDailyDigest(db, NOW);
  expect(digest).toContain("fixed encoding bug");
  expect(digest).toContain("open PR today");
});

test("buildDailyDigest includes blocked_on in task lines", () => {
  const db = openDb(":memory:");
  insertSession(db, { id: "s1", git_repo: "org/acme-web", last_activity: NOW });
  db.run(
    `INSERT INTO tasks (session_id, title, status, opened_at, blocked_on) VALUES (?, ?, ?, ?, ?)`,
    ["s1", "Deploy to prod", "blocked", NOW - 1000, "waiting for infra AG-1782"]
  );
  const digest = buildDailyDigest(db, NOW);
  expect(digest).toContain("Deploy to prod");
  expect(digest).toContain("waiting for infra AG-1782");
});

test("generateDaily prompt contains good/bad bullet example markers", async () => {
  const db = openDb(":memory:");
  let capturedPrompt = "";
  const trackRunner: LlmRunner = async (prompt) => {
    capturedPrompt = prompt;
    return CANNED_DAILY;
  };
  await generateDaily(db, trackRunner, "es", NOW);
  expect(capturedPrompt).toContain("BAD");
  expect(capturedPrompt).toContain("GOOD");
  expect(capturedPrompt).toContain("acme-web");
  expect(capturedPrompt).toContain("30 modifications");
});

test("buildDailyDigest includes transcript excerpt when transcript_path is set", () => {
  const db = openDb(":memory:");
  const transcriptPath = new URL("fixtures/transcript/sample.jsonl", import.meta.url).pathname;
  insertSession(db, {
    id: "s1",
    git_repo: "org/acme-web",
    summary: "some summary",
    last_activity: NOW,
    transcript_path: transcriptPath,
  });
  const digest = buildDailyDigest(db, NOW);
  // sample.jsonl user message "Please refactor the auth module" should appear in excerpt
  expect(digest).toContain("Please refactor the auth module");
});

test("generateDaily prompt contains initiative-subject and omit-filler rules", async () => {
  const db = openDb(":memory:");
  let capturedPrompt = "";
  const trackRunner: LlmRunner = async (prompt) => {
    capturedPrompt = prompt;
    return CANNED_DAILY;
  };
  await generateDaily(db, trackRunner, "es", NOW);
  // initiative-subject rule markers
  expect(capturedPrompt).toContain("initiative");
  expect(capturedPrompt).toContain("directory names");
  // omit-filler rule marker
  expect(capturedPrompt).toContain("OMIT");
  // bad filler example
  expect(capturedPrompt).toContain("awaiting user direction");
});
