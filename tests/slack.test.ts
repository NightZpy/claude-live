import { test, expect } from "bun:test";
import { openDb } from "../src/db";
import {
  fetchMentions,
  fetchSignals,
  upsertMention,
  upsertSignal,
  markResolvedHeuristic,
  matchToSessions,
  runSlack,
  SLACK_ALLOWED_TOOLS,
  SLACK_UNAVAILABLE,
  defaultRunner,
  type SlackRunner,
  type RawMention,
  type RawSignal,
} from "../src/slack";
import type { LlmRunner } from "../src/summarizer";

// --- helpers ---

function makeMention(overrides: Partial<RawMention> = {}): RawMention {
  return {
    channel: "C001",
    author: "Lenyn",
    text: "Can you check this PR?",
    ts: "1751000000.000001",
    ...overrides,
  };
}

function makeSignal(overrides: Partial<RawSignal> = {}): RawSignal {
  return {
    kind: "alert",
    channel: "alerts-prod",
    text: "High CPU on worker-1",
    ts: "1751000005.000001",
    ...overrides,
  };
}

// --- SLACK_ALLOWED_TOOLS ---

test("SLACK_ALLOWED_TOOLS contains exactly the 4 read-only Slack tools", () => {
  expect(SLACK_ALLOWED_TOOLS).toHaveLength(4);
  expect(SLACK_ALLOWED_TOOLS).toContain("mcp__claude_ai_Slack__slack_search_public_and_private");
  expect(SLACK_ALLOWED_TOOLS).toContain("mcp__claude_ai_Slack__slack_read_thread");
  expect(SLACK_ALLOWED_TOOLS).toContain("mcp__claude_ai_Slack__slack_search_users");
  expect(SLACK_ALLOWED_TOOLS).toContain("mcp__claude_ai_Slack__slack_read_channel");
  for (const t of SLACK_ALLOWED_TOOLS) {
    expect(t).not.toContain("send");
    expect(t).not.toContain("post");
    expect(t).not.toContain("react");
    expect(t).not.toContain("draft");
  }
});

test("defaultRunner is a function accepting prompt and allowedTools", () => {
  expect(typeof defaultRunner).toBe("function");
  expect(defaultRunner.length).toBe(2);
});

// --- fetchMentions ---

test("fetchMentions parses canned JSON array from runner", async () => {
  const canned: RawMention[] = [
    makeMention({ text: "hey Lenyn can you review this?" }),
    makeMention({ channel: "C002", ts: "1751000001.000002", text: "Lenyn are you around?" }),
  ];
  const runner: SlackRunner = async () => JSON.stringify(canned);
  const result = await fetchMentions(runner, Date.now() - 3600_000);
  expect(result).toHaveLength(2);
  expect(result[0].text).toBe("hey Lenyn can you review this?");
  expect(result[1].channel).toBe("C002");
});

test("fetchMentions passes SLACK_ALLOWED_TOOLS to runner", async () => {
  let capturedTools: string[] = [];
  const runner: SlackRunner = async (_, tools) => {
    capturedTools = tools;
    return "[]";
  };
  await fetchMentions(runner, Date.now());
  expect(capturedTools).toEqual(SLACK_ALLOWED_TOOLS);
});

test("fetchMentions returns [] when runner returns SLACK_UNAVAILABLE", async () => {
  const runner: SlackRunner = async () => "SLACK_UNAVAILABLE";
  const result = await fetchMentions(runner, Date.now());
  expect(result).toEqual([]);
});

test("fetchMentions returns [] on malformed JSON (no throw)", async () => {
  const runner: SlackRunner = async () => "not json at all !!!";
  const result = await fetchMentions(runner, Date.now());
  expect(result).toEqual([]);
});

test("fetchMentions returns [] when runner throws (no throw)", async () => {
  const runner: SlackRunner = async () => {
    throw new Error("CLI failed");
  };
  const result = await fetchMentions(runner, Date.now());
  expect(result).toEqual([]);
});

