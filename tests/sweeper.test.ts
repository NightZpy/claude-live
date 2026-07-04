import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import { sweep } from "../src/sweeper";

test("sweep archives dead pids, keeps live ones", async () => {
  const db = openDb(":memory:");
  const dead = Bun.spawn(["sleep", "10"]);
  const deadPid = dead.pid;
  dead.kill();
  await dead.exited;
  db.run("INSERT INTO sessions (id, instance, status, pid, last_activity, waiting_since) VALUES ('d','personal','running',?,?,?)", [deadPid, Date.now(), Date.now()]);
  db.run("INSERT INTO sessions (id, instance, status, pid, last_activity) VALUES ('l','personal','running',?,?)", [process.pid, Date.now()]);
  const n = sweep(db);
  expect(n).toBe(1);
  const archived = db.query("SELECT status, archived_reason, waiting_since FROM sessions WHERE id='d'").get() as any;
  expect(archived.archived_reason).toBe("process_died");
  expect(archived.waiting_since).toBeNull();
  expect((db.query("SELECT status FROM sessions WHERE id='l'").get() as any).status).toBe("running");
});

test("sweep archives stale null-pid sessions after 24h", () => {
  const db = openDb(":memory:");
  const old = Date.now() - 25 * 3600_000;
  db.run("INSERT INTO sessions (id, instance, status, pid, last_activity) VALUES ('s','personal','idle',NULL,?)", [old]);
  db.run("INSERT INTO sessions (id, instance, status, pid, last_activity) VALUES ('f','personal','idle',NULL,?)", [Date.now()]);
  expect(sweep(db)).toBe(1);
  expect((db.query("SELECT archived_reason FROM sessions WHERE id='s'").get() as any).archived_reason).toBe("stale");
  expect((db.query("SELECT status FROM sessions WHERE id='f'").get() as any).status).toBe("idle");
});

test("sweep does not archive pid=1 (EPERM means alive)", () => {
  const db = openDb(":memory:");
  db.run(
    "INSERT INTO sessions (id, instance, status, pid, last_activity, waiting_since) VALUES ('p1','personal','running',1,?,NULL)",
    [Date.now()]
  );
  const n = sweep(db);
  expect(n).toBe(0);
  expect((db.query("SELECT status FROM sessions WHERE id='p1'").get() as any).status).toBe("running");
});
