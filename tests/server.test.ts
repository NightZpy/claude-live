import { test, expect, afterAll, beforeEach, afterEach, describe } from "bun:test";
import { openDb } from "../src/db";
import { createServer } from "../src/server";
import { dateKey } from "../src/daily";
import { writeFileSync, unlinkSync, mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveConfig, DEFAULT_CONFIG } from "../src/config";

const TMP_DIR = join(tmpdir(), "claude-live-test-" + process.pid);
mkdirSync(TMP_DIR, { recursive: true });
const TMP_TEXT  = join(TMP_DIR, "hello.txt");
const TMP_BIN   = join(TMP_DIR, "data.bin");
const TMP_LARGE = join(TMP_DIR, "large.bin");
const TMP_PNG   = join(TMP_DIR, "img.png");
const TMP_JSON  = join(TMP_DIR, "pkg.json");
writeFileSync(TMP_TEXT, "hello world\n", "utf8");
writeFileSync(TMP_BIN, Buffer.from([0x00, 0x01, 0x02, 0x03]));
writeFileSync(TMP_LARGE, Buffer.alloc(262145, 65)); // 262145 bytes, just over the 262144 limit
writeFileSync(TMP_PNG, Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])); // PNG magic
writeFileSync(TMP_JSON, '{"name":"test","version":"1.0.0"}', "utf8");

afterAll(() => {
  try { unlinkSync(TMP_TEXT); } catch {}
  try { unlinkSync(TMP_BIN); } catch {}
  try { unlinkSync(TMP_LARGE); } catch {}
  try { unlinkSync(TMP_PNG); } catch {}
  try { unlinkSync(TMP_JSON); } catch {}
});

function seed(db: any) {
  const now = Date.now();
  db.run("INSERT INTO sessions (id, instance, status, cwd, started_at, last_activity) VALUES ('run1','personal','running','/p/a',?,?)", [now - 60000, now]);
  db.run("INSERT INTO sessions (id, instance, status, cwd, started_at, last_activity, waiting_since) VALUES ('wait1','work','waiting_input','/p/b',?,?,?)", [now - 120000, now, now - 30000]);
  db.run("INSERT INTO sessions (id, instance, status, cwd, started_at, last_activity, ended_at, archived_reason) VALUES ('arch1','personal','archived','/p/c',?,?,?, 'exit')", [now - 500000, now - 100000, now - 100000]);
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('run1','/p/a/x.ts','Edit',?)", [now]);
  db.run("INSERT INTO events (session_id, ts, kind, detail) VALUES ('run1',?,'prompt','hola')", [now]);
}

test("api/sessions groups and orders", async () => {
  const db = openDb(":memory:");
  seed(db);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions`);
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.active.map((s: any) => s.id)).toEqual(["wait1", "run1"]);
  expect(body.archived.map((s: any) => s.id)).toEqual(["arch1"]);
  expect(body.active.find((s: any) => s.id === "run1").file_count).toBe(1);
  srv.stop();
});

test("api/sessions/:id detail and 404", async () => {
  const db = openDb(":memory:");
  seed(db);
  const srv = createServer(db, { port: 0 });
  const d = await (await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1`)).json() as any;
  expect(d.session.id).toBe("run1");
  expect(d.files).toHaveLength(1);
  expect(d.events[0].detail).toBe("hola");
  expect((await fetch(`http://127.0.0.1:${srv.port}/api/sessions/nope`)).status).toBe(404);
  srv.stop();
});

test("serves index.html at /", async () => {
  const db = openDb(":memory:");
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("<html");
  srv.stop();
});

test("static assets serve and expose CDP contract", async () => {
  const db = openDb(":memory:");
  const srv = createServer(db, { port: 0 });
  const html = await (await fetch(`http://127.0.0.1:${srv.port}/`)).text();
  expect(html).toContain('id="search"');
  expect(html).toContain('id="sessions"');
  expect(html).toContain('id="detail"');
  const js = await (await fetch(`http://127.0.0.1:${srv.port}/app.js`)).text();
  expect(js).toContain("I18N");
  const css = await (await fetch(`http://127.0.0.1:${srv.port}/style.css`)).text();
  expect(css.length).toBeGreaterThan(100);
  srv.stop();
});

