import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import { checkNotifications } from "../src/notify";

test("checkNotifications: fires for waiting_input non-worker session", () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, name, status, waiting_since, kind, last_activity) VALUES (?,?,?,?,?,?,?)",
    ["s-wait", "test", "My Session", "waiting_input", now, "session", now]
  );
  const calls: [string, string][] = [];
  checkNotifications(db, (t, b) => calls.push([t, b]), new Map());
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("My Session");
});

test("checkNotifications: dedupes — does not fire twice for same waiting_since", () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, name, status, waiting_since, kind, last_activity) VALUES (?,?,?,?,?,?,?)",
    ["s-dedup", "test", "Dedup Session", "waiting_input", now, "session", now]
  );
  const calls: [string, string][] = [];
  const fn = (t: string, b: string) => calls.push([t, b]);
  const state = new Map<string, number>();
  checkNotifications(db, fn, state);
  checkNotifications(db, fn, state);
  expect(calls).toHaveLength(1);
});

test("checkNotifications: skips worker sessions", () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, name, status, waiting_since, kind, last_activity) VALUES (?,?,?,?,?,?,?)",
    ["s-worker", "test", "Worker", "waiting_input", now, "worker", now]
  );
  const calls: [string, string][] = [];
  checkNotifications(db, (t, b) => calls.push([t, b]), new Map());
  expect(calls).toHaveLength(0);
});

test("checkNotifications: fires again after new waiting_since episode", () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, name, status, waiting_since, kind, last_activity) VALUES (?,?,?,?,?,?,?)",
    ["s-ep", "test", "Ep Session", "waiting_input", now, "session", now]
  );
  const calls: [string, string][] = [];
  const fn = (t: string, b: string) => calls.push([t, b]);
  const state = new Map<string, number>();
  checkNotifications(db, fn, state);
  // Simulate new episode: waiting_since changes
  db.run("UPDATE sessions SET waiting_since = ? WHERE id = ?", [now + 5000, "s-ep"]);
  checkNotifications(db, fn, state);
  expect(calls).toHaveLength(2);
});

test("checkNotifications: uses session id as title when name is null", () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, status, waiting_since, kind, last_activity) VALUES (?,?,?,?,?,?)",
    ["s-noname", "test", "waiting_input", now, "session", now]
  );
  const calls: [string, string][] = [];
  checkNotifications(db, (t, b) => calls.push([t, b]), new Map());
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("s-noname");
});

test("checkNotifications: uses summary as body when present", () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, name, status, summary, waiting_since, kind, last_activity) VALUES (?,?,?,?,?,?,?,?)",
    ["s-summ", "test", "Session", "waiting_input", "needs auth token", now, "session", now]
  );
  const calls: [string, string][] = [];
  checkNotifications(db, (t, b) => calls.push([t, b]), new Map());
  expect(calls[0][1]).toBe("needs auth token");
});

test("checkNotifications: uses 'waiting for input' body when summary is null", () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, name, status, waiting_since, kind, last_activity) VALUES (?,?,?,?,?,?,?)",
    ["s-nosumm", "test", "Session", "waiting_input", now, "session", now]
  );
  const calls: [string, string][] = [];
  checkNotifications(db, (t, b) => calls.push([t, b]), new Map());
  expect(calls[0][1]).toBe("waiting for input");
});

test("checkNotifications: cleans up stale state entries", () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, instance, name, status, waiting_since, kind, last_activity) VALUES (?,?,?,?,?,?,?)",
    ["s-clean", "test", "Session", "waiting_input", now, "session", now]
  );
  const calls: [string, string][] = [];
  const state = new Map<string, number>();
  checkNotifications(db, (t, b) => calls.push([t, b]), state);
  expect(state.has("s-clean")).toBe(true);
  // Session moves to running → no longer in waiting list
  db.run("UPDATE sessions SET status = 'running', waiting_since = NULL WHERE id = ?", ["s-clean"]);
  checkNotifications(db, (t, b) => calls.push([t, b]), state);
  expect(state.has("s-clean")).toBe(false);
});