test("fetchMentions filters out items missing required fields", async () => {
  const mixed = [
    { channel: "C001", author: "Lenyn", text: "ok", ts: "ts1" },
    { channel: "C002", text: "missing author and ts" },
    null,
    "garbage",
  ];
  const runner: SlackRunner = async () => JSON.stringify(mixed);
  const result = await fetchMentions(runner, Date.now());
  expect(result).toHaveLength(1);
  expect(result[0].channel).toBe("C001");
});

test("fetchMentions tolerates JSON embedded in prose (extracts first [...] block)", async () => {
  const canned = [makeMention()];
  const runner: SlackRunner = async () =>
    `Here are the mentions:\n${JSON.stringify(canned)}\nThat's all.`;
  const result = await fetchMentions(runner, Date.now());
  expect(result).toHaveLength(1);
});

test("fetchMentions prompt instructs single search call and no thread/user lookups", async () => {
  let capturedPrompt = "";
  const runner: SlackRunner = async (prompt) => {
    capturedPrompt = prompt;
    return "[]";
  };
  await fetchMentions(runner, Date.now());
  expect(capturedPrompt.toLowerCase()).toContain("single");
  expect(capturedPrompt.toLowerCase()).toContain("do not open threads");
  // must not list participants or author_id as required fields (per-sentence check)
  expect(capturedPrompt.toLowerCase()).not.toMatch(/must have[^.]*participants/);
  expect(capturedPrompt.toLowerCase()).not.toMatch(/must have[^.]*author_id/);
});

test("fetchMentions prompt requires only single-search-obtainable required fields", async () => {
  let capturedPrompt = "";
  const runner: SlackRunner = async (prompt) => {
    capturedPrompt = prompt;
    return "[]";
  };
  await fetchMentions(runner, Date.now());
  // must require the 4 fields obtainable from one search call
  expect(capturedPrompt).toContain("channel");
  expect(capturedPrompt).toContain("author");
  expect(capturedPrompt).toContain("text");
  expect(capturedPrompt).toContain("ts");
});

// --- fetchSignals ---

test("fetchSignals returns [] immediately when channel lists are empty", async () => {
  let called = false;
  const runner: SlackRunner = async () => {
    called = true;
    return "[]";
  };
  const result = await fetchSignals(runner, [], []);
  expect(result).toEqual([]);
  expect(called).toBe(false);
});

test("fetchSignals parses canned signal array", async () => {
  const canned: RawSignal[] = [
    makeSignal({ kind: "alert", channel: "alerts-prod", text: "High CPU" }),
    makeSignal({ kind: "deploy", channel: "deploys", text: "v1.2.3 deployed", ts: "1751000006.000001" }),
  ];
  const runner: SlackRunner = async () => JSON.stringify(canned);
  const result = await fetchSignals(runner, ["alerts-prod"], ["deploys"]);
  expect(result).toHaveLength(2);
  expect(result[0].kind).toBe("alert");
  expect(result[1].kind).toBe("deploy");
});

test("fetchSignals returns [] when runner returns SLACK_UNAVAILABLE", async () => {
  const runner: SlackRunner = async () => "SLACK_UNAVAILABLE";
  const result = await fetchSignals(runner, ["ch1"], []);
  expect(result).toEqual([]);
});

test("fetchSignals returns [] on malformed JSON (no throw)", async () => {
  const runner: SlackRunner = async () => "{{broken";
  const result = await fetchSignals(runner, ["ch1"], []);
  expect(result).toEqual([]);
});

test("fetchSignals filters items with invalid kind", async () => {
  const mixed = [
    { kind: "alert", channel: "ch1", text: "ok", ts: "ts1" },
    { kind: "unknown", channel: "ch1", text: "bad kind", ts: "ts2" },
  ];
  const runner: SlackRunner = async () => JSON.stringify(mixed);
  const result = await fetchSignals(runner, ["ch1"], []);
  expect(result).toHaveLength(1);
  expect(result[0].kind).toBe("alert");
});

