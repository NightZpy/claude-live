import { test, expect } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { pickSessions, summarizeOne, runSummarizer, buildRunnerArgs, buildPrompt, type LlmRunner } from "../src/summarizer";
import { DEFAULT_CONFIG } from "../src/config";

const FAKE_TRANSCRIPT = "/tmp/cl-summarizer-test-transcript.jsonl";

function makeFakeTranscript(): void {
  const entries = [
    { type: "user", message: { content: "Please refactor the authentication module to use JWT tokens" } },
    {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "I will start by examining the current auth module structure and then refactor it." }],
      },
    },
    { type: "user", message: { content: "Also make sure to update the tests accordingly" } },
  ];
  writeFileSync(FAKE_TRANSCRIPT, entries.map(e => JSON.stringify(e)).join("\n") + "\n");
}

function cleanFakeTranscript(): void {
  try { unlinkSync(FAKE_TRANSCRIPT); } catch {}
}

function insertSession(
  db: Database,
  fields: {
    id: string;
    kind?: string;
    status?: string;
    last_activity?: number;
    summary_at?: number | null;
    transcript_path?: string | null;
  }
): void {
  db.run(
    `INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, transcript_path, summary_at)
     VALUES (?, 'personal', ?, ?, 1000, ?, ?, ?)`,
    [
      fields.id,
      fields.status ?? "running",
      fields.kind ?? "session",
      fields.last_activity ?? 2000,
      fields.transcript_path ?? null,
      fields.summary_at ?? null,
    ]
  );
}

const CANNED_JSON = JSON.stringify({
  summary: "Working on auth refactor",
  next: "Run tests",
  tasks: [
    { title: "Auth module", status: "done" },
    { title: "Write tests", status: "open" },
  ],
});

const fakeRunner: LlmRunner = async () => CANNED_JSON;
const failRunner: LlmRunner = async () => "not valid json at all !!!";
const throwRunner: LlmRunner = async () => {
  throw new Error("CLI failed");
};

// --- pickSessions ---

test("pickSessions excludes worker sessions", () => {
  const db = openDb(":memory:");
  const now = 1_000_000;
  insertSession(db, { id: "w1", kind: "worker", last_activity: 2000 });
  insertSession(db, { id: "s1", kind: "session", last_activity: 2000 });
  const ids = pickSessions(db, now).map(s => s.id);
  expect(ids).not.toContain("w1");
  expect(ids).toContain("s1");
});

test("pickSessions excludes sessions where last_activity <= summary_at", () => {
  const db = openDb(":memory:");
  const now = 1_000_000;
  // summary_at (1500) > last_activity (1000) → no new activity
  db.run(
    "INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, summary_at) VALUES ('s1', 'p', 'running', 'session', 1, 1000, 1500)"
  );
  const ids = pickSessions(db, now).map(s => s.id);
  expect(ids).not.toContain("s1");
});

test("pickSessions excludes sessions within 10-min debounce window", () => {
  const db = openDb(":memory:");
  const now = 1_000_000;
  const recentSummaryAt = now - 300_000; // summarized 5 min ago
  db.run(
    "INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, summary_at) VALUES ('s1', 'p', 'running', 'session', 1, ?, ?)",
    [now, recentSummaryAt]
  );
  const ids = pickSessions(db, now).map(s => s.id);
  expect(ids).not.toContain("s1");
});

test("pickSessions includes sessions with activity after old summary", () => {
  const db = openDb(":memory:");
  const now = 1_000_000;
  const oldSummaryAt = now - 700_000; // summarized >10 min ago
  db.run(
    "INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, summary_at) VALUES ('s1', 'p', 'running', 'session', 1, ?, ?)",
    [now, oldSummaryAt]
  );
  const ids = pickSessions(db, now).map(s => s.id);
  expect(ids).toContain("s1");
});

test("pickSessions includes never-summarized sessions", () => {
  const db = openDb(":memory:");
  const now = 1_000_000;
  insertSession(db, { id: "s1", last_activity: 2000 });
  const ids = pickSessions(db, now).map(s => s.id);
  expect(ids).toContain("s1");
});

test("pickSessions excludes archived sessions", () => {
  const db = openDb(":memory:");
  const now = 1_000_000;
  insertSession(db, { id: "a1", status: "archived", last_activity: 2000 });
  const ids = pickSessions(db, now).map(s => s.id);
  expect(ids).not.toContain("a1");
});

// --- summarizeOne happy path ---

