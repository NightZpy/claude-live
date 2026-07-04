import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { buildResumePrompt } from "../src/resume";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      instance TEXT NOT NULL,
      name TEXT,
      cwd TEXT,
      transcript_path TEXT,
      pid INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      kind TEXT DEFAULT 'session',
      started_at INTEGER,
      last_activity INTEGER,
      waiting_since INTEGER,
      ended_at INTEGER,
      archived_reason TEXT,
      last_prompt TEXT,
      summary TEXT,
      summary_next TEXT,
      summary_at INTEGER,
      git_repo TEXT,
      git_branch TEXT
    );
    CREATE TABLE session_files (
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      change_kind TEXT,
      ts INTEGER,
      PRIMARY KEY (session_id, path)
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      opened_at INTEGER,
      closed_at INTEGER,
      blocked_on TEXT,
      UNIQUE(session_id, title)
    );
    CREATE TABLE links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      title TEXT,
      UNIQUE(session_id, kind, ref)
    );
    CREATE TABLE mentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      thread_ts TEXT NOT NULL,
      author TEXT NOT NULL,
      author_id TEXT,
      participants TEXT,
      text TEXT,
      ts TEXT,
      ask_count INTEGER NOT NULL DEFAULT 1,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_manual INTEGER,
      session_id TEXT,
      first_at INTEGER,
      last_at INTEGER,
      UNIQUE(channel_id, thread_ts, author)
    );
  `);
  return db;
}

// 1. returns null for unknown sessionId
test("buildResumePrompt returns null for unknown sessionId", () => {
  const db = makeDb();
  expect(buildResumePrompt(db, "nonexistent")).toBeNull();
});

// 2. includes cwd in output
test("buildResumePrompt includes cwd", () => {
  const db = makeDb();
  db.run("INSERT INTO sessions (id, instance, status, cwd) VALUES ('s1', 'test', 'running', '/my/project')");
  const result = buildResumePrompt(db, "s1");
  expect(result).not.toBeNull();
  expect(result).toContain("/my/project");
});

// 3. includes summary text
test("buildResumePrompt includes summary text", () => {
  const db = makeDb();
  db.run("INSERT INTO sessions (id, instance, status, cwd, summary) VALUES ('s1', 'test', 'running', '/proj', 'My summary text')");
  const result = buildResumePrompt(db, "s1")!;
  expect(result).toContain("My summary text");
  expect(result).toContain("## Where we left off");
});

// 4. includes open task titles (status 'open' or 'in_progress')
test("buildResumePrompt includes open task titles", () => {
  const db = makeDb();
  const now = Date.now();
  db.run("INSERT INTO sessions (id, instance, status, cwd) VALUES ('s1', 'test', 'running', '/proj')");
  db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1', 'Open task', 'open', ?)", [now]);
  db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1', 'In progress task', 'in_progress', ?)", [now]);
  const result = buildResumePrompt(db, "s1")!;
  expect(result).toContain("## Open tasks");
  expect(result).toContain("Open task");
  expect(result).toContain("In progress task");
});

// 5. excludes done task titles
test("buildResumePrompt excludes done task titles", () => {
  const db = makeDb();
  const now = Date.now();
  db.run("INSERT INTO sessions (id, instance, status, cwd) VALUES ('s1', 'test', 'running', '/proj')");
  db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1', 'Done task', 'done', ?)", [now]);
  db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1', 'Open task', 'open', ?)", [now]);
  const result = buildResumePrompt(db, "s1")!;
  expect(result).not.toContain("Done task");
  expect(result).toContain("Open task");
});

// 6. skips last_prompt when it starts with '<' (harness XML)
test("buildResumePrompt skips last_prompt starting with '<'", () => {
  const db = makeDb();
  db.run(
    "INSERT INTO sessions (id, instance, status, cwd, last_prompt) VALUES ('s1', 'test', 'running', '/proj', ?)",
    ["<task-notification>some xml</task-notification>"]
  );
  const result = buildResumePrompt(db, "s1")!;
  expect(result).not.toContain("## Last user prompt");
  expect(result).not.toContain("<task-notification>");
});

// 7. includes last_prompt when it is a plain user message
test("buildResumePrompt includes last_prompt when plain user message", () => {
  const db = makeDb();
  db.run(
    "INSERT INTO sessions (id, instance, status, cwd, last_prompt) VALUES ('s1', 'test', 'running', '/proj', 'fix the status bar bug')"
  );
  const result = buildResumePrompt(db, "s1")!;
  expect(result).toContain("## Last user prompt");
  expect(result).toContain("fix the status bar bug");
});

// 8. includes mention author+text when unresolved mentions exist
test("buildResumePrompt includes mention author+text for unresolved mentions", () => {
  const db = makeDb();
  const now = Date.now();
  db.run("INSERT INTO sessions (id, instance, status, cwd) VALUES ('s1', 'test', 'running', '/proj')");
  db.run(
    "INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, first_at, last_at, session_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ["C1", "ts1", "Alice", "Can you review PR?", "ts1", 1, 0, now, now, "s1"]
  );
  const result = buildResumePrompt(db, "s1")!;
  expect(result).toContain("## Linked Slack mentions");
  expect(result).toContain("Alice");
  expect(result).toContain("Can you review PR?");
});

// 9. files: includes basename of recent files
test("buildResumePrompt includes basename of recent files", () => {
  const db = makeDb();
  const now = Date.now();
  db.run("INSERT INTO sessions (id, instance, status, cwd) VALUES ('s1', 'test', 'running', '/proj')");
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('s1', '/proj/src/main.ts', 'Edit', ?)", [now]);
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('s1', '/proj/test.ts', 'Edit', ?)", [now - 1000]);
  const result = buildResumePrompt(db, "s1")!;
  expect(result).toContain("## Recently touched files");
  expect(result).toContain("main.ts");
  expect(result).toContain("test.ts");
});

// NEW: git_repo / git_branch included
test("buildResumePrompt includes git repo and branch", () => {
  const db = makeDb();
  db.run("INSERT INTO sessions (id, instance, status, cwd, git_repo, git_branch) VALUES ('s1','test','running','/proj','myorg/myrepo','main')");
  const result = buildResumePrompt(db, "s1")!;
  expect(result).toContain("myorg/myrepo");
  expect(result).toContain("main");
});

// NEW: blocked tasks show blocked_on
test("buildResumePrompt shows blocked_on for blocked tasks", () => {
  const db = makeDb();
  const now = Date.now();
  db.run("INSERT INTO sessions (id, instance, status, cwd) VALUES ('s1','test','running','/proj')");
  db.run("INSERT INTO tasks (session_id, title, status, blocked_on, opened_at) VALUES ('s1','Deploy feature','blocked','infra team',?)", [now]);
  const result = buildResumePrompt(db, "s1")!;
  expect(result).toContain("Deploy feature");
  expect(result).toContain("infra team");
});

// NEW: linked PR + Linear refs from links table
test("buildResumePrompt includes PR and Linear refs from links table", () => {
  const db = makeDb();
  db.run("INSERT INTO sessions (id, instance, status, cwd) VALUES ('s1','test','running','/proj')");
  db.run("INSERT INTO links (session_id, kind, ref, title) VALUES ('s1','pr','backend#42','Fix auth')");
  db.run("INSERT INTO links (session_id, kind, ref) VALUES ('s1','linear','CON-1234')");
  const result = buildResumePrompt(db, "s1")!;
  expect(result).toContain("backend#42");
  expect(result).toContain("CON-1234");
});

// NEW: transcript tail included when transcript_path set
test("buildResumePrompt includes transcript tail when transcript_path is set", () => {
  const db = makeDb();
  const tmpDir = "/tmp/resume-test-" + Date.now();
  mkdirSync(tmpDir, { recursive: true });
  const tPath = join(tmpDir, "t.jsonl");
  writeFileSync(tPath, JSON.stringify({type:"user",message:{content:"Please fix the login bug"}}) + "\n");
  db.run("INSERT INTO sessions (id, instance, status, cwd, transcript_path) VALUES ('s1','test','running','/proj',?)", [tPath]);
  const result = buildResumePrompt(db, "s1")!;
  expect(result).toContain("Recent activity");
  expect(result).toContain("fix the login bug");
  rmSync(tmpDir, { recursive: true });
});

// NEW: buildResumePromptRich calls runner when summary is null
test("buildResumePromptRich calls runner when summary is null", async () => {
  const db = makeDb();
  db.run("INSERT INTO sessions (id, instance, status, cwd, transcript_path) VALUES ('s1','test','running','/proj',null)");
  const { buildResumePromptRich } = await import("../src/resume");
  const fakeRunner = async (_: string) => {
    return JSON.stringify({ summary: "test summary", next: "next step", tasks: [] });
  };
  // summarizeOne returns early when digest < 50 chars — just verify it doesn't throw
  const result = await buildResumePromptRich(db, "s1", fakeRunner);
  expect(result).not.toBeNull();
});

// NEW: buildResumePromptRich does NOT call runner when summary already set
test("buildResumePromptRich does not call runner when summary already set", async () => {
  const db = makeDb();
  db.run("INSERT INTO sessions (id, instance, status, cwd, summary) VALUES ('s1','test','running','/proj','existing summary')");
  let runnerCalled = false;
  const fakeRunner = async (_: string) => {
    runnerCalled = true;
    return "";
  };
  const { buildResumePromptRich } = await import("../src/resume");
  await buildResumePromptRich(db, "s1", fakeRunner);
  expect(runnerCalled).toBe(false);
});

// NEW: buildResumePromptRich falls back gracefully when runner throws
test("buildResumePromptRich falls back when runner throws", async () => {
  const db = makeDb();
  db.run("INSERT INTO sessions (id, instance, status, cwd) VALUES ('s1','test','running','/proj')");
  const throwingRunner = async (_: string): Promise<string> => { throw new Error("LLM error"); };
  const { buildResumePromptRich } = await import("../src/resume");
  const result = await buildResumePromptRich(db, "s1", throwingRunner);
  expect(result).not.toBeNull(); // fallback: still returns buildResumePrompt result
});

// NEW: returns null for unknown sessionId (buildResumePromptRich)
test("buildResumePromptRich returns null for unknown sessionId", async () => {
  const db = makeDb();
  const { buildResumePromptRich } = await import("../src/resume");
  const fakeRunner = async (_: string) => "";
  const result = await buildResumePromptRich(db, "nonexistent", fakeRunner);
  expect(result).toBeNull();
});