test("rejects non-local Host headers (dns rebinding)", async () => {
  const db = openDb(":memory:");
  seed(db);
  const srv = createServer(db, { port: 0 });
  const evil = await fetch(`http://127.0.0.1:${srv.port}/api/sessions`, {
    headers: { Host: "evil.example" },
  });
  expect(evil.status).toBe(403);
  const ok = await fetch(`http://127.0.0.1:${srv.port}/api/sessions`);
  expect(ok.status).toBe(200);
  srv.stop();
});

test("file endpoint: 400 when path param missing", async () => {
  const db = openDb(":memory:");
  seed(db);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1/file`);
  expect(res.status).toBe(400);
  srv.stop();
});

test("file endpoint: 404 when path not in allowlist", async () => {
  const db = openDb(":memory:");
  seed(db);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1/file?path=${encodeURIComponent("/etc/passwd")}`);
  expect(res.status).toBe(404);
  srv.stop();
});

test("file endpoint: serves text file when path is in allowlist", async () => {
  const db = openDb(":memory:");
  seed(db);
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('run1', ?, 'Edit', ?)", [TMP_TEXT, Date.now()]);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1/file?path=${encodeURIComponent(TMP_TEXT)}`);
  expect(res.status).toBe(200);
  const ct = res.headers.get("content-type") ?? "";
  expect(ct).toContain("text/plain");
  const body = await res.text();
  expect(body).toBe("hello world\n");
  srv.stop();
});

test("file endpoint: 410 when file missing from disk", async () => {
  const db = openDb(":memory:");
  seed(db);
  const ghost = join(TMP_DIR, "ghost.txt");
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('run1', ?, 'Edit', ?)", [ghost, Date.now()]);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1/file?path=${encodeURIComponent(ghost)}`);
  expect(res.status).toBe(410);
  srv.stop();
});

test("file endpoint: binary detection returns {error:'binary'} with 200", async () => {
  const db = openDb(":memory:");
  seed(db);
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('run1', ?, 'Edit', ?)", [TMP_BIN, Date.now()]);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1/file?path=${encodeURIComponent(TMP_BIN)}`);
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.error).toBe("binary");
  srv.stop();
});

test("file endpoint: 413 for oversized file", async () => {
  const db = openDb(":memory:");
  seed(db);
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('run1', ?, 'Edit', ?)", [TMP_LARGE, Date.now()]);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1/file?path=${encodeURIComponent(TMP_LARGE)}`);
  expect(res.status).toBe(413);
  const body = await res.json() as any;
  expect(body.error).toBe("too_large");
  srv.stop();
});

test("file endpoint: image/png content-type for .png", async () => {
  const db = openDb(":memory:");
  seed(db);
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('run1', ?, 'Edit', ?)", [TMP_PNG, Date.now()]);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1/file?path=${encodeURIComponent(TMP_PNG)}`);
  expect(res.status).toBe(200);
  const ct = res.headers.get("content-type") ?? "";
  expect(ct).toMatch(/^image\//);
  srv.stop();
});

test("file endpoint: .json file returns 200 text/plain with raw JSON body", async () => {
  const db = openDb(":memory:");
  seed(db);
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('run1', ?, 'Edit', ?)", [TMP_JSON, Date.now()]);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1/file?path=${encodeURIComponent(TMP_JSON)}`);
  expect(res.status).toBe(200);
  const ct = res.headers.get("content-type") ?? "";
  expect(ct).toContain("text/plain");
  const body = await res.text();
  expect(body).toBe('{"name":"test","version":"1.0.0"}');
  srv.stop();
});

test("file endpoint: 413 error envelope is application/json", async () => {
  const db = openDb(":memory:");
  seed(db);
  db.run("INSERT INTO session_files (session_id, path, change_kind, ts) VALUES ('run1', ?, 'Edit', ?)", [TMP_LARGE, Date.now()]);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1/file?path=${encodeURIComponent(TMP_LARGE)}`);
  expect(res.status).toBe(413);
  const ct = res.headers.get("content-type") ?? "";
  expect(ct).toContain("application/json");
  const body = await res.json() as any;
  expect(body.error).toBe("too_large");
  srv.stop();
});

test("SSE endpoint returns text/event-stream", async () => {
  const db = openDb(":memory:");
  const srv = createServer(db, { port: 0 });
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/dev-events`, { signal: ac.signal });
  expect(res.status).toBe(200);
  const ct = res.headers.get("content-type") ?? "";
  expect(ct).toContain("text/event-stream");
  ac.abort();
  srv.stop();
});

