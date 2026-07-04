import { test, expect } from "bun:test";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../src/db";
import { handle, resolvePidIfMissing, instanceFromTranscript, filePathFromToolInput, findClaudePid, type HookPayload } from "../src/hook";

const fx = (n: string): HookPayload =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures/hooks", n + ".json"), "utf8"));

test("instanceFromTranscript", () => {
  expect(instanceFromTranscript("/Users/u/.claude/projects/x/s.jsonl")).toBe("personal");
  expect(instanceFromTranscript("/Users/u/.claude-work/projects/x/s.jsonl")).toBe("work");
  expect(instanceFromTranscript(undefined)).toBe("unknown");
});

test("filePathFromToolInput", () => {
  expect(filePathFromToolInput("Edit", { file_path: "/a.ts" })).toBe("/a.ts");
  expect(filePathFromToolInput("NotebookEdit", { notebook_path: "/n.ipynb" })).toBe("/n.ipynb");
  expect(filePathFromToolInput("Bash", { command: "ls" })).toBeNull();
});

test("full lifecycle: start → prompt → edit → notification → stop → end", async () => {
  const db = openDb(":memory:");
  await handle(db, fx("session-start"), process.pid);
  let s = db.query("SELECT * FROM sessions WHERE id='fix-1'").get() as any;
  expect(s.status).toBe("running");
  expect(s.instance).toBe("work");

  await handle(db, fx("prompt"), process.pid);
  s = db.query("SELECT * FROM sessions WHERE id='fix-1'").get() as any;
  expect(s.last_prompt).toContain("status bar");

  await handle(db, fx("post-tool-edit"), process.pid);
  const f = db.query("SELECT * FROM session_files WHERE session_id='fix-1'").get() as any;
  expect(f.path).toBe("/Users/u/proj/src/a.ts");

  await handle(db, fx("notification"), process.pid);
  s = db.query("SELECT * FROM sessions WHERE id='fix-1'").get() as any;
  expect(s.status).toBe("waiting_input");
  expect(s.waiting_since).toBeGreaterThan(0);

  await handle(db, fx("stop"), process.pid);
  s = db.query("SELECT * FROM sessions WHERE id='fix-1'").get() as any;
  expect(s.status).toBe("idle");
  expect(s.waiting_since).toBeNull();

  await handle(db, fx("session-end"), process.pid);
  s = db.query("SELECT * FROM sessions WHERE id='fix-1'").get() as any;
  expect(s.status).toBe("archived");
  expect(s.archived_reason).toBe("exit");
});

test("out-of-order event on unknown session still creates row", async () => {
  const db = openDb(":memory:");
  await handle(db, { ...fx("stop"), session_id: "orphan" }, process.pid);
  const s = db.query("SELECT * FROM sessions WHERE id='orphan'").get() as any;
  expect(s.status).toBe("idle");
});

test("resolvePidIfMissing sets pid when resolver returns 4242", async () => {
  const db = openDb(":memory:");
  db.run(
    `INSERT INTO sessions (id, instance, status, started_at, last_activity) VALUES ('test-sess', 'personal', 'running', 0, 0)`,
  );
  await resolvePidIfMissing(db, "test-sess", process.pid, async () => 4242);
  const s = db.query("SELECT pid FROM sessions WHERE id='test-sess'").get() as any;
  expect(s.pid).toBe(4242);
});

test("resolvePidIfMissing leaves pid untouched and does NOT call resolver when pid already set", async () => {
  const db = openDb(":memory:");
  db.run(
    `INSERT INTO sessions (id, instance, status, started_at, last_activity, pid) VALUES ('test-sess2', 'personal', 'running', 0, 0, 9999)`,
  );
  let counter = 0;
  await resolvePidIfMissing(db, "test-sess2", process.pid, async () => { counter++; return 1111; });
  const s = db.query("SELECT pid FROM sessions WHERE id='test-sess2'").get() as any;
  expect(s.pid).toBe(9999);
  expect(counter).toBe(0);
});

test("findClaudePid never throws", () => {
  const r = findClaudePid(process.pid);
  expect(r === null || typeof r === "number").toBe(true);
});

test("CLI subprocess writes to DB and exits 0 even on garbage", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cl-hook-"));
  const env = { ...process.env, CLAUDE_LIVE_HOME: tmp };
  const p1 = Bun.spawn(["bun", join(import.meta.dir, "../src/hook.ts")], { env, stdin: "pipe" });
  p1.stdin.write(readFileSync(join(import.meta.dir, "fixtures/hooks/session-start.json")));
  p1.stdin.end();
  expect(await p1.exited).toBe(0);
  const db = openDb(join(tmp, "claude-live.db"));
  expect((db.query("SELECT id FROM sessions").get() as any).id).toBe("fix-1");

  const p2 = Bun.spawn(["bun", join(import.meta.dir, "../src/hook.ts")], { env, stdin: "pipe" });
  p2.stdin.write("not json at all");
  p2.stdin.end();
  expect(await p2.exited).toBe(0);
});

test("Stop with recent summary_at does not throw (cheap debounce path)", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  // Insert session with summary_at within the last 5 min so the spawn is skipped.
  db.run(
    `INSERT INTO sessions (id, instance, status, started_at, last_activity, summary_at)
     VALUES ('fix-1', 'work', 'running', 0, 0, ?)`,
    [now - 60_000],
  );
  await handle(db, fx("stop"), process.pid);
  const s = db.query("SELECT status FROM sessions WHERE id='fix-1'").get() as any;
  expect(s.status).toBe("idle");
});

test("CLI with CLAUDE_LIVE_IGNORE=1 exits 0 without touching DB", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "cl-loop-"));
  const env = { ...process.env, CLAUDE_LIVE_HOME: tmp, CLAUDE_LIVE_IGNORE: "1" };
  const p = Bun.spawn(["bun", join(import.meta.dir, "../src/hook.ts")], { env, stdin: "pipe" });
  p.stdin.write(readFileSync(join(import.meta.dir, "fixtures/hooks/session-start.json")));
  p.stdin.end();
  expect(await p.exited).toBe(0);
  expect(existsSync(join(tmp, "claude-live.db"))).toBe(false);
});