// --- upsertMention ---

test("upsertMention inserts first mention with ask_count=1 resolved=0", () => {
  const db = openDb(":memory:");
  const raw = makeMention();
  upsertMention(db, raw, 1000);
  const row = db
    .query("SELECT * FROM mentions WHERE channel_id='C001' AND ts='1751000000.000001'")
    .get() as any;
  expect(row).not.toBeNull();
  expect(row.ask_count).toBe(1);
  expect(row.resolved).toBe(0);
  expect(row.first_at).toBe(1000);
  expect(row.last_at).toBe(1000);
  expect(row.text).toBe("Can you check this PR?");
  expect(JSON.parse(row.participants)).toEqual([]);
});

test("upsertMention: same (channel, ts) is idempotent; different ts creates a new row", () => {
  const db = openDb(":memory:");
  const raw = makeMention();
  upsertMention(db, raw, 1000);
  // Same channel + ts — re-poll of the same message → no new row
  upsertMention(db, { ...raw, text: "same message repoll" }, 2000);
  const count1 = (db.query("SELECT COUNT(*) as c FROM mentions WHERE channel_id='C001'").get() as any).c;
  expect(count1).toBe(1);
  const row1 = db.query("SELECT text FROM mentions WHERE channel_id='C001'").get() as any;
  expect(row1.text).toBe("Can you check this PR?"); // original text preserved

  // Newer ts — a distinct new mention → new row
  upsertMention(db, { ...raw, ts: "1751000001.000001", text: "ping again, any update?" }, 3000);
  const count2 = (db.query("SELECT COUNT(*) as c FROM mentions WHERE channel_id='C001'").get() as any).c;
  expect(count2).toBe(2);
  const newRow = db.query("SELECT text, ask_count, resolved FROM mentions WHERE ts='1751000001.000001'").get() as any;
  expect(newRow.text).toBe("ping again, any update?");
  expect(newRow.ask_count).toBe(1);
  expect(newRow.resolved).toBe(0);
});

test("upsertMention is idempotent: same now does not bump ask_count", () => {
  const db = openDb(":memory:");
  const raw = makeMention();
  upsertMention(db, raw, 1000);
  upsertMention(db, raw, 1000);
  const row = db.query("SELECT ask_count FROM mentions WHERE channel_id='C001'").get() as any;
  expect(row.ask_count).toBe(1);
});

test("upsertMention does not update when now is older than stored last_at", () => {
  const db = openDb(":memory:");
  const raw = makeMention();
  upsertMention(db, raw, 2000);
  upsertMention(db, { ...raw, text: "old message" }, 500);
  const row = db.query("SELECT ask_count, text FROM mentions WHERE channel_id='C001'").get() as any;
  expect(row.ask_count).toBe(1);
  expect(row.text).toBe("Can you check this PR?");
});

test("upsertMention poll idempotency: same ts across 3 polls keeps 1 row; new ts adds a row", () => {
  const db = openDb(":memory:");
  const raw = makeMention();
  upsertMention(db, raw, 1000);
  // Simulate 3 polls returning the same message (same raw.ts) → still 1 row
  upsertMention(db, raw, 1900);
  upsertMention(db, raw, 2800);
  const count1 = (db.query("SELECT COUNT(*) as c FROM mentions WHERE channel_id='C001'").get() as any).c;
  expect(count1).toBe(1);
  const row1 = db.query("SELECT ask_count FROM mentions WHERE channel_id='C001'").get() as any;
  expect(row1.ask_count).toBe(1);
  // A genuine new message with a different ts → separate row
  upsertMention(db, { ...raw, ts: "1751000002.000001", text: "still waiting?" }, 3700);
  const count2 = (db.query("SELECT COUNT(*) as c FROM mentions WHERE channel_id='C001'").get() as any).c;
  expect(count2).toBe(2);
});