test("/api/search: q shorter than 2 chars returns empty results", async () => {
  const db = openDb(":memory:");
  const srv = createServer(db, { port: 0 });
  const r1 = await (await fetch(`http://127.0.0.1:${srv.port}/api/search?q=`)).json() as any;
  expect(r1.results).toEqual([]);
  const r2 = await (await fetch(`http://127.0.0.1:${srv.port}/api/search?q=a`)).json() as any;
  expect(r2.results).toEqual([]);
  srv.stop();
});

test("/api/search: returns matching sessions", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run("INSERT INTO sessions (id, instance, status, name, cwd, started_at, last_activity) VALUES ('srch1','test','running','search-session','/p/srch',?,?)", [now - 60000, now]);
  db.run("INSERT INTO sessions (id, instance, status, name, cwd, started_at, last_activity) VALUES ('other1','test','running','other-thing','/p/other',?,?)", [now - 60000, now]);
  const srv = createServer(db, { port: 0 });
  const body = await (await fetch(`http://127.0.0.1:${srv.port}/api/search?q=search`)).json() as any;
  expect(body.results).toHaveLength(1);
  expect(body.results[0].session.id).toBe("srch1");
  expect(body.results[0].matched_kind).toBe("session");
  expect(typeof body.results[0].snippet).toBe("string");
  srv.stop();
});

test("/api/search: returns empty array when no match", async () => {
  const db = openDb(":memory:");
  seed(db);
  const srv = createServer(db, { port: 0 });
  const body = await (await fetch(`http://127.0.0.1:${srv.port}/api/search?q=xyzzy-nonexistent`)).json() as any;
  expect(body.results).toEqual([]);
  srv.stop();
});

test("/api/search: missing q param returns empty results", async () => {
  const db = openDb(":memory:");
  const srv = createServer(db, { port: 0 });
  const body = await (await fetch(`http://127.0.0.1:${srv.port}/api/search`)).json() as any;
  expect(body.results).toEqual([]);
  srv.stop();
});

test("/api/sessions/:id includes tasks array", async () => {
  const db = openDb(":memory:");
  seed(db);
  const now = Date.now();
  db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('run1', 'Fix the bug', 'open', ?)", [now - 3600000]);
  db.run("INSERT INTO tasks (session_id, title, status, opened_at, closed_at) VALUES ('run1', 'Write tests', 'done', ?, ?)", [now - 7200000, now - 1000]);
  const srv = createServer(db, { port: 0 });
  const d = await (await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1`)).json() as any;
  expect(Array.isArray(d.tasks)).toBe(true);
  expect(d.tasks).toHaveLength(2);
  const titles = d.tasks.map((t: any) => t.title);
  expect(titles).toContain("Fix the bug");
  expect(titles).toContain("Write tests");
  srv.stop();
});

test("/api/sessions/:id tasks array empty when no tasks", async () => {
  const db = openDb(":memory:");
  seed(db);
  const srv = createServer(db, { port: 0 });
  const d = await (await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1`)).json() as any;
  expect(d.tasks).toEqual([]);
  srv.stop();
});

// --- /api/daily ---

test("/api/daily GET empty DB returns {date: null}", async () => {
  const db = openDb(":memory:");
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/daily`);
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.date).toBeNull();
  srv.stop();
});

test("/api/daily GET with seeded row returns row", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  const today = dateKey(now);
  db.run(
    "INSERT INTO daily (date, yesterday_md, today_md, blockers_md, generated_at) VALUES (?, ?, ?, ?, ?)",
    [today, "- ayer", "- hoy", "", now]
  );
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/daily`);
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.date).toBe(today);
  expect(body.yesterday_md).toBe("- ayer");
  expect(body.today_md).toBe("- hoy");
  srv.stop();
});

