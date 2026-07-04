import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import { enrichLinear, fetchLinearDeadline, syncLinearDeadlines } from "../src/linear";

function seedLink(db: any, ref: string) {
  db.run("INSERT INTO links (session_id, kind, ref) VALUES ('s1','linear',?)", [ref]);
}

const OK = JSON.stringify({
  data: { issue: { identifier: "AG-1382", title: "Fix agent timeout", state: { name: "In Progress" }, url: "https://linear.app/acme/issue/AG-1382" } },
});

test("enrichLinear fills title/url/state from canned GraphQL", async () => {
  const db = openDb(":memory:");
  seedLink(db, "AG-1382");
  await enrichLinear(db, "tok", async () => OK);
  const row = db.query("SELECT title, url, meta FROM links WHERE ref='AG-1382'").get() as any;
  expect(row.title).toBe("Fix agent timeout");
  expect(row.url).toBe("https://linear.app/acme/issue/AG-1382");
  expect(JSON.parse(row.meta).state).toBe("In Progress");
});

test("enrichLinear is a no-op without a token (runner never called)", async () => {
  const db = openDb(":memory:");
  seedLink(db, "AG-1382");
  let calls = 0;
  await enrichLinear(db, "", async () => { calls++; return OK; });
  expect(calls).toBe(0);
  expect((db.query("SELECT title FROM links WHERE ref='AG-1382'").get() as any).title).toBeNull();
});

test("enrichLinear tolerates malformed runner output (no crash, no write)", async () => {
  const db = openDb(":memory:");
  seedLink(db, "AG-1382");
  await enrichLinear(db, "tok", async () => "not json");
  expect((db.query("SELECT title FROM links WHERE ref='AG-1382'").get() as any).title).toBeNull();
});

test("enrichLinear skips links that already have a title", async () => {
  const db = openDb(":memory:");
  db.run("INSERT INTO links (session_id, kind, ref, title) VALUES ('s1','linear','AG-1','Existing')");
  let calls = 0;
  await enrichLinear(db, "tok", async () => { calls++; return OK; });
  expect(calls).toBe(0);
});

const DL = JSON.stringify({ data: { issue: {
  identifier: "AG-9", title: "Ship demo", dueDate: "2026-07-10",
  estimate: 3, state: { name: "In Progress" }, url: "https://linear.app/x/issue/AG-9" } } });

test("fetchLinearDeadline parses dueDate + estimate", async () => {
  const r = await fetchLinearDeadline("AG-9", "tok", async () => DL);
  expect(r!.title).toBe("Ship demo");
  expect(typeof r!.due_at).toBe("number");
  expect(new Date(r!.due_at!).toISOString().slice(0, 10)).toBe("2026-07-10");
  expect(r!.estimate_hours).toBe(3);
});

test("fetchLinearDeadline returns null due_at when no dueDate", async () => {
  const noDate = JSON.stringify({ data: { issue: { identifier: "AG-9", title: "x", state: { name: "Todo" }, url: "u" } } });
  const r = await fetchLinearDeadline("AG-9", "tok", async () => noDate);
  expect(r!.due_at).toBeNull();
});

test("fetchLinearDeadline null on empty token", async () => {
  expect(await fetchLinearDeadline("AG-9", "", async () => DL)).toBeNull();
});

test("syncLinearDeadlines upserts deadlines for linear links with dueDate", async () => {
  const db = openDb(":memory:");
  seedLink(db, "AG-9");
  await syncLinearDeadlines(db, "tok", async () => DL);
  const row = db.query("SELECT * FROM deadlines WHERE source='linear' AND ref='AG-9'").get() as any;
  expect(row).not.toBeNull();
  expect(row.title).toBe("Ship demo");
  expect(row.estimate_hours).toBe(3);
  expect(typeof row.due_at).toBe("number");
});

test("syncLinearDeadlines skips rows with no due_at and no estimate", async () => {
  const db = openDb(":memory:");
  seedLink(db, "AG-9");
  const noMeta = JSON.stringify({ data: { issue: { identifier: "AG-9", title: "x", state: { name: "Todo" }, url: "u" } } });
  await syncLinearDeadlines(db, "tok", async () => noMeta);
  expect((db.query("SELECT COUNT(*) c FROM deadlines").get() as any).c).toBe(0);
});