test("upsertMention: new ts creates a fresh unresolved row even when previous row is resolved", () => {
  const db = openDb(":memory:");
  const raw = makeMention();
  upsertMention(db, raw, 1000);
  db.run("UPDATE mentions SET resolved=1 WHERE channel_id='C001'");
  // A new message (different ts) should appear as a new unresolved row
  upsertMention(db, { ...raw, ts: "1751000003.000001", text: "hey still there?" }, 2000);
  const newRow = db
    .query("SELECT resolved, ask_count FROM mentions WHERE channel_id='C001' AND ts='1751000003.000001'")
    .get() as any;
  expect(newRow).not.toBeNull();
  expect(newRow.resolved).toBe(0);
  expect(newRow.ask_count).toBe(1);
  // old row remains resolved
  const oldRow = db
    .query("SELECT resolved FROM mentions WHERE channel_id='C001' AND ts='1751000000.000001'")
    .get() as any;
  expect(oldRow.resolved).toBe(1);
});

test("upsertMention: new ts creates new row even when prior row has resolved_manual set", () => {
  const db = openDb(":memory:");
  const raw = makeMention();
  upsertMention(db, raw, 1000);
  db.run("UPDATE mentions SET resolved=1, resolved_manual=1 WHERE channel_id='C001'");
  // New message ts → new row with resolved=0 (per-message dedup, each ts is its own entry)
  upsertMention(db, { ...raw, ts: "1751000004.000001", text: "one more ping" }, 2000);
  const newRow = db
    .query("SELECT resolved FROM mentions WHERE channel_id='C001' AND ts='1751000004.000001'")
    .get() as any;
  expect(newRow).not.toBeNull();
  expect(newRow.resolved).toBe(0);
  // prior row with resolved_manual is untouched
  const oldRow = db
    .query("SELECT resolved, resolved_manual FROM mentions WHERE channel_id='C001' AND ts='1751000000.000001'")
    .get() as any;
  expect(oldRow.resolved).toBe(1);
  expect(oldRow.resolved_manual).toBe(1);
});

test("upsertMention stores separate rows for different ts values", () => {
  const db = openDb(":memory:");
  upsertMention(db, makeMention({ ts: "1751000010.000001" }), 1000);
  upsertMention(db, makeMention({ ts: "1751000020.000001" }), 1001);
  const count = (db.query("SELECT COUNT(*) as c FROM mentions").get() as any).c;
  expect(count).toBe(2);
});

// --- SLACK_UNAVAILABLE in fetch → no DB rows ---

test("fetchMentions SLACK_UNAVAILABLE yields no rows after upsert loop", async () => {
  const db = openDb(":memory:");
  const runner: SlackRunner = async () => "SLACK_UNAVAILABLE";
  const mentions = await fetchMentions(runner, Date.now());
  for (const m of mentions) upsertMention(db, m, Date.now());
  const count = (db.query("SELECT COUNT(*) as c FROM mentions").get() as any).c;
  expect(count).toBe(0);
});

// --- upsertSignal ---

test("upsertSignal inserts a new signal row", () => {
  const db = openDb(":memory:");
  const raw = makeSignal();
  upsertSignal(db, raw, 5000);
  const row = db
    .query("SELECT * FROM signals WHERE channel='alerts-prod'")
    .get() as any;
  expect(row).not.toBeNull();
  expect(row.kind).toBe("alert");
  expect(row.text).toBe("High CPU on worker-1");
  expect(row.created_at).toBe(5000);
});

test("upsertSignal is idempotent: duplicate (channel, ts) not inserted again", () => {
  const db = openDb(":memory:");
  const raw = makeSignal();
  upsertSignal(db, raw, 5000);
  upsertSignal(db, raw, 6000);
  const count = (db.query("SELECT COUNT(*) as c FROM signals").get() as any).c;
  expect(count).toBe(1);
});

