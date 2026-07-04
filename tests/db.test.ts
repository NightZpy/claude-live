import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb, addEvent } from "../src/db";

test("openDb creates schema idempotently with WAL", () => {
  const db = openDb(":memory:");
  const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
  const names = tables.map(t => t.name);
  expect(names).toContain("sessions");
  expect(names).toContain("session_files");
  expect(names).toContain("events");
  openDb(":memory:"); // second open must not throw (idempotent schema)
});

test("sessions insert/select roundtrip", () => {
  const db = openDb(":memory:");
  db.run("INSERT INTO sessions (id, instance, status, started_at, last_activity) VALUES (?,?,?,?,?)",
    ["s1", "personal", "running", 1000, 1000]);
  const row = db.query("SELECT * FROM sessions WHERE id='s1'").get() as any;
  expect(row.instance).toBe("personal");
  expect(row.status).toBe("running");
});

test("addEvent appends", () => {
  const db = openDb(":memory:");
  addEvent(db, "s1", 123, "prompt", "hello");
  const row = db.query("SELECT * FROM events").get() as any;
  expect(row.session_id).toBe("s1");
  expect(row.kind).toBe("prompt");
});

test("tasks table has UNIQUE(session_id, title) constraint", () => {
  const db = openDb(":memory:");
  db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1', 'Fix bug', 'open', 1000)");
  expect(() => {
    db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1', 'Fix bug', 'open', 2000)");
  }).toThrow();
  db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1', 'Other task', 'open', 1000)");
  const count = (db.query("SELECT COUNT(*) as c FROM tasks").get() as any).c;
  expect(count).toBe(2);
});

test("tasks closed_at and opened_at are nullable", () => {
  const db = openDb(":memory:");
  db.run("INSERT INTO tasks (session_id, title) VALUES ('s1', 'Minimal task')");
  const row = db.query("SELECT * FROM tasks WHERE session_id='s1'").get() as any;
  expect(row.status).toBe("open");
  expect(row.opened_at).toBeNull();
  expect(row.closed_at).toBeNull();
});

test("search_fts virtual table exists after openDb", () => {
  const db = openDb(":memory:");
  const row = db.query("SELECT name FROM sqlite_master WHERE name='search_fts'").get();
  expect(row).not.toBeNull();
});

test("FTS row inserted after session insert", () => {
  const db = openDb(":memory:");
  db.run(
    "INSERT INTO sessions (id, instance, status, started_at, last_activity, name, cwd) VALUES ('s1', 'personal', 'running', 1, 1, 'MySession', '/home/user')"
  );
  const rows = db.query("SELECT * FROM search_fts WHERE search_fts MATCH 'MySession'").all() as any[];
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].session_id).toBe("s1");
  expect(rows[0].kind).toBe("session");
});

test("FTS row rebuilt after session update (last_prompt searchable)", () => {
  const db = openDb(":memory:");
  db.run(
    "INSERT INTO sessions (id, instance, status, started_at, last_activity, name) VALUES ('s1', 'personal', 'running', 1, 1, 'MySession')"
  );
  db.run("UPDATE sessions SET last_prompt='debuggingthetrickypart' WHERE id='s1'");
  const rows = db.query("SELECT * FROM search_fts WHERE search_fts MATCH 'debuggingthetrickypart'").all() as any[];
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].session_id).toBe("s1");
  // rebuilt: name still findable, only one row with session content
  const nameRows = db.query("SELECT * FROM search_fts WHERE search_fts MATCH 'MySession'").all() as any[];
  expect(nameRows.length).toBe(1);
});

test("FTS row inserted for session_files and events", () => {
  const db = openDb(":memory:");
  db.run("INSERT INTO sessions (id, instance, status, started_at, last_activity) VALUES ('s1', 'personal', 'running', 1, 1)");
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('s1', '/path/to/myuniquefile.ts', 'Edit', 1)");
  addEvent(db, "s1", 1, "prompt", "xyzuniqueeventdetail");

  const fileRows = db.query("SELECT * FROM search_fts WHERE search_fts MATCH 'myuniquefile'").all() as any[];
  expect(fileRows.length).toBeGreaterThan(0);
  expect(fileRows[0].kind).toBe("file");

  const eventRows = db.query("SELECT * FROM search_fts WHERE search_fts MATCH 'xyzuniqueeventdetail'").all() as any[];
  expect(eventRows.length).toBeGreaterThan(0);
  expect(eventRows[0].kind).toBe("event");
});

test("migration idempotent: second openDb on file DB adds summary_at and tasks", () => {
  const tmp = mkdtempSync(join(tmpdir(), "cl-db-mig-"));
  const path = join(tmp, "test.db");
  const db1 = openDb(path);
  db1.close();
  const db2 = openDb(path);
  const cols = db2.query("PRAGMA table_info(sessions)").all() as any[];
  expect(cols.map((c: any) => c.name)).toContain("summary_at");
  const tables = db2.query("SELECT name FROM sqlite_master WHERE type='table' OR type='shadow'").all() as any[];
  expect(tables.map((t: any) => t.name)).toContain("tasks");
  db2.close();
});