test("/api/daily/regenerate debounce: returns existing row when within 60min, no force", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  const today = dateKey(now);
  db.run(
    "INSERT INTO daily (date, yesterday_md, today_md, blockers_md, generated_at) VALUES (?, ?, ?, ?, ?)",
    [today, "- ayer cached", "- hoy cached", "", now - 1000]
  );
  let runnerCalled = false;
  const fakeRunner = async () => { runnerCalled = true; return '{"es":{"yesterday":"","today":"","blockers":""},"en":{"yesterday":"","today":"","blockers":""}}'; };
  const srv = createServer(db, { port: 0, dailyRunner: fakeRunner });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/daily/regenerate`, { method: "POST" });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.yesterday_md).toBe("- ayer cached");
  expect(runnerCalled).toBe(false);
  srv.stop();
});

test("/api/daily/regenerate force=1 bypasses debounce", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  const today = dateKey(now);
  db.run(
    "INSERT INTO daily (date, yesterday_md, today_md, blockers_md, generated_at) VALUES (?, ?, ?, ?, ?)",
    [today, "- old", "- old today", "", now - 1000]
  );
  const fakeRunner = async () => '{"es":{"yesterday":"- new","today":"- new today","blockers":""},"en":{"yesterday":"- new en","today":"- new today en","blockers":""}}';
  const srv = createServer(db, { port: 0, dailyRunner: fakeRunner });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/daily/regenerate?force=1`, { method: "POST" });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.yesterday_md).toBe("- new");
  srv.stop();
});

test("/api/daily/regenerate no row: generates and returns row", async () => {
  const db = openDb(":memory:");
  const fakeRunner = async () => '{"es":{"yesterday":"- generated","today":"- today gen","blockers":""},"en":{"yesterday":"- generated en","today":"- today gen en","blockers":""}}';
  const srv = createServer(db, { port: 0, dailyRunner: fakeRunner });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/daily/regenerate`, { method: "POST" });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.yesterday_md).toBe("- generated");
  srv.stop();
});

test("/api/daily/regenerate stale row (>60min): regenerates", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  const today = dateKey(now);
  db.run(
    "INSERT INTO daily (date, yesterday_md, today_md, blockers_md, generated_at) VALUES (?, ?, ?, ?, ?)",
    [today, "- old stale", "- old today stale", "", now - 3_700_000]
  );
  const fakeRunner = async () => '{"es":{"yesterday":"- fresh","today":"- fresh today","blockers":""},"en":{"yesterday":"- fresh en","today":"- fresh today en","blockers":""}}';
  const srv = createServer(db, { port: 0, dailyRunner: fakeRunner });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/daily/regenerate`, { method: "POST" });
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.yesterday_md).toBe("- fresh");
  srv.stop();
});

// --- /api/inbox ---

test("/api/inbox returns mentions and signals arrays", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    `INSERT INTO mentions (channel_id, channel_name, thread_ts, author, author_id, participants, text, ts,
       ask_count, resolved, first_at, last_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ["C1", "general", "ts1", "Alice", "U1", "[]", "hey Sam", "ts1", 1, 0, now - 1000, now - 1000]
  );
  db.run(
    "INSERT INTO signals (kind, channel, text, ts, created_at) VALUES (?,?,?,?,?)",
    ["alert", "alerts", "High CPU", "ts2", now - 500]
  );
  const srv = createServer(db, { port: 0 });
  const body = await (await fetch(`http://127.0.0.1:${srv.port}/api/inbox`)).json() as any;
  expect(Array.isArray(body.mentions)).toBe(true);
  expect(Array.isArray(body.signals)).toBe(true);
  expect(body.mentions).toHaveLength(1);
  expect(body.mentions[0].author).toBe("Alice");
  expect(body.signals).toHaveLength(1);
  expect(body.signals[0].kind).toBe("alert");
  srv.stop();
});

test("/api/inbox excludes resolved mentions", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, first_at, last_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ["C1", "ts1", "Alice", "open mention", "ts1", 1, 0, now, now]
  );
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, first_at, last_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ["C2", "ts2", "Bob", "resolved mention", "ts2", 1, 1, now, now]
  );
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, resolved_manual, first_at, last_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ["C3", "ts3", "Carol", "manually resolved", "ts3", 1, 0, 1, now, now]
  );
  const srv = createServer(db, { port: 0 });
  const body = await (await fetch(`http://127.0.0.1:${srv.port}/api/inbox`)).json() as any;
  expect(body.mentions).toHaveLength(1);
  expect(body.mentions[0].author).toBe("Alice");
  srv.stop();
});

