import { test, expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { buildDailyDigest, generateDaily, dateKey } from "../src/daily";
import type { LlmRunner } from "../src/summarizer";

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
    archived_reason?: string | null;
  }
): void {
  db.run(
    `INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, name, cwd, summary, archived_reason)
     VALUES (?, 'test', ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      fields.id,
      fields.status ?? "running",
      fields.kind ?? "session",
      fields.last_activity ?? NOW,
      fields.name ?? null,
      fields.cwd ?? null,
      fields.summary ?? null,
      fields.archived_reason ?? null,
    ]
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

test("buildDailyDigest caps at 6000 chars", () => {
  const db = openDb(":memory:");
  for (let i = 0; i < 20; i++) {
    insertSession(db, { id: `s${i}`, name: `session-${i}`, summary: "x".repeat(500), last_activity: NOW });
  }
  const digest = buildDailyDigest(db, NOW);
  expect(digest.length).toBeLessThanOrEqual(6000);
});

test("buildDailyDigest excludes active sessions from before today (midnight boundary)", () => {
  const db = openDb(":memory:");
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  const midnightToday = d.getTime();
  insertSession(db, { id: "s1", name: "before-midnight", last_activity: midnightToday - 1 });
  insertSession(db, { id: "s2", name: "after-midnight", last_activity: midnightToday + 1 });
  const digest = buildDailyDigest(db, NOW);
  expect(digest).not.toContain("before-midnight");
  expect(digest).toContain("after-midnight");
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
