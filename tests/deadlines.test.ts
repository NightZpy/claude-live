import { test, expect } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { upsertDeadline, extractSlackDeadlines, extractInSessionDeadlines, extractPRDeadlines, syncDeadlines } from "../src/deadlines";

test("deadlines table exists with unique(source,ref)", () => {
  const db = openDb(":memory:");
  const cols = (db.query("PRAGMA table_info(deadlines)").all() as any[]).map(c => c.name);
  expect(cols).toContain("due_at");
  expect(cols).toContain("estimate_hours");
  expect(cols).toContain("manual_override");
});

test("upsertDeadline inserts then updates by (source,ref)", () => {
  const db = openDb(":memory:");
  upsertDeadline(db, { source: "linear", ref: "AG-1", title: "First", due_at: 1000 }, 10);
  upsertDeadline(db, { source: "linear", ref: "AG-1", title: "Updated", due_at: 2000 }, 20);
  const rows = db.query("SELECT * FROM deadlines WHERE source='linear' AND ref='AG-1'").all() as any[];
  expect(rows).toHaveLength(1);
  expect(rows[0].title).toBe("Updated");
  expect(rows[0].due_at).toBe(2000);
  expect(rows[0].created_at).toBe(10);
  expect(rows[0].updated_at).toBe(20);
});

test("upsertDeadline never overwrites a manual_override row", () => {
  const db = openDb(":memory:");
  upsertDeadline(db, { source: "slack", ref: "t1", title: "Auto", due_at: 1000 }, 10);
  db.run("UPDATE deadlines SET manual_override=1, title='Hand', due_at=5000 WHERE source='slack' AND ref='t1'");
  upsertDeadline(db, { source: "slack", ref: "t1", title: "Auto2", due_at: 2000 }, 20);
  const row = db.query("SELECT * FROM deadlines WHERE source='slack' AND ref='t1'").get() as any;
  expect(row.title).toBe("Hand");
  expect(row.due_at).toBe(5000);
});

test("extractSlackDeadlines stores a low-confidence slack deadline", async () => {
  const db = openDb(":memory:");
  db.run("INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved) VALUES ('C1','t','Jordan','can you deliver by Friday?','100',1,0)");
  const fake = async () => JSON.stringify({ due_at: 1783900800000, estimate_hours: null, title: "Deliver demo" });
  await extractSlackDeadlines(db, fake, Date.now());
  const row = db.query("SELECT * FROM deadlines WHERE source='slack'").get() as any;
  expect(row.title).toBe("Deliver demo");
  expect(row.confidence).toBe(0.5);
});

test("extractSlackDeadlines skips mentions with no date-ish text (no LLM call)", async () => {
  const db = openDb(":memory:");
  db.run("INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved) VALUES ('C1','t','Jordan','thanks lenyn','100',1,0)");
  let calls = 0;
  await extractSlackDeadlines(db, async () => { calls++; return "{}"; }, Date.now());
  expect(calls).toBe(0);
  expect(db.query("SELECT COUNT(*) c FROM deadlines").get() as any).toMatchObject({ c: 0 });
});

test("extractInSessionDeadlines stores source='in_session' via fake runner", async () => {
  const db = openDb(":memory:");
  const tmpPath = join(tmpdir(), `test-transcript-${Date.now()}.jsonl`);
  writeFileSync(tmpPath, JSON.stringify({ type: "user", message: { content: "can you deliver by Friday?" } }) + "\n");
  db.run("INSERT INTO sessions (id, instance, status, kind, transcript_path) VALUES ('sess-1','test','running','session',?)", [tmpPath]);
  const fake = async () => JSON.stringify({ due_at: 1783900800000, estimate_hours: null, title: "Deliver by Friday" });
  await extractInSessionDeadlines(db, fake, Date.now());
  try { unlinkSync(tmpPath); } catch {}
  const row = db.query("SELECT * FROM deadlines WHERE source='in_session'").get() as any;
  expect(row).toBeTruthy();
  expect(row.ref).toBe("sess-1");
  expect(row.session_id).toBe("sess-1");
  expect(row.confidence).toBe(0.6);
  expect(row.title).toBe("Deliver by Friday");
});

test("extractInSessionDeadlines skips sessions without date hints (no LLM call)", async () => {
  const db = openDb(":memory:");
  const tmpPath = join(tmpdir(), `test-transcript-nd-${Date.now()}.jsonl`);
  writeFileSync(tmpPath, JSON.stringify({ type: "user", message: { content: "hello world" } }) + "\n");
  db.run("INSERT INTO sessions (id, instance, status, kind, transcript_path) VALUES ('sess-2','test','running','session',?)", [tmpPath]);
  let calls = 0;
  await extractInSessionDeadlines(db, async () => { calls++; return "{}"; }, Date.now());
  try { unlinkSync(tmpPath); } catch {}
  expect(calls).toBe(0);
  expect((db.query("SELECT COUNT(*) c FROM deadlines").get() as any).c).toBe(0);
});

test("extractPRDeadlines creates source='pr' null-due rows from seeded links", () => {
  const db = openDb(":memory:");
  db.run("INSERT INTO sessions (id, instance, status, kind) VALUES ('sess-3','test','running','session')");
  db.run("INSERT INTO links (session_id, kind, ref, title) VALUES ('sess-3','pr','github.com/foo/bar/pull/1','Fix bug')");
  extractPRDeadlines(db, Date.now());
  const row = db.query("SELECT * FROM deadlines WHERE source='pr'").get() as any;
  expect(row).toBeTruthy();
  expect(row.ref).toBe("github.com/foo/bar/pull/1");
  expect(row.due_at).toBeNull();
  expect(row.confidence).toBe(0.3);
  expect(row.title).toBe("Fix bug");
  expect(row.session_id).toBe("sess-3");
});

test("syncDeadlines runs all extractors with fakes without throwing", async () => {
  const db = openDb(":memory:");
  // Seed a mentions row and a links row to give extractors something to process
  db.run("INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved) VALUES ('C1','t1','u','due friday','100',1,0)");
  db.run("INSERT INTO links (session_id, kind, ref, url, title) VALUES ('s1','pr','PR-1','http://gh/1','Fix bug')");
  const fakeRunner = async (_prompt: string) => JSON.stringify({ due_at: null, estimate_hours: null, title: "ignored" });
  await syncDeadlines(db, { llmRunner: fakeRunner, linearToken: "" });
  // just verify no exception thrown; PR rows should be created
  const prs = db.query("SELECT * FROM deadlines WHERE source='pr'").all();
  expect(prs.length).toBeGreaterThan(0);
});

test("extractPRDeadlines skips if same-ref deadline already exists", () => {
  const db = openDb(":memory:");
  db.run("INSERT INTO sessions (id, instance, status, kind) VALUES ('sess-4','test','running','session')");
  db.run("INSERT INTO links (session_id, kind, ref, title) VALUES ('sess-4','pr','github.com/foo/bar/pull/2','Feature X')");
  extractPRDeadlines(db, Date.now());
  db.run("UPDATE deadlines SET due_at=9999999 WHERE source='pr' AND ref='github.com/foo/bar/pull/2'");
  extractPRDeadlines(db, Date.now());
  const row = db.query("SELECT * FROM deadlines WHERE source='pr'").get() as any;
  expect(row.due_at).toBe(9999999);
  expect((db.query("SELECT COUNT(*) c FROM deadlines WHERE source='pr'").get() as any).c).toBe(1);
});