test("/api/inbox includes session_name when mention is linked", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, status, name, started_at, last_activity) VALUES (?,?,?,?,?,?)",
    ["s1", "test", "running", "my session", now - 1000, now]
  );
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, first_at, last_at, session_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ["C1", "ts1", "Alice", "hey", "ts1", 1, 0, now, now, "s1"]
  );
  const srv = createServer(db, { port: 0 });
  const body = await (await fetch(`http://127.0.0.1:${srv.port}/api/inbox`)).json() as any;
  expect(body.mentions[0].session_name).toBe("my session");
  srv.stop();
});

// --- POST /api/mentions/:id/resolve ---

test("POST /api/mentions/:id/resolve toggles resolved_manual", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, first_at, last_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    ["C1", "ts1", "Alice", "hey", "ts1", 1, 0, now, now]
  );
  const id = (db.query("SELECT id FROM mentions").get() as any).id;
  const srv = createServer(db, { port: 0 });

  // First toggle: NULL → 1 (mark resolved)
  const r1 = await (await fetch(`http://127.0.0.1:${srv.port}/api/mentions/${id}/resolve`, { method: "POST" })).json() as any;
  expect(r1.resolved_manual).toBe(1);
  const row1 = db.query("SELECT resolved_manual FROM mentions WHERE id = ?").get(id) as any;
  expect(row1.resolved_manual).toBe(1);

  // Second toggle: 1 → NULL (unmark)
  const r2 = await (await fetch(`http://127.0.0.1:${srv.port}/api/mentions/${id}/resolve`, { method: "POST" })).json() as any;
  expect(r2.resolved_manual).toBeNull();
  const row2 = db.query("SELECT resolved_manual FROM mentions WHERE id = ?").get(id) as any;
  expect(row2.resolved_manual).toBeNull();

  srv.stop();
});

test("POST /api/mentions/:id/resolve 404-like: returns 200 with null for nonexistent id", async () => {
  const db = openDb(":memory:");
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/mentions/9999/resolve`, { method: "POST" });
  expect(res.status).toBe(200);
  srv.stop();
});

// --- /api/sessions mentions_open ---

test("/api/sessions includes mentions_open per session", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, status, started_at, last_activity) VALUES (?,?,?,?,?)",
    ["s1", "test", "running", now - 1000, now]
  );
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, first_at, last_at, session_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ["C1", "ts1", "Alice", "hey", "ts1", 1, 0, now, now, "s1"]
  );
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, first_at, last_at, session_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ["C2", "ts2", "Bob", "bye", "ts2", 1, 1, now, now, "s1"]  // resolved, not counted
  );
  const srv = createServer(db, { port: 0 });
  const body = await (await fetch(`http://127.0.0.1:${srv.port}/api/sessions`)).json() as any;
  const s = body.active.find((x: any) => x.id === "s1");
  expect(s.mentions_open).toBe(1);
  srv.stop();
});

// --- /api/sessions/:id includes mentions ---

test("/api/sessions/:id includes linked open mentions", async () => {
  const db = openDb(":memory:");
  seed(db);
  const now = Date.now();
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, first_at, last_at, session_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ["C1", "ts1", "Alice", "linked mention", "ts1", 1, 0, now, now, "run1"]
  );
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, first_at, last_at, session_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ["C2", "ts2", "Bob", "resolved mention", "ts2", 1, 1, now, now, "run1"]  // resolved, excluded
  );
  const srv = createServer(db, { port: 0 });
  const d = await (await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1`)).json() as any;
  expect(Array.isArray(d.mentions)).toBe(true);
  expect(d.mentions).toHaveLength(1);
  expect(d.mentions[0].author).toBe("Alice");
  srv.stop();
});

// --- /api/sessions/:id/resume-prompt ---

test("GET /api/sessions/:id/resume-prompt returns 200 text/plain for existing session", async () => {
  const db = openDb(":memory:");
  seed(db);
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1/resume-prompt`);
  expect(res.status).toBe(200);
  const ct = res.headers.get("content-type") ?? "";
  expect(ct).toContain("text/plain");
  const body = await res.text();
  expect(body.length).toBeGreaterThan(0);
  srv.stop();
});