test("upsertSignal stores deploy kind", () => {
  const db = openDb(":memory:");
  upsertSignal(db, makeSignal({ kind: "deploy", channel: "deploys", ts: "ts-deploy" }), 1000);
  const row = db.query("SELECT kind FROM signals WHERE channel='deploys'").get() as any;
  expect(row.kind).toBe("deploy");
});

test("upsertSignal stores optional status field", () => {
  const db = openDb(":memory:");
  upsertSignal(db, makeSignal({ status: "resolved" }), 1000);
  const row = db.query("SELECT status FROM signals WHERE channel='alerts-prod'").get() as any;
  expect(row.status).toBe("resolved");
});

// --- markResolvedHeuristic ---

test("markResolvedHeuristic does not resolve recent mention (within 24h)", () => {
  const db = openDb(":memory:");
  const now = 1_000_000_000_000;
  upsertMention(db, makeMention({ author: "Alice", channel: "C-recent" }), now - 3_600_000); // 1h ago, non-Lenyn author
  markResolvedHeuristic(db, now);
  const row = db.query("SELECT resolved FROM mentions WHERE channel_id='C-recent'").get() as any;
  expect(row.resolved).toBe(0);
});

test("markResolvedHeuristic resolves mention older than 24h", () => {
  const db = openDb(":memory:");
  const now = 1_000_000_000_000;
  upsertMention(db, makeMention({ author: "Bob", channel: "C-old" }), now - 90_000_000); // ~25h ago
  markResolvedHeuristic(db, now);
  const row = db.query("SELECT resolved FROM mentions WHERE channel_id='C-old'").get() as any;
  expect(row.resolved).toBe(1);
});

test("markResolvedHeuristic resolves mention whose author contains 'lenyn'", () => {
  const db = openDb(":memory:");
  const now = 1_000_000_000_000;
  upsertMention(db, makeMention({ author: "Lenyn Alcantara" }), now - 3_600_000); // recent
  markResolvedHeuristic(db, now);
  const row = db.query("SELECT resolved FROM mentions WHERE channel_id='C001'").get() as any;
  expect(row.resolved).toBe(1);
});

test("markResolvedHeuristic never overrides resolved_manual", () => {
  const db = openDb(":memory:");
  const now = 1_000_000_000_000;
  upsertMention(db, makeMention(), now - 90_000_000); // old enough
  // simulate manual override: set resolved_manual = 1 means user marked it resolved
  db.run("UPDATE mentions SET resolved_manual = 1 WHERE channel_id = 'C001'");
  markResolvedHeuristic(db, now);
  // resolved_manual row is not in the heuristic path but resolved could have been updated
  // key: set resolved=0 manually to test heuristic skips it when resolved_manual is set
  db.run("UPDATE mentions SET resolved = 0 WHERE channel_id = 'C001'");
  markResolvedHeuristic(db, now);
  const row = db.query("SELECT resolved FROM mentions WHERE channel_id='C001'").get() as any;
  expect(row.resolved).toBe(0); // heuristic must not flip it
});

test("markResolvedHeuristic does not re-resolve already resolved mention", () => {
  const db = openDb(":memory:");
  const now = 1_000_000_000_000;
  upsertMention(db, makeMention({ author: "Carol", channel: "C-idem" }), now - 90_000_000);
  markResolvedHeuristic(db, now); // resolves it
  db.run("UPDATE mentions SET ask_count = 99 WHERE channel_id='C-idem'"); // sentinel
  markResolvedHeuristic(db, now); // idempotent
  const row = db.query("SELECT resolved, ask_count FROM mentions WHERE channel_id='C-idem'").get() as any;
  expect(row.resolved).toBe(1);
  expect(row.ask_count).toBe(99); // unchanged
});

// --- matchToSessions ---

