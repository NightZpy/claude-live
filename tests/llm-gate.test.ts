import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb } from "../src/db";
import { logLlmCall, llmAllowed, runGated } from "../src/llm-gate";
import type { Config } from "../src/config";

function makeDb(): Database {
  return openDb(":memory:");
}

function baseCfg(overrides: Partial<Config> = {}): Config {
  return {
    language: "en",
    port: 7777,
    instances: [],
    ...overrides,
  };
}

test("logLlmCall writes a row with correct fields", () => {
  const db = makeDb();
  const before = Date.now();
  logLlmCall(db, "summary", "haiku", 42, true);
  const after = Date.now();
  const row = db.query("SELECT * FROM llm_calls").get() as any;
  expect(row.kind).toBe("summary");
  expect(row.model).toBe("haiku");
  expect(row.duration_ms).toBe(42);
  expect(row.ok).toBe(1);
  expect(row.ts).toBeGreaterThanOrEqual(before);
  expect(row.ts).toBeLessThanOrEqual(after);
});

test("logLlmCall stores ok=0 for false", () => {
  const db = makeDb();
  logLlmCall(db, "daily", null, 10, false);
  const row = db.query("SELECT * FROM llm_calls").get() as any;
  expect(row.ok).toBe(0);
  expect(row.model).toBeNull();
});

test("llmAllowed returns allowed=true when nothing blocked", () => {
  const db = makeDb();
  const result = llmAllowed(db, baseCfg(), Date.now());
  expect(result).toEqual({ allowed: true });
});

test("llmAllowed returns paused when cfg.llmPaused=true", () => {
  const db = makeDb();
  const result = llmAllowed(db, baseCfg({ llmPaused: true }), Date.now());
  expect(result).toEqual({ allowed: false, reason: "paused" });
});

test("llmAllowed paused overrides count", () => {
  const db = makeDb();
  // Even with zero rows, paused wins
  const result = llmAllowed(db, baseCfg({ llmPaused: true, llmDailyCap: 1000 }), Date.now());
  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("paused");
});

test("llmAllowed cap: N-1 rows allowed, Nth row blocked", () => {
  const db = makeDb();
  const now = Date.now();
  const cfg = baseCfg({ llmDailyCap: 3 });

  // Insert 2 rows for today (below cap)
  db.run("INSERT INTO llm_calls (ts, kind, ok) VALUES (?,?,?)", [now - 1000, "x", 1]);
  db.run("INSERT INTO llm_calls (ts, kind, ok) VALUES (?,?,?)", [now - 500, "x", 1]);
  expect(llmAllowed(db, cfg, now)).toEqual({ allowed: true });

  // Insert 3rd row — now at cap
  db.run("INSERT INTO llm_calls (ts, kind, ok) VALUES (?,?,?)", [now - 100, "x", 1]);
  const blocked = llmAllowed(db, cfg, now);
  expect(blocked).toEqual({ allowed: false, reason: "cap" });
});

test("llmAllowed: yesterday's rows don't count toward cap", () => {
  const db = makeDb();
  const now = Date.now();
  const twoDaysAgo = now - 2 * 86400000;
  const cfg = baseCfg({ llmDailyCap: 2 });

  // Insert 5 rows from two days ago
  for (let i = 0; i < 5; i++) {
    db.run("INSERT INTO llm_calls (ts, kind, ok) VALUES (?,?,?)", [twoDaysAgo + i, "x", 1]);
  }
  // Should still be allowed because those rows are outside today
  expect(llmAllowed(db, cfg, now)).toEqual({ allowed: true });
});

test("runGated success: calls runnerFn, logs ok=1, returns output", async () => {
  const db = makeDb();
  const cfg = baseCfg();
  const output = await runGated(db, cfg, "summary", async () => "hello world");
  expect(output).toBe("hello world");
  const row = db.query("SELECT * FROM llm_calls").get() as any;
  expect(row.kind).toBe("summary");
  expect(row.ok).toBe(1);
  expect(row.model).toBeNull();
});

test("runGated throws LLM_BLOCKED:paused when paused", async () => {
  const db = makeDb();
  const cfg = baseCfg({ llmPaused: true });
  await expect(runGated(db, cfg, "summary", async () => "x")).rejects.toThrow("LLM_BLOCKED:paused");
  // No rows inserted
  const count = (db.query("SELECT COUNT(*) as c FROM llm_calls").get() as any).c;
  expect(count).toBe(0);
});

test("runGated throws LLM_BLOCKED:cap when cap exceeded", async () => {
  const db = makeDb();
  const now = Date.now();
  const cfg = baseCfg({ llmDailyCap: 1 });
  // Pre-fill to cap
  db.run("INSERT INTO llm_calls (ts, kind, ok) VALUES (?,?,?)", [now - 100, "x", 1]);
  await expect(runGated(db, cfg, "summary", async () => "x")).rejects.toThrow("LLM_BLOCKED:cap");
});

test("runGated on runner failure: logs ok=0 and re-throws original error", async () => {
  const db = makeDb();
  const cfg = baseCfg();
  const err = new Error("runner exploded");
  await expect(
    runGated(db, cfg, "daily", async () => { throw err; })
  ).rejects.toThrow("runner exploded");
  const row = db.query("SELECT * FROM llm_calls").get() as any;
  expect(row.kind).toBe("daily");
  expect(row.ok).toBe(0);
});