test("summarizeOne stores summary, next, summary_at on happy path", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, fakeRunner, "es");
    const row = db
      .query("SELECT summary, summary_next, summary_at FROM sessions WHERE id='s1'")
      .get() as any;
    expect(row.summary).toBe("Working on auth refactor");
    expect(row.summary_next).toBe("Run tests");
    expect(row.summary_at).toBeGreaterThan(0);
  } finally {
    cleanFakeTranscript();
  }
});

test("summarizeOne upserts tasks from LLM response", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, fakeRunner, "es");
    const tasks = db
      .query("SELECT * FROM tasks WHERE session_id='s1' ORDER BY id")
      .all() as any[];
    expect(tasks.length).toBe(2);
    expect(tasks[0].title).toBe("Auth module");
    expect(tasks[0].status).toBe("done");
    expect(tasks[1].title).toBe("Write tests");
    expect(tasks[1].status).toBe("open");
  } finally {
    cleanFakeTranscript();
  }
});

test("summarizeOne sets opened_at on new tasks", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, fakeRunner, "es");
    const task = db
      .query("SELECT opened_at FROM tasks WHERE session_id='s1' AND title='Write tests'")
      .get() as any;
    expect(task.opened_at).toBeGreaterThan(0);
  } finally {
    cleanFakeTranscript();
  }
});

// --- done-transition ---

test("summarizeOne sets closed_at when task transitions to done", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    db.run(
      "INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1', 'Auth module', 'open', 1000)"
    );
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, fakeRunner, "es");
    const task = db
      .query("SELECT status, closed_at FROM tasks WHERE session_id='s1' AND title='Auth module'")
      .get() as any;
    expect(task.status).toBe("done");
    expect(task.closed_at).toBeGreaterThan(0);
  } finally {
    cleanFakeTranscript();
  }
});

test("summarizeOne does not overwrite closed_at if task was already done", async () => {
  const alreadyDoneJson = JSON.stringify({
    summary: "Auth done",
    next: "Deploy",
    tasks: [{ title: "Auth module", status: "done" }],
  });
  const doneRunner: LlmRunner = async () => alreadyDoneJson;

  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const originalClosedAt = 9999;
    db.run(
      "INSERT INTO tasks (session_id, title, status, opened_at, closed_at) VALUES ('s1', 'Auth module', 'done', 1000, ?)",
      [originalClosedAt]
    );
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, doneRunner, "es");
    const task = db
      .query("SELECT closed_at FROM tasks WHERE session_id='s1' AND title='Auth module'")
      .get() as any;
    expect(task.closed_at).toBe(originalClosedAt);
  } finally {
    cleanFakeTranscript();
  }
});

// --- parse failure ---

test("parse failure: stores summary_at only, no summary or tasks", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, failRunner, "es");
    const row = db
      .query("SELECT summary, summary_next, summary_at FROM sessions WHERE id='s1'")
      .get() as any;
    expect(row.summary).toBeNull();
    expect(row.summary_next).toBeNull();
    expect(row.summary_at).toBeGreaterThan(0);
    const taskCount = (
      db.query("SELECT COUNT(*) as c FROM tasks WHERE session_id='s1'").get() as any
    ).c;
    expect(taskCount).toBe(0);
  } finally {
    cleanFakeTranscript();
  }
});

test("runner throws: stores summary_at only", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, throwRunner, "es");
    const row = db
      .query("SELECT summary, summary_at FROM sessions WHERE id='s1'")
      .get() as any;
    expect(row.summary).toBeNull();
    expect(row.summary_at).toBeGreaterThan(0);
  } finally {
    cleanFakeTranscript();
  }
});

// --- skip short digest ---

test("summarizeOne skips when digest is too short (< 50 chars)", async () => {
  const db = openDb(":memory:");
  insertSession(db, { id: "s1", transcript_path: "/nonexistent/path/to/nothing.jsonl" });
  const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
  let runnerCalled = false;
  const trackRunner: LlmRunner = async () => {
    runnerCalled = true;
    return CANNED_JSON;
  };
  await summarizeOne(db, session, trackRunner, "es");
  expect(runnerCalled).toBe(false);
  const row = db.query("SELECT summary_at FROM sessions WHERE id='s1'").get() as any;
  expect(row.summary_at).toBeNull();
});

// --- existing tasks preserved ---

test("LLM-absent existing open tasks are preserved", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    db.run(
      "INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1', 'Legacy task', 'open', 1000)"
    );
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, fakeRunner, "es");
    const legacy = db
      .query("SELECT * FROM tasks WHERE session_id='s1' AND title='Legacy task'")
      .get() as any;
    expect(legacy).not.toBeNull();
    expect(legacy.status).toBe("open");
  } finally {
    cleanFakeTranscript();
  }
});