function insertSession(db: ReturnType<typeof openDb>, id: string, opts: { name?: string; cwd?: string; summary?: string; status?: string } = {}): void {
  db.run(
    `INSERT INTO sessions (id, instance, status, name, cwd, summary, started_at, last_activity)
     VALUES (?, 'test', ?, ?, ?, ?, 0, ?)`,
    [id, opts.status ?? "running", opts.name ?? null, opts.cwd ?? null, opts.summary ?? null, Date.now()]
  );
}

test("matchToSessions assigns session when clear token overlap (>= 2 tokens)", async () => {
  const db = openDb(":memory:");
  insertSession(db, "s-auth", { name: "auth refactor", cwd: "/home/user/acme-api" });
  upsertMention(db, makeMention({ text: "hey can you review the auth refactor PR?", channel_id: "C100", thread_ts: "ts1" }), 1000);

  const noopRunner: LlmRunner = async () => "[]";
  await matchToSessions(db, noopRunner, "es", Date.now());

  const row = db.query("SELECT session_id FROM mentions WHERE channel_id='C100'").get() as any;
  expect(row.session_id).toBe("s-auth");
});

test("matchToSessions leaves session_id null when no tokens overlap", async () => {
  const db = openDb(":memory:");
  insertSession(db, "s-xyz", { name: "xyz project", cwd: "/home/user/xyz" });
  upsertMention(db, makeMention({ text: "hello world foo bar baz", channel_id: "C200", thread_ts: "ts2" }), 1000);

  let llmCalled = false;
  const runner: LlmRunner = async () => { llmCalled = true; return "[]"; };
  await matchToSessions(db, runner, "es", Date.now());

  const row = db.query("SELECT session_id FROM mentions WHERE channel_id='C200'").get() as any;
  expect(row.session_id).toBeNull();
  expect(llmCalled).toBe(true); // ambiguous case fell through to llm
});

test("matchToSessions applies llm runner result for ambiguous mention", async () => {
  const db = openDb(":memory:");
  insertSession(db, "s-api", { name: "api work", cwd: "/home/user/acme-svc-api" });
  upsertMention(db, makeMention({ text: "unrelated text", channel_id: "C300", thread_ts: "ts3" }), 1000);

  const mentionId = (db.query("SELECT id FROM mentions WHERE channel_id='C300'").get() as any).id;
  const runner: LlmRunner = async () => JSON.stringify([{ idx: 0, session_id: "s-api" }]);
  await matchToSessions(db, runner, "es", Date.now());

  const row = db.query("SELECT session_id FROM mentions WHERE id=?").get(mentionId) as any;
  expect(row.session_id).toBe("s-api");
});

test("matchToSessions rejects session_id not in session list", async () => {
  const db = openDb(":memory:");
  insertSession(db, "s-real", { name: "real session", cwd: "/home/user/real" });
  upsertMention(db, makeMention({ text: "something vague", channel_id: "C400", thread_ts: "ts4" }), 1000);

  const runner: LlmRunner = async () => JSON.stringify([{ idx: 0, session_id: "s-fake-not-in-db" }]);
  await matchToSessions(db, runner, "es", Date.now());

  const row = db.query("SELECT session_id FROM mentions WHERE channel_id='C400'").get() as any;
  expect(row.session_id).toBeNull(); // rejected
});

test("matchToSessions returns early when no unlinked mentions/signals", async () => {
  const db = openDb(":memory:");
  let runnerCalled = false;
  const runner: LlmRunner = async () => { runnerCalled = true; return "[]"; };
  await matchToSessions(db, runner, "es", Date.now());
  expect(runnerCalled).toBe(false);
});

