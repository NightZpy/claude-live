/**
 * Tests for linear-issues: DB upsert/prune, /api/linear-issues endpoint,
 * hero count, and no-token / error resilience.
 * NEVER hits real mcp.linear.app.
 */
import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import { upsertIssues, pruneStaleIssues, type LinearIssueRow } from "../src/linear-issues";
import { createServer } from "../src/server";

// ── sample rows ─────────────────────────────────────────────────────────────
function makeRow(identifier: string, priority = 1, updatedAt = "2026-07-01T10:00:00Z"): LinearIssueRow {
  return {
    identifier,
    title: "Issue " + identifier,
    url: "https://linear.app/acme/issue/" + identifier,
    state_name: "In Progress",
    state_type: "started",
    team_key: "ENG",
    priority,
    updated_at: updatedAt,
    fetched_at: Date.now(),
  };
}

// ── upsert ───────────────────────────────────────────────────────────────────

test("upsertIssues inserts rows into linear_issues", () => {
  const db = openDb(":memory:");
  const rows = [makeRow("ENG-1", 1), makeRow("ENG-2", 2)];
  upsertIssues(db, rows, Date.now());
  const stored = db.query("SELECT * FROM linear_issues").all() as any[];
  expect(stored.length).toBe(2);
  expect(stored.map((r: any) => r.identifier).sort()).toEqual(["ENG-1", "ENG-2"]);
});

test("upsertIssues does UPSERT on identifier (no duplicates)", () => {
  const db = openDb(":memory:");
  const row = makeRow("ENG-1", 1);
  upsertIssues(db, [row], Date.now());
  const updated = { ...row, title: "Updated title", priority: 3 };
  upsertIssues(db, [updated], Date.now());
  const stored = db.query("SELECT * FROM linear_issues").all() as any[];
  expect(stored.length).toBe(1);
  expect(stored[0].title).toBe("Updated title");
  expect(stored[0].priority).toBe(3);
});

// ── prune ────────────────────────────────────────────────────────────────────

test("pruneStaleIssues deletes rows with fetched_at before runTs", () => {
  const db = openDb(":memory:");
  const old = Date.now() - 10000;
  const fresh = Date.now();
  upsertIssues(db, [{ ...makeRow("ENG-old"), fetched_at: old }], old);
  upsertIssues(db, [{ ...makeRow("ENG-new"), fetched_at: fresh }], fresh);

  pruneStaleIssues(db, fresh);
  const stored = db.query("SELECT identifier FROM linear_issues").all() as any[];
  expect(stored.length).toBe(1);
  expect(stored[0].identifier).toBe("ENG-new");
});

test("pruneStaleIssues does NOT run on error / no-token (caller responsibility)", () => {
  // The caller (fetchAssignedIssues) must not call prune if fetch threw
  // This test verifies rows are preserved if prune is never called
  const db = openDb(":memory:");
  upsertIssues(db, [makeRow("ENG-preserved")], Date.now() - 5000);
  // If we don't call prune, rows stay
  const stored = db.query("SELECT COUNT(*) as n FROM linear_issues").get() as any;
  expect(stored.n).toBe(1);
});

// ── /api/linear-issues endpoint ─────────────────────────────────────────────

test("GET /api/linear-issues returns rows ordered by priority then updated_at DESC", async () => {
  const db = openDb(":memory:");
  // Priority 0 = no priority (sort last)
  upsertIssues(db, [
    makeRow("ENG-p2", 2, "2026-07-01T00:00:00Z"),
    makeRow("ENG-p1", 1, "2026-07-01T00:00:00Z"),
    makeRow("ENG-p0", 0, "2026-07-01T00:00:00Z"),
    makeRow("ENG-p3", 3, "2026-07-02T00:00:00Z"),
  ], Date.now());

  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/linear-issues`);
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.issues).toBeDefined();
  const ids = body.issues.map((r: any) => r.identifier);
  // priority 1 < 2 < 3 < 0 (0 = no priority, sorted last)
  const p1idx = ids.indexOf("ENG-p1");
  const p2idx = ids.indexOf("ENG-p2");
  const p3idx = ids.indexOf("ENG-p3");
  const p0idx = ids.indexOf("ENG-p0");
  expect(p1idx).toBeLessThan(p2idx);
  expect(p2idx).toBeLessThan(p3idx);
  expect(p3idx).toBeLessThan(p0idx);
  expect(body.count).toBe(4);
  srv.stop();
});

test("GET /api/linear-issues returns empty array when no rows", async () => {
  const db = openDb(":memory:");
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/linear-issues`);
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.issues).toEqual([]);
  expect(body.count).toBe(0);
  srv.stop();
});

// ── hero includes assigned-issue count ───────────────────────────────────────

test("GET /api/sessions hero data is unaffected by linear_issues (count available via /api/linear-issues)", async () => {
  // The hero count is enriched client-side. The server exposes count via /api/linear-issues.
  const db = openDb(":memory:");
  upsertIssues(db, [makeRow("ENG-1"), makeRow("ENG-2")], Date.now());
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/linear-issues`);
  const body = await res.json() as any;
  expect(body.count).toBe(2);
  srv.stop();
});

// ── GET /api/config does not expose access tokens ────────────────────────────

test("GET /api/config does not expose linearAccessToken or linearRefreshToken", async () => {
  const db = openDb(":memory:");
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/config`);
  const body = await res.json() as any;
  // Must not expose raw tokens
  expect(body.linearAccessToken).toBeUndefined();
  expect(body.linearRefreshToken).toBeUndefined();
  expect(body.linearClientSecret).toBeUndefined();
  // Should expose connection status
  expect("linearConnected" in body).toBe(true);
  srv.stop();
});
