import { test, expect } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { analyzeSession } from "../src/analyze-session";
import type { LlmRunner } from "../src/summarizer";
import type { Config } from "../src/config";

const FAKE_TRANSCRIPT = "/tmp/cl-analyze-session-test-transcript.jsonl";

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

const CANNED_JSON = JSON.stringify({
  summary: "Working on auth refactor",
  next: "Run tests",
  tasks: [{ title: "Auth module", status: "done" }],
});

function insertSession(
  db: Database,
  id: string,
  summaryAt: number | null = null,
  transcriptPath: string | null = null,
): void {
  db.run(
    `INSERT INTO sessions (id, instance, status, started_at, last_activity, summary_at, transcript_path)
     VALUES (?, 'personal', 'idle', 0, 1, ?, ?)`,
    [id, summaryAt, transcriptPath],
  );
}

test("analyzeSession runs summarizeOne when summary_at is null", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    insertSession(db, "sess-1", null, FAKE_TRANSCRIPT);
    let calls = 0;
    const fakeRunner: LlmRunner = async () => { calls++; return CANNED_JSON; };
    await analyzeSession(db, "sess-1", fakeRunner, Date.now());
    expect(calls).toBeGreaterThan(0);
    const row = db.query("SELECT summary_at FROM sessions WHERE id='sess-1'").get() as any;
    expect(row.summary_at).toBeGreaterThan(0);
  } finally {
    cleanFakeTranscript();
  }
});

test("analyzeSession runs summarizeOne when summary_at is older than 30 min", async () => {
  makeFakeTranscript();
  try {
    const db = openDb(":memory:");
    const now = Date.now();
    const old = now - 31 * 60 * 1000;
    insertSession(db, "sess-2", old, FAKE_TRANSCRIPT);
    let calls = 0;
    const fakeRunner: LlmRunner = async () => { calls++; return CANNED_JSON; };
    await analyzeSession(db, "sess-2", fakeRunner, now);
    expect(calls).toBeGreaterThan(0);
    const row = db.query("SELECT summary_at FROM sessions WHERE id='sess-2'").get() as any;
    expect(row.summary_at).toBeGreaterThan(old);
  } finally {
    cleanFakeTranscript();
  }
});

test("analyzeSession skips when summary_at is within 5 min", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  const recent = now - 2 * 60 * 1000;
  insertSession(db, "sess-3", recent, FAKE_TRANSCRIPT);
  let calls = 0;
  const fakeRunner: LlmRunner = async () => { calls++; return CANNED_JSON; };
  await analyzeSession(db, "sess-3", fakeRunner, now);
  expect(calls).toBe(0);
});

test("analyzeSession never throws on unknown session id", async () => {
  const db = openDb(":memory:");
  let calls = 0;
  const fakeRunner: LlmRunner = async () => { calls++; return "{}"; };
  await expect(analyzeSession(db, "nonexistent", fakeRunner, Date.now())).resolves.toBeUndefined();
  expect(calls).toBe(0);
});

test("analyzeSession extracts in-session deadlines for archived (SessionEnd) target", async () => {
  const path = "/tmp/cl-analyze-session-deadline-test.jsonl";
  writeFileSync(path, JSON.stringify({ type: "user", message: { content: "can you deliver by Friday?" } }) + "\n");
  try {
    const db = openDb(":memory:");
    db.run(
      `INSERT INTO sessions (id, instance, status, started_at, last_activity, summary_at, transcript_path)
       VALUES (?, 'personal', 'archived', 0, 1, NULL, ?)`,
      ["sess-archived", path],
    );
    const dueAt = Date.now() + 86400000;
    let deadlineCalls = 0;
    const fakeRunner: LlmRunner = async (prompt) => {
      deadlineCalls++;
      if (prompt.includes("deadline information")) return JSON.stringify({ due_at: dueAt, estimate_hours: null, title: "Deploy by Friday" });
      return CANNED_JSON;
    };
    await analyzeSession(db, "sess-archived", fakeRunner, Date.now());
    expect(deadlineCalls).toBeGreaterThan(0);
    const row = db.query("SELECT * FROM deadlines WHERE source='in_session'").get() as any;
    expect(row).toBeTruthy();
    expect(row.session_id).toBe("sess-archived");
    expect(row.title).toBe("Deploy by Friday");
  } finally {
    try { unlinkSync(path); } catch {}
  }
});

function baseCfg(overrides: Partial<Config> = {}): Config {
  return { language: "en", port: 7777, instances: [], ...overrides };
}

test("analyzeSession skips all LLM work when llmPaused=true", async () => {
  const db = openDb(":memory:");
  insertSession(db, "sess-paused", null, null);
  let calls = 0;
  const fakeRunner: LlmRunner = async () => { calls++; return "{}"; };
  await analyzeSession(db, "sess-paused", fakeRunner, Date.now(), baseCfg({ llmPaused: true }));
  expect(calls).toBe(0);
});

test("analyzeSession skips all LLM work when daily cap is reached", async () => {
  const db = openDb(":memory:");
  insertSession(db, "sess-cap", null, null);
  const now = Date.now();
  // Fill cap (default 100) — use llmDailyCap:1 and one existing row
  db.run("INSERT INTO llm_calls (ts, kind, ok) VALUES (?,?,?)", [now - 100, "x", 1]);
  let calls = 0;
  const fakeRunner: LlmRunner = async () => { calls++; return "{}"; };
  await analyzeSession(db, "sess-cap", fakeRunner, now, baseCfg({ llmDailyCap: 1 }));
  expect(calls).toBe(0);
});