test("matchToSessions matches signals too", async () => {
  const db = openDb(":memory:");
  insertSession(db, "s-deploy", { name: "deploy pipeline", cwd: "/home/user/deploy" });
  upsertSignal(db, makeSignal({ text: "deploy pipeline failure on worker", ts: "ts-sig1" }), 1000);

  const noopRunner: LlmRunner = async () => "[]";
  await matchToSessions(db, noopRunner, "es", Date.now());

  const row = db.query("SELECT session_id FROM signals WHERE ts='ts-sig1'").get() as any;
  expect(row.session_id).toBe("s-deploy");
});

// --- runSlack ---

test("runSlack sequences fetch → upsert → heuristic → match (fake runners, no real CLI)", async () => {
  const db = openDb(":memory:");
  const now = 1_000_000_000_000;

  const mention: RawMention = makeMention({ text: "hey Lenyn can you check this?" });
  const signal: RawSignal = makeSignal();

  const slackRunner: SlackRunner = async (prompt) => {
    if (prompt.includes("mention")) return JSON.stringify([mention]);
    if (prompt.includes("channel") || prompt.includes("alert") || prompt.includes("deploy")) return JSON.stringify([signal]);
    return "[]";
  };
  const llmRunner: LlmRunner = async () => "[]";

  await runSlack(
    db, slackRunner, llmRunner,
    { slackChannelsAlerts: ["alerts-prod"], slackChannelsDeploys: [], language: "es" },
    now
  );

  const mentionCount = (db.query("SELECT COUNT(*) as c FROM mentions").get() as any).c;
  const signalCount = (db.query("SELECT COUNT(*) as c FROM signals").get() as any).c;
  expect(mentionCount).toBe(1);
  expect(signalCount).toBe(1);
});

test("runSlack resolves old mention via heuristic during run", async () => {
  const db = openDb(":memory:");
  const now = 1_000_000_000_000;
  const oldNow = now - 100_000_000; // ~27h ago

  // Pre-insert an old mention
  upsertMention(db, makeMention({ channel_id: "C-OLD", thread_ts: "ts-old" }), oldNow);

  const slackRunner: SlackRunner = async () => "[]";
  const llmRunner: LlmRunner = async () => "[]";

  await runSlack(db, slackRunner, llmRunner, {}, now);

  const row = db.query("SELECT resolved FROM mentions WHERE channel_id='C-OLD'").get() as any;
  expect(row.resolved).toBe(1); // heuristic resolved it
});

test("runSlack works with empty config (no Slack channels)", async () => {
  const db = openDb(":memory:");
  let slackCallCount = 0;
  const slackRunner: SlackRunner = async () => { slackCallCount++; return "[]"; };
  const llmRunner: LlmRunner = async () => "[]";

  await runSlack(db, slackRunner, llmRunner, {}, Date.now());

  // fetchMentions always runs; fetchSignals skips when no channels.
  // Empty "[]" triggers one retry, so fetchMentions calls the runner twice.
  expect(slackCallCount).toBe(2);
});

// --- retry logic ---

test("fetchMentions retries on max-turns and returns result from second call", async () => {
  const canned: RawMention[] = [makeMention({ text: "retry worked" })];
  let callCount = 0;
  const runner: SlackRunner = async () => {
    callCount++;
    if (callCount === 1) return "Error: Reached max turns";
    return JSON.stringify(canned);
  };
  const result = await fetchMentions(runner, Date.now());
  expect(result).toHaveLength(1);
  expect(result[0].text).toBe("retry worked");
  expect(callCount).toBe(2);
});

test("fetchMentions returns [] when both calls hit max-turns", async () => {
  const runner: SlackRunner = async () => "Error: Reached max turns";
  const result = await fetchMentions(runner, Date.now());
  expect(result).toEqual([]);
});

test("fetchMentions does not retry when runner returns SLACK_UNAVAILABLE (call count stays 1)", async () => {
  let callCount = 0;
  const runner: SlackRunner = async () => {
    callCount++;
    return SLACK_UNAVAILABLE;
  };
  const result = await fetchMentions(runner, Date.now());
  expect(result).toEqual([]);
  expect(callCount).toBe(1);
});