// --- runSummarizer ---

test("runSummarizer returns count of sessions processed", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    db.run(
      "INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, transcript_path) VALUES ('s1', 'p', 'running', 'session', 1, 2000, ?)",
      [FAKE_TRANSCRIPT]
    );
    db.run(
      "INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, transcript_path) VALUES ('s2', 'p', 'running', 'session', 1, 2000, ?)",
      [FAKE_TRANSCRIPT]
    );
    db.run(
      "INSERT INTO sessions (id, instance, status, kind, started_at, last_activity) VALUES ('w1', 'p', 'running', 'worker', 1, 2000)"
    );
    const count = await runSummarizer(db, fakeRunner, "es");
    expect(count).toBe(2);
  } finally {
    cleanFakeTranscript();
  }
});

test("runSummarizer processes sessions sequentially (no real CLI)", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    const order: string[] = [];
    const trackRunner: LlmRunner = async (prompt) => {
      // sessions are processed one at a time (sequential)
      order.push("call");
      return CANNED_JSON;
    };
    db.run(
      "INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, transcript_path) VALUES ('s1', 'p', 'running', 'session', 1, 2000, ?)",
      [FAKE_TRANSCRIPT]
    );
    db.run(
      "INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, transcript_path) VALUES ('s2', 'p', 'running', 'session', 1, 2000, ?)",
      [FAKE_TRANSCRIPT]
    );
    await runSummarizer(db, trackRunner, "es");
    expect(order).toEqual(["call", "call"]);
  } finally {
    cleanFakeTranscript();
  }
});

// --- Fix 1: spawn args ---

test("buildRunnerArgs contains disallowed tools and strict-mcp flags", () => {
  const args = buildRunnerArgs();
  const joined = args.join(" ");
  expect(args[0]).toBe("claude");  // default bin
  expect(args).toContain("--disallowedTools");
  expect(joined).toContain("Bash");
  expect(joined).toContain("Edit");
  expect(joined).toContain("Write");
  expect(args).toContain("--strict-mcp-config");
  expect(args).toContain("--mcp-config");
  const mcpIdx = args.indexOf("--mcp-config");
  expect(JSON.parse(args[mcpIdx + 1])).toEqual({ mcpServers: {} });
});

test("buildRunnerArgs uses custom bin as first element", () => {
  const args = buildRunnerArgs("/abs/path/to/claude");
  expect(args[0]).toBe("/abs/path/to/claude");
  expect(args[1]).toBe("-p");
  expect(args).toContain("--disallowedTools");
  expect(args).toContain("--strict-mcp-config");
});

// --- Fix 2: nonce fence ---

test("buildPrompt uses nonce markers and two calls produce different fences", () => {
  const nonce1 = crypto.randomUUID();
  const nonce2 = crypto.randomUUID();
  const prompt1 = buildPrompt("digest content long enough to matter", "es", nonce1);
  const prompt2 = buildPrompt("digest content long enough to matter", "es", nonce2);
  expect(prompt1).toContain(`<<<DIGEST-${nonce1}>>>`);
  expect(prompt1).toContain(`<<<END-DIGEST-${nonce1}>>>`);
  expect(nonce1).not.toBe(nonce2);
  expect(prompt1).not.toBe(prompt2);
});

// --- Fix 3: task cap ---

test("21st new open task is skipped; existing-title update still works", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    for (let i = 0; i < 20; i++) {
      db.run(
        "INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1', ?, 'open', 1000)",
        [`existing-${i}`]
      );
    }
    const capRunner: LlmRunner = async () =>
      JSON.stringify({
        summary: "cap test",
        next: "next",
        tasks: [
          { title: "brand-new-task", status: "open" },
          { title: "existing-0", status: "in_progress" },
        ],
      });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, capRunner, "es");
    const newTask = db
      .query("SELECT * FROM tasks WHERE session_id='s1' AND title='brand-new-task'")
      .get();
    expect(newTask).toBeNull();
    const updated = db
      .query("SELECT status FROM tasks WHERE session_id='s1' AND title='existing-0'")
      .get() as any;
    expect(updated.status).toBe("in_progress");
  } finally {
    cleanFakeTranscript();
  }
});

