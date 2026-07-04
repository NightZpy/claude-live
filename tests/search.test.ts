import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import { search, sanitizeQ } from "../src/search";

function seedSession(db: ReturnType<typeof openDb>, id: string, opts: {
  name?: string;
  cwd?: string;
  last_prompt?: string;
  summary?: string;
  status?: string;
} = {}) {
  const now = Date.now();
  db.run(
    `INSERT INTO sessions (id, instance, status, name, cwd, last_prompt, summary, started_at, last_activity)
     VALUES (?, 'test', ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      opts.status ?? "running",
      opts.name ?? null,
      opts.cwd ?? "/tmp/proj",
      opts.last_prompt ?? null,
      opts.summary ?? null,
      now - 60000,
      now,
    ],
  );
}

// ── sanitizeQ ───────────────────────────────────────────────────────────────

test("sanitizeQ: strips fts operators", () => {
  expect(sanitizeQ('hello "world"')).toBe("hello world");
  expect(sanitizeQ("foo:bar")).toBe("foo bar");
  expect(sanitizeQ("(term)")).toBe("term");
  expect(sanitizeQ("a*b-c")).toBe("a b c");
  expect(sanitizeQ("it's")).toBe("it s");
  expect(sanitizeQ("   ")).toBe("");
});

test("sanitizeQ: collapses whitespace", () => {
  expect(sanitizeQ("  a   b  ")).toBe("a b");
});

// ── search ──────────────────────────────────────────────────────────────────

test("search: empty q returns []", () => {
  const db = openDb(":memory:");
  expect(search(db, "")).toEqual([]);
  expect(search(db, "   ")).toEqual([]);
});

test("search: operator-only q returns []", () => {
  const db = openDb(":memory:");
  seedSession(db, "s1", { name: "demo" });
  expect(search(db, "***")).toEqual([]);
  expect(search(db, '""')).toEqual([]);
});

test("search: returns session matching on name", () => {
  const db = openDb(":memory:");
  seedSession(db, "s1", { name: "dashboard-fix" });
  seedSession(db, "s2", { name: "other-thing" });

  const results = search(db, "dashboard");
  expect(results).toHaveLength(1);
  expect(results[0].session.id).toBe("s1");
  expect(results[0].matched_kind).toBe("session");
  expect(typeof results[0].snippet).toBe("string");
});

test("search: returns session matching on file path", () => {
  const db = openDb(":memory:");
  seedSession(db, "s1", { name: "proj" });
  const now = Date.now();
  db.run(
    "INSERT INTO session_files (session_id, path, change_kind, ts) VALUES (?, ?, 'Edit', ?)",
    ["s1", "/Users/u/proj/src/auth-service.ts", now],
  );

  const results = search(db, "auth-service");
  expect(results).toHaveLength(1);
  expect(results[0].session.id).toBe("s1");
  expect(results[0].matched_kind).toBe("file");
});

test("search: returns session matching on event detail", () => {
  const db = openDb(":memory:");
  seedSession(db, "s1", { name: "proj" });
  db.run(
    "INSERT INTO events (session_id, ts, kind, detail) VALUES (?, ?, 'prompt', ?)",
    ["s1", Date.now(), "fix the memory leak in queue processor"],
  );

  const results = search(db, "memory");
  expect(results).toHaveLength(1);
  expect(results[0].session.id).toBe("s1");
  expect(results[0].matched_kind).toBe("event");
});

test("search: deduplicates sessions with multiple matching fts rows", () => {
  const db = openDb(":memory:");
  seedSession(db, "s1", { name: "auth module", last_prompt: "auth token refresh" });
  // s1 has 'auth' in both name (session row) and last_prompt — but also in FTS via update trigger
  // Just seed a file with auth too
  db.run(
    "INSERT INTO session_files (session_id, path, change_kind, ts) VALUES (?, ?, 'Edit', ?)",
    ["s1", "/src/auth/handler.ts", Date.now()],
  );

  const results = search(db, "auth");
  expect(results).toHaveLength(1);
  expect(results[0].session.id).toBe("s1");
});

test("search: includes archived sessions", () => {
  const db = openDb(":memory:");
  seedSession(db, "arch1", { name: "legacy-feature", status: "archived" });

  const results = search(db, "legacy");
  expect(results).toHaveLength(1);
  expect(results[0].session.id).toBe("arch1");
  expect(results[0].session.status).toBe("archived");
});

test("search: returns at most 30 sessions", () => {
  const db = openDb(":memory:");
  for (let i = 0; i < 35; i++) {
    seedSession(db, `s${i}`, { name: `searchable-name-${i}` });
  }

  const results = search(db, "searchable");
  expect(results.length).toBeLessThanOrEqual(30);
});

test("search: no results returns []", () => {
  const db = openDb(":memory:");
  seedSession(db, "s1", { name: "totally-different" });

  const results = search(db, "xyzzy-nonexistent");
  expect(results).toHaveLength(0);
});

test("search: snippet is a string (possibly with match markers)", () => {
  const db = openDb(":memory:");
  seedSession(db, "s1", { name: "router-module", cwd: "/projects/router" });

  const results = search(db, "router");
  expect(results).toHaveLength(1);
  expect(typeof results[0].snippet).toBe("string");
});

test("search: fts operator injection does not throw", () => {
  const db = openDb(":memory:");
  seedSession(db, "s1", { name: "some-session" });

  // These should sanitize cleanly and either return [] or valid results
  expect(() => search(db, 'NEAR("foo", "bar")')).not.toThrow();
  expect(() => search(db, "foo OR bar")).not.toThrow();
  expect(() => search(db, "foo AND bar")).not.toThrow();
});