test("GET /api/sessions/:id/resume-prompt returns 404 for unknown session", async () => {
  const db = openDb(":memory:");
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/sessions/nonexistent-id/resume-prompt`);
  expect(res.status).toBe(404);
  srv.stop();
});

// --- /api/sessions/:id links ---

test("/api/sessions/:id includes links array grouped by kind", async () => {
  const db = openDb(":memory:");
  seed(db);
  db.run("INSERT INTO links (session_id, kind, ref, title) VALUES ('run1', 'pr', 'acme-api#42', 'Fix bug')");
  db.run("INSERT INTO links (session_id, kind, ref) VALUES ('run1', 'linear', 'CON-1234')");
  db.run("INSERT INTO links (session_id, kind, ref) VALUES ('run1', 'artifact', '/docs/runbook.md')");
  const srv = createServer(db, { port: 0 });
  const d = await (await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1`)).json() as any;
  expect(Array.isArray(d.links)).toBe(true);
  expect(d.links).toHaveLength(3);
  // sorted by kind then ref — 'artifact' < 'linear' < 'pr'
  expect(d.links[0].kind).toBe("artifact");
  expect(d.links[1].kind).toBe("linear");
  expect(d.links[2].kind).toBe("pr");
  expect(d.links[2].title).toBe("Fix bug");
  srv.stop();
});