test("task title is clamped to 120 characters", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const longTitle = "x".repeat(200);
    const clampRunner: LlmRunner = async () =>
      JSON.stringify({
        summary: "clamp test",
        next: "next",
        tasks: [{ title: longTitle, status: "open" }],
      });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, clampRunner, "es");
    const task = db
      .query("SELECT title FROM tasks WHERE session_id='s1'")
      .get() as any;
    expect(task.title).toBe("x".repeat(120));
  } finally {
    cleanFakeTranscript();
  }
});

test("summarizeOne stores blocked task with blocked_on", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const blockedRunner: LlmRunner = async () =>
      JSON.stringify({
        summary: "Blocked on infra",
        next: "Wait for eng",
        tasks: [{ title: "Deploy to prod", status: "blocked", blocked_on: "infra team" }],
      });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, blockedRunner, "es");
    const task = db
      .query("SELECT status, blocked_on FROM tasks WHERE session_id='s1' AND title='Deploy to prod'")
      .get() as any;
    expect(task.status).toBe("blocked");
    expect(task.blocked_on).toBe("infra team");
  } finally {
    cleanFakeTranscript();
  }
});

test("summarizeOne stores delegated task with blocked_on", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const delegatedRunner: LlmRunner = async () =>
      JSON.stringify({
        summary: "Demo delegated",
        next: "Follow up with Alex",
        tasks: [{ title: "Prepare demo", status: "delegated", blocked_on: "Alex" }],
      });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, delegatedRunner, "es");
    const task = db
      .query("SELECT status, blocked_on FROM tasks WHERE session_id='s1' AND title='Prepare demo'")
      .get() as any;
    expect(task.status).toBe("delegated");
    expect(task.blocked_on).toBe("Alex");
  } finally {
    cleanFakeTranscript();
  }
});

test("summarizeOne coerces unknown status to open", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const weirdRunner: LlmRunner = async () =>
      JSON.stringify({
        summary: "Weird statuses",
        next: "Fix them",
        tasks: [{ title: "Some task", status: "pending", blocked_on: null }],
      });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    await summarizeOne(db, session, weirdRunner, "es");
    const task = db
      .query("SELECT status FROM tasks WHERE session_id='s1' AND title='Some task'")
      .get() as any;
    expect(task.status).toBe("open");
  } finally {
    cleanFakeTranscript();
  }
});

test("tasks table has blocked_on column", () => {
  const db = openDb(":memory:");
  // Insert a task with blocked_on to verify the column exists
  db.run(
    "INSERT INTO tasks (session_id, title, status, blocked_on, opened_at) VALUES ('s1', 'Test task', 'blocked', 'eng', 1000)"
  );
  const row = db.query("SELECT blocked_on FROM tasks WHERE session_id='s1'").get() as any;
  expect(row.blocked_on).toBe("eng");
});

// --- LLM gate ---

test("summarizeOne with llmPaused=true throws LLM_BLOCKED", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    const pausedCfg = { ...DEFAULT_CONFIG, llmPaused: true };
    let threw = false;
    try {
      await summarizeOne(db, session, fakeRunner, "es", pausedCfg);
    } catch (err) {
      threw = true;
      expect(err instanceof Error).toBe(true);
      expect((err as Error).message.startsWith('LLM_BLOCKED:')).toBe(true);
    }
    expect(threw).toBe(true);
  } finally {
    cleanFakeTranscript();
  }
});

test("summarizeOne without cfg does not throw even when runner returns valid JSON", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, { id: "s1", transcript_path: FAKE_TRANSCRIPT });
    const session = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
    // No cfg passed — gate is skipped entirely
    await expect(summarizeOne(db, session, fakeRunner, "es")).resolves.toBeUndefined();
  } finally {
    cleanFakeTranscript();
  }
});

test("runSummarizer stops loop on LLM_BLOCKED and returns partial count", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    db.run(
      "INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, transcript_path) VALUES ('s1', 'p', 'running', 'session', 1, 2000, ?)",
      [FAKE_TRANSCRIPT]
    );
    db.run(
      "INSERT INTO sessions (id, instance, status, kind, started_at, last_activity, transcript_path) VALUES ('s2', 'p', 'running', 'session', 1, 2000, ?)",
      [FAKE_TRANSCRIPT]
    );
    const pausedCfg = { ...DEFAULT_CONFIG, llmPaused: true };
    // With paused cfg, the first session throws LLM_BLOCKED and the loop breaks (count=0)
    const count = await runSummarizer(db, fakeRunner, "es", pausedCfg);
    expect(count).toBe(0);
  } finally {
    cleanFakeTranscript();
  }
});