test("/api/sessions/:id links empty when no links seeded", async () => {
  const db = openDb(":memory:");
  seed(db);
  const srv = createServer(db, { port: 0 });
  const d = await (await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1`)).json() as any;
  expect(Array.isArray(d.links)).toBe(true);
  expect(d.links).toHaveLength(0);
  srv.stop();
});

test("/api/sessions/:id links only returns links for that session", async () => {
  const db = openDb(":memory:");
  seed(db);
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, status, started_at, last_activity) VALUES ('other1','personal','running',?,?)",
    [now - 1000, now]
  );
  db.run("INSERT INTO links (session_id, kind, ref) VALUES ('run1', 'linear', 'CON-100')");
  db.run("INSERT INTO links (session_id, kind, ref) VALUES ('other1', 'linear', 'CON-999')");
  const srv = createServer(db, { port: 0 });
  const d = await (await fetch(`http://127.0.0.1:${srv.port}/api/sessions/run1`)).json() as any;
  expect(d.links).toHaveLength(1);
  expect(d.links[0].ref).toBe("CON-100");
  srv.stop();
});

// --- /api/config ---

describe("/api/config", () => {
  let prevHome: string | undefined;
  let cfgTmp: string;

  beforeEach(() => {
    prevHome = process.env.CLAUDE_LIVE_HOME;
    cfgTmp = mkdtempSync(join(tmpdir(), "claude-live-cfg-test-"));
    process.env.CLAUDE_LIVE_HOME = cfgTmp;
  });

  afterEach(() => {
    if (prevHome === undefined) {
      delete process.env.CLAUDE_LIVE_HOME;
    } else {
      process.env.CLAUDE_LIVE_HOME = prevHome;
    }
  });

  test("GET /api/config returns masked config (no token set)", async () => {
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/config`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.slackTokenSet).toBe(false);
    expect(body.slackTokenLast4).toBe("");
    expect("slackToken" in body).toBe(false);
    srv.stop();
  });

  test("GET /api/config masks token when set", async () => {
    saveConfig({ ...DEFAULT_CONFIG, slackToken: "xoxp-secret-abcd" });
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/config`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.slackTokenSet).toBe(true);
    expect(body.slackTokenLast4).toBe("abcd");
    expect("slackToken" in body).toBe(false);
    srv.stop();
  });

  test("POST /api/config persists valid fields", async () => {
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const postRes = await fetch(`http://127.0.0.1:${srv.port}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summariesAuto: false, language: "en" }),
    });
    expect(postRes.status).toBe(200);
    const getRes = await fetch(`http://127.0.0.1:${srv.port}/api/config`);
    const body = await getRes.json() as any;
    expect(body.summariesAuto).toBe(false);
    expect(body.language).toBe("en");
    srv.stop();
  });

  test("POST /api/config does not overwrite token when posted value is masked placeholder", async () => {
    saveConfig({ ...DEFAULT_CONFIG, slackToken: "xoxp-real-token-1234" });
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const postRes = await fetch(`http://127.0.0.1:${srv.port}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slackToken: "\u{2022}\u{2022}\u{2022}\u{2022}1234" }),
    });
    expect(postRes.status).toBe(200);
    const getRes = await fetch(`http://127.0.0.1:${srv.port}/api/config`);
    const body = await getRes.json() as any;
    expect(body.slackTokenSet).toBe(true);
    srv.stop();
  });

  test("POST /api/config rejects invalid language with 400", async () => {
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "de" }),
    });
    expect(res.status).toBe(400);
    srv.stop();
  });

  test("deadlines CRUD: create, list, patch, dismiss", async () => {
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const base = `http://127.0.0.1:${srv.port}`;
    const created = await (await fetch(`${base}/api/deadlines`, { method:"POST", headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title:"Demo", due_at: 1783900800000 }) })).json() as any;
    expect(created.source).toBe("manual");
    expect(created.manual_override).toBe(1);
    const list = await (await fetch(`${base}/api/deadlines`)).json() as any;
    expect(list.deadlines.some((d:any)=>d.id===created.id)).toBe(true);
    const patched = await (await fetch(`${base}/api/deadlines/${created.id}`, { method:"PATCH", headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title:"Demo v2" }) })).json() as any;
    expect(patched.title).toBe("Demo v2");
    await fetch(`${base}/api/deadlines/${created.id}`, { method:"DELETE" });
    const after = await (await fetch(`${base}/api/deadlines`)).json() as any;
    expect(after.deadlines.some((d:any)=>d.id===created.id)).toBe(false);
    srv.stop();
  });

  test("PATCH /api/deadlines/:id ignores due_at when sent as string", async () => {
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const base = `http://127.0.0.1:${srv.port}`;
    const created = await (await fetch(`${base}/api/deadlines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "T", due_at: 1783900800000 }),
    })).json() as any;
    const originalDueAt = created.due_at;
    // Send due_at as a string (invalid type) — should be ignored, not stored
    const patched = await (await fetch(`${base}/api/deadlines/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ due_at: "2026-07-10" }),
    })).json() as any;
    // due_at must be unchanged and numeric (not corrupted to string)
    expect(patched.due_at).toBe(originalDueAt);
    expect(typeof patched.due_at === "number" || patched.due_at === null).toBe(true);
    srv.stop();
  });

  test("PATCH /api/deadlines/:id ignores invalid status, applies valid status", async () => {
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const base = `http://127.0.0.1:${srv.port}`;
    const created = await (await fetch(`${base}/api/deadlines`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "S" }),
    })).json() as any;
    // garbage status → field is ignored, row status stays 'open'
    const withGarbage = await (await fetch(`${base}/api/deadlines/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "garbage" }),
    })).json() as any;
    expect(withGarbage.status).toBe("open");
    // valid status 'done' → applied
    const good = await (await fetch(`${base}/api/deadlines/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    })).json() as any;
    expect(good.status).toBe("done");
    srv.stop();
  });

  test("two rapid POSTs to /api/deadlines produce distinct refs", async () => {
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const base = `http://127.0.0.1:${srv.port}`;
    const [r1, r2] = await Promise.all([
      fetch(`${base}/api/deadlines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "A" }),
      }).then(r => r.json() as Promise<any>),
      fetch(`${base}/api/deadlines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "B" }),
      }).then(r => r.json() as Promise<any>),
    ]);
    expect(typeof r1.id).toBe("number");
    expect(typeof r2.id).toBe("number");
    expect(r1.id).not.toBe(r2.id);
    expect(r1.ref).not.toBe(r2.ref);
    expect(r1.ref).toMatch(/^manual:\d+$/);
    expect(r2.ref).toMatch(/^manual:\d+$/);
    srv.stop();
  });

  test("POST /api/config accepts valid language", async () => {
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const postRes = await fetch(`http://127.0.0.1:${srv.port}/api/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "pt" }),
    });
    expect(postRes.status).toBe(200);
    const getRes = await fetch(`http://127.0.0.1:${srv.port}/api/config`);
    const body = await getRes.json() as any;
    expect(body.language).toBe("pt");
    srv.stop();
  });
});
