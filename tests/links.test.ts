import { test, expect } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { openDb } from "../src/db";
import {
  extractPRs,
  extractLinear,
  extractArtifacts,
  extractArtifactUrls,
  extractSlackThreads,
  syncLinks,
  enrichPRs,
  type GhRunner,
  type GitRunner,
} from "../src/links";
import { readToolUses } from "../src/transcript";

// ── extractPRs ──────────────────────────────────────────────────────────────

test("extractPRs: finds single PR ref", () => {
  const results = extractPRs("PR #123", "/home/user/acme-api");
  expect(results).toHaveLength(1);
  expect(results[0]).toEqual({ repo: "acme-api", number: 123 });
});

test("extractPRs: finds multiple PR refs", () => {
  const results = extractPRs("PR #123 and #456", "/home/user/acme-api");
  expect(results).toHaveLength(2);
  expect(results[0].number).toBe(123);
  expect(results[1].number).toBe(456);
});

test("extractPRs: deduplicates repeated refs", () => {
  const results = extractPRs("PR #100 and PR #100", "/home/user/repo");
  expect(results).toHaveLength(1);
  expect(results[0].number).toBe(100);
});

test("extractPRs: returns empty when no refs in text", () => {
  expect(extractPRs("no pull requests here", "/home/user/myrepo")).toHaveLength(0);
});

test("extractPRs: uses unknown repo when cwd is empty", () => {
  const results = extractPRs("PR #7", "");
  expect(results[0].repo).toBe("unknown");
});

test("extractPRs: explicit repo#num uses the repo from text", () => {
  const results = extractPRs("acme-web#123", "/home/user/other-repo");
  expect(results).toHaveLength(1);
  expect(results[0]).toEqual({ repo: "acme-web", number: 123 });
});

test("extractPRs: bare #num without PR context is not extracted", () => {
  expect(extractPRs("step #3", "/home/user/repo")).toHaveLength(0);
  expect(extractPRs("error #500", "/home/user/repo")).toHaveLength(0);
});

test("extractPRs: bare #num with PR context uses cwd repo", () => {
  const results = extractPRs("PR #4551", "/home/user/acme-api");
  expect(results).toHaveLength(1);
  expect(results[0]).toEqual({ repo: "acme-api", number: 4551 });
});

// ── extractLinear ───────────────────────────────────────────────────────────

test("extractLinear: finds CON ref", () => {
  expect(extractLinear("working on CON-1234")).toContain("CON-1234");
});

test("extractLinear: finds ENG ref", () => {
  expect(extractLinear("ENG-5678 is blocked")).toContain("ENG-5678");
});

test("extractLinear: finds multiple refs", () => {
  const refs = extractLinear("CON-1 and ENG-2 and CON-1");
  expect(refs).toContain("CON-1");
  expect(refs).toContain("ENG-2");
  expect(refs).toHaveLength(2); // deduped
});

test("extractLinear: returns empty for text with no issue refs", () => {
  expect(extractLinear("no linear issues here")).toHaveLength(0);
});

test("extractLinear: does not match lowercase", () => {
  expect(extractLinear("con-123")).toHaveLength(0);
});

test("extractLinear: denylist filters GPT-5", () => {
  expect(extractLinear("using GPT-5 model")).toHaveLength(0);
});

test("extractLinear: denylist filters UTF-8", () => {
  expect(extractLinear("encoded as UTF-8")).toHaveLength(0);
});

test("extractLinear: denylist filters SHA and RFC refs", () => {
  expect(extractLinear("SHA-256 hash per RFC-2381")).toHaveLength(0);
});

test("extractLinear: does not filter real Linear refs", () => {
  const refs = extractLinear("working on CON-2381 and ENG-42");
  expect(refs).toContain("CON-2381");
  expect(refs).toContain("ENG-42");
});

// ── extractArtifacts ────────────────────────────────────────────────────────

test("extractArtifacts: matches files under docs/", () => {
  const arts = extractArtifacts(["/home/user/docs/runbook.md", "/home/user/src/auth.ts"]);
  expect(arts.map(a => a.path)).toContain("/home/user/docs/runbook.md");
  expect(arts.map(a => a.path)).not.toContain("/home/user/src/auth.ts");
});

test("extractArtifacts: matches .md files", () => {
  const arts = extractArtifacts(["/notes/summary.md"]);
  expect(arts).toHaveLength(1);
});

test("extractArtifacts: matches .html files", () => {
  const arts = extractArtifacts(["/output/report.html"]);
  expect(arts).toHaveLength(1);
  expect(arts[0].path).toBe("/output/report.html");
});

test("extractArtifacts: returns empty for non-matching files", () => {
  expect(extractArtifacts(["/src/foo.ts", "/src/bar.go"])).toHaveLength(0);
});

// ── extractArtifactUrls ─────────────────────────────────────────────────────

test("extractArtifactUrls: finds claude.ai artifact URL in tool_use input", () => {
  const toolUses = [
    { name: "Artifact", input: { url: "https://claude.ai/artifacts/abc123" } },
  ];
  const result = extractArtifactUrls(toolUses, "");
  expect(result).toHaveLength(1);
  expect(result[0].url).toBe("https://claude.ai/artifacts/abc123");
});

test("extractArtifactUrls: finds public artifact URL in text", () => {
  const result = extractArtifactUrls([], "see https://claude.ai/public/artifacts/xyz789 for details");
  expect(result).toHaveLength(1);
  expect(result[0].url).toBe("https://claude.ai/public/artifacts/xyz789");
});

test("extractArtifactUrls: deduplicates same URL from tool_use and text", () => {
  const url = "https://claude.ai/artifacts/dup001";
  const toolUses = [{ name: "Artifact", input: { url } }];
  const result = extractArtifactUrls(toolUses, `check ${url} above`);
  expect(result).toHaveLength(1);
});

test("extractArtifactUrls: returns empty for no artifact URLs", () => {
  expect(extractArtifactUrls([], "no urls here")).toHaveLength(0);
  expect(extractArtifactUrls([{ name: "Read", input: { file_path: "/foo.ts" } }], "")).toHaveLength(0);
});

// ── extractSlackThreads ─────────────────────────────────────────────────────

test("extractSlackThreads: finds slack tool use by name", () => {
  const toolUses = [
    {
      name: "mcp__slack__read_thread",
      input: { channel: "C123", thread_ts: "1234567890.123" },
    },
    { name: "Read", input: { file_path: "/foo.ts" } },
  ];
  const threads = extractSlackThreads(toolUses);
  expect(threads).toHaveLength(1);
  expect(threads[0]).toEqual({ channel: "C123", thread_ts: "1234567890.123" });
});

test("extractSlackThreads: handles channel_id and ts aliases", () => {
  const toolUses = [
    {
      name: "mcp__claude_ai_Slack__slack_send_message",
      input: { channel_id: "C999", ts: "999.1" },
    },
  ];
  const threads = extractSlackThreads(toolUses);
  expect(threads[0]).toEqual({ channel: "C999", thread_ts: "999.1" });
});

test("extractSlackThreads: deduplicates same channel+thread", () => {
  const toolUses = [
    { name: "mcp__slack__foo", input: { channel: "C1", thread_ts: "1.0" } },
    { name: "mcp__slack__bar", input: { channel: "C1", thread_ts: "1.0" } },
  ];
  expect(extractSlackThreads(toolUses)).toHaveLength(1);
});

test("extractSlackThreads: returns empty for non-slack tool uses", () => {
  const toolUses = [
    { name: "Read", input: { file_path: "/foo.ts" } },
    { name: "Bash", input: { command: "ls" } },
  ];
  expect(extractSlackThreads(toolUses)).toHaveLength(0);
});

test("extractSlackThreads: skips entries missing channel or thread_ts", () => {
  const toolUses = [
    { name: "mcp__slack__foo", input: { channel: "C1" } }, // no thread_ts
    { name: "mcp__slack__bar", input: { thread_ts: "1.0" } }, // no channel
  ];
  expect(extractSlackThreads(toolUses)).toHaveLength(0);
});

// ── readToolUses (transcript.ts extension) ──────────────────────────────────

test("readToolUses: returns empty for missing file", () => {
  expect(readToolUses("/nonexistent/path.jsonl")).toHaveLength(0);
});

test("readToolUses: extracts tool_use entries from transcript", () => {
  const path = "/tmp/cl-links-test-readtu.jsonl";
  writeFileSync(
    path,
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "mcp__slack__read_thread",
            input: { channel: "C123", thread_ts: "1.2" },
          },
        ],
      },
    }) + "\n"
  );
  const uses = readToolUses(path);
  expect(uses).toHaveLength(1);
  expect(uses[0].name).toBe("mcp__slack__read_thread");
  expect(uses[0].input.channel).toBe("C123");
  unlinkSync(path);
});

test("readToolUses: tolerates malformed lines", () => {
  const path = "/tmp/cl-links-test-malformed.jsonl";
  writeFileSync(path, "not-json\n" + JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } }) + "\n");
  expect(() => readToolUses(path)).not.toThrow();
  expect(readToolUses(path)).toHaveLength(1);
  unlinkSync(path);
});

test("readToolUses: tail-biased cap limits results", () => {
  const path = "/tmp/cl-links-test-cap.jsonl";
  const lines = Array.from({ length: 10 }, (_, i) =>
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: `tool${i}`, input: {} }] },
    })
  );
  writeFileSync(path, lines.join("\n") + "\n");
  const uses = readToolUses(path, 3);
  expect(uses).toHaveLength(3);
  expect(uses[2].name).toBe("tool9");
  unlinkSync(path);
});

// ── syncLinks ───────────────────────────────────────────────────────────────

function makeSession(
  db: ReturnType<typeof openDb>,
  id: string,
  kind = "session",
  transcriptPath: string | null = null,
  cwd: string | null = null
): void {
  db.run(
    `INSERT INTO sessions (id, instance, kind, status, started_at, last_activity, transcript_path, cwd)
     VALUES (?, 'personal', ?, 'running', 1000, ${Date.now()}, ?, ?)`,
    [id, kind, transcriptPath, cwd]
  );
}

test("syncLinks: upserts artifact links from session_files", async () => {
  const db = openDb(":memory:");
  makeSession(db, "s1");
  db.run(`INSERT INTO session_files (session_id, path) VALUES ('s1', '/home/user/docs/runbook.md')`);
  await syncLinks(db, "s1");
  const links: any[] = db.query("SELECT * FROM links WHERE session_id='s1'").all();
  expect(links.some(l => l.kind === "artifact" && l.ref.includes("runbook.md"))).toBe(true);
});

test("syncLinks: upserts claude.ai artifact URL with url field set", async () => {
  const path = "/tmp/cl-links-art-url.jsonl";
  writeFileSync(
    path,
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Artifact",
            input: { url: "https://claude.ai/artifacts/test-abc" },
          },
        ],
      },
    }) + "\n"
  );
  const db = openDb(":memory:");
  makeSession(db, "s1", "session", path);
  await syncLinks(db, "s1");
  const link: any = db
    .query("SELECT * FROM links WHERE session_id='s1' AND kind='artifact' AND ref='https://claude.ai/artifacts/test-abc'")
    .get();
  expect(link).not.toBeNull();
  expect(link.url).toBe("https://claude.ai/artifacts/test-abc");
  unlinkSync(path);
});

test("syncLinks: local file artifact has url=null", async () => {
  const db = openDb(":memory:");
  makeSession(db, "s1");
  db.run("INSERT INTO session_files (session_id, path) VALUES ('s1', '/home/user/docs/guide.md')");
  await syncLinks(db, "s1");
  const link: any = db
    .query("SELECT url FROM links WHERE session_id='s1' AND kind='artifact' AND ref='/home/user/docs/guide.md'")
    .get();
  expect(link).not.toBeNull();
  expect(link.url).toBeNull();
});

test("syncLinks: dedupe for artifact URL on repeated calls", async () => {
  const path = "/tmp/cl-links-art-dedupe.jsonl";
  writeFileSync(
    path,
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "Artifact",
            input: { url: "https://claude.ai/artifacts/dedup-xyz" },
          },
        ],
      },
    }) + "\n"
  );
  const db = openDb(":memory:");
  makeSession(db, "s1", "session", path);
  await syncLinks(db, "s1");
  await syncLinks(db, "s1");
  const count: any = db
    .query("SELECT COUNT(*) as c FROM links WHERE session_id='s1' AND kind='artifact' AND ref='https://claude.ai/artifacts/dedup-xyz'")
    .get();
  expect(count.c).toBe(1);
  unlinkSync(path);
});

test("syncLinks: deduplicates links on repeated calls", async () => {
  const path = "/tmp/cl-links-dedupe.jsonl";
  writeFileSync(
    path,
    JSON.stringify({ type: "user", message: { content: "PR #100" } }) + "\n"
  );
  const db = openDb(":memory:");
  makeSession(db, "s1", "session", path, "/home/user/myrepo");
  await syncLinks(db, "s1");
  await syncLinks(db, "s1");
  const count: any = db
    .query("SELECT COUNT(*) as c FROM links WHERE session_id='s1' AND kind='pr'")
    .get();
  expect(count.c).toBe(1);
  unlinkSync(path);
});

test("syncLinks: extracts PR links from transcript text", async () => {
  const path = "/tmp/cl-links-pr.jsonl";
  writeFileSync(
    path,
    JSON.stringify({ type: "user", message: { content: "reviewed PR #42 and PR #99" } }) + "\n"
  );
  const db = openDb(":memory:");
  makeSession(db, "s1", "session", path, "/home/user/acme-api");
  await syncLinks(db, "s1");
  const links: any[] = db
    .query("SELECT ref FROM links WHERE session_id='s1' AND kind='pr'")
    .all();
  expect(links.some(l => l.ref === "acme-api#42")).toBe(true);
  expect(links.some(l => l.ref === "acme-api#99")).toBe(true);
  unlinkSync(path);
});

test("syncLinks: extracts Linear links from transcript text", async () => {
  const path = "/tmp/cl-links-linear.jsonl";
  writeFileSync(
    path,
    JSON.stringify({ type: "user", message: { content: "working on CON-1234" } }) + "\n"
  );
  const db = openDb(":memory:");
  makeSession(db, "s1", "session", path, "/home/user/repo");
  await syncLinks(db, "s1");
  const links: any[] = db
    .query("SELECT ref FROM links WHERE session_id='s1' AND kind='linear'")
    .all();
  expect(links.some(l => l.ref === "CON-1234")).toBe(true);
  unlinkSync(path);
});

test("syncLinks: in-session slack sets mentions.session_id when channel+thread_ts match", async () => {
  const path = "/tmp/cl-links-slack.jsonl";
  writeFileSync(
    path,
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "mcp__slack__read_thread",
            input: { channel: "C123", thread_ts: "1234.5" },
          },
        ],
      },
    }) + "\n"
  );
  const db = openDb(":memory:");
  makeSession(db, "s1", "session", path);
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, session_id) VALUES ('C123', '1234.5', 'user1', NULL)`
  );
  await syncLinks(db, "s1");
  const mention: any = db
    .query("SELECT session_id FROM mentions WHERE channel_id='C123' AND thread_ts='1234.5'")
    .get();
  expect(mention.session_id).toBe("s1");
  unlinkSync(path);
});

test("syncLinks: does not overwrite existing mentions.session_id", async () => {
  const path = "/tmp/cl-links-slack2.jsonl";
  writeFileSync(
    path,
    JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            name: "mcp__slack__read_thread",
            input: { channel: "C123", thread_ts: "9999.0" },
          },
        ],
      },
    }) + "\n"
  );
  const db = openDb(":memory:");
  makeSession(db, "s1", "session", path);
  db.run(
    `INSERT INTO mentions (channel_id, thread_ts, author, session_id) VALUES ('C123', '9999.0', 'user1', 'old-session')`
  );
  await syncLinks(db, "s1");
  const mention: any = db
    .query("SELECT session_id FROM mentions WHERE channel_id='C123' AND thread_ts='9999.0'")
    .get();
  expect(mention.session_id).toBe("old-session");
  unlinkSync(path);
});

test("syncLinks: worker sessions are skipped entirely", async () => {
  const db = openDb(":memory:");
  makeSession(db, "w1", "worker");
  db.run(`INSERT INTO session_files (session_id, path) VALUES ('w1', '/docs/foo.md')`);
  await syncLinks(db, "w1");
  const count: any = db
    .query("SELECT COUNT(*) as c FROM links WHERE session_id='w1'")
    .get();
  expect(count.c).toBe(0);
});

test("syncLinks: nonexistent session_id is a no-op", async () => {
  const db = openDb(":memory:");
  await expect(syncLinks(db, "does-not-exist")).resolves.toBeUndefined();
});

test("syncLinks: git remote repo overrides cwd basename for bare #num", async () => {
  const path = "/tmp/cl-links-git-override.jsonl";
  writeFileSync(path, JSON.stringify({ type: "user", message: { content: "PR #42" } }) + "\n");
  const db = openDb(":memory:");
  makeSession(db, "s1", "session", path, "/home/user/local-checkout");

  const fakeGitRunner: GitRunner = async (args) => {
    if (args.includes("rev-parse")) return "main";
    if (args.includes("get-url")) return "git@github.com:acme/acme-api.git";
    return "";
  };

  await syncLinks(db, "s1", fakeGitRunner);
  const links: any[] = db.query("SELECT ref FROM links WHERE session_id='s1' AND kind='pr'").all();
  expect(links.some(l => l.ref === "acme-api#42")).toBe(true);
  expect(links.every(l => l.kind !== "pr" || !l.ref.startsWith("local-checkout"))).toBe(true);
  unlinkSync(path);
});

test("syncLinks: falls back to cwd basename when git returns null", async () => {
  const path = "/tmp/cl-links-git-fallback.jsonl";
  writeFileSync(path, JSON.stringify({ type: "user", message: { content: "PR #77" } }) + "\n");
  const db = openDb(":memory:");
  makeSession(db, "s1", "session", path, "/home/user/my-app");

  const fakeGitRunner: GitRunner = async () => { throw new Error("not a git repo"); };

  await syncLinks(db, "s1", fakeGitRunner);
  const links: any[] = db.query("SELECT ref FROM links WHERE session_id='s1' AND kind='pr'").all();
  expect(links.some(l => l.ref === "my-app#77")).toBe(true);
  unlinkSync(path);
});

test("syncLinks: stores git_repo and git_branch on session", async () => {
  const db = openDb(":memory:");
  makeSession(db, "s1", "session", null, "/home/user/proj");

  const fakeGitRunner: GitRunner = async (args) => {
    if (args.includes("rev-parse")) return "feat/my-branch";
    if (args.includes("get-url")) return "https://github.com/myorg/myrepo";
    return "";
  };

  await syncLinks(db, "s1", fakeGitRunner);
  const row: any = db.query("SELECT git_repo, git_branch FROM sessions WHERE id='s1'").get();
  expect(row.git_repo).toBe("myorg/myrepo");
  expect(row.git_branch).toBe("feat/my-branch");
});

// ── enrichPRs ────────────────────────────────────────────────────────────────

function seedPrLink(db: ReturnType<typeof openDb>, ref: string): void {
  db.run(
    "INSERT OR IGNORE INTO sessions (id, instance, kind, status, started_at, last_activity) VALUES ('s1','personal','session','running',1000,?)",
    [Date.now()]
  );
  db.run(
    "INSERT OR IGNORE INTO links (session_id, kind, ref) VALUES ('s1', 'pr', ?)",
    [ref]
  );
}

test("enrichPRs: sets title, state, checks from gh output", async () => {
  const db = openDb(":memory:");
  seedPrLink(db, "acme-web#123");
  db.run("UPDATE sessions SET git_repo='acme/acme-web' WHERE id='s1'");

  const fakeGh: GhRunner = async (args) => {
    // Verify args are an array with repo/number as separate elements (no shell interpolation)
    expect(args).toContain("123");
    expect(args).toContain("acme/acme-web");
    expect(args[0]).toBe("gh");
    return JSON.stringify({
      title: "Fix the bug",
      state: "OPEN",
      statusCheckRollup: [{ name: "ci", conclusion: "SUCCESS" }],
    });
  };

  await enrichPRs(db, fakeGh);

  const link: any = db
    .query("SELECT * FROM links WHERE ref='acme-web#123'")
    .get();
  expect(link.title).toBe("Fix the bug");
  const meta = JSON.parse(link.meta);
  expect(meta.state).toBe("OPEN");
  expect(Array.isArray(meta.checks)).toBe(true);
  expect(meta.checks).toHaveLength(1);
  expect(meta.checks[0].name).toBe("ci");
  expect(meta.fullRepo).toBe("acme/acme-web");
});

test("enrichPRs: skips repos with no session git_repo", async () => {
  const db = openDb(":memory:");
  seedPrLink(db, "unknown-org-repo#99");

  let called = false;
  const fakeGh: GhRunner = async () => {
    called = true;
    return "{}";
  };

  await enrichPRs(db, fakeGh);

  expect(called).toBe(false);
  const link: any = db.query("SELECT title FROM links WHERE ref='unknown-org-repo#99'").get();
  expect(link.title).toBeNull();
});

test("enrichPRs: tolerates malformed gh output (non-JSON)", async () => {
  const db = openDb(":memory:");
  seedPrLink(db, "acme-api#7");
  db.run("UPDATE sessions SET git_repo='acme/acme-api' WHERE id='s1'");

  const fakeGh: GhRunner = async () => "not valid json {{{{";

  await expect(enrichPRs(db, fakeGh)).resolves.toBeUndefined();
  // link title stays null — no crash
  const link: any = db.query("SELECT title FROM links WHERE ref='acme-api#7'").get();
  expect(link.title).toBeNull();
});

test("enrichPRs: tolerates gh runner throwing", async () => {
  const db = openDb(":memory:");
  seedPrLink(db, "acme-web#55");
  db.run("UPDATE sessions SET git_repo='acme/acme-web' WHERE id='s1'");

  const fakeGh: GhRunner = async () => {
    throw new Error("gh not found");
  };

  await expect(enrichPRs(db, fakeGh)).resolves.toBeUndefined();
});

test("enrichPRs: skips links that already have a title", async () => {
  const db = openDb(":memory:");
  db.run(
    "INSERT OR IGNORE INTO sessions (id, instance, kind, status, started_at, last_activity) VALUES ('s1','personal','session','running',1000,?)",
    [Date.now()]
  );
  db.run(
    "INSERT INTO links (session_id, kind, ref, title) VALUES ('s1', 'pr', 'acme-api#10', 'Already set')"
  );

  let called = false;
  const fakeGh: GhRunner = async () => {
    called = true;
    return "{}";
  };

  await enrichPRs(db, fakeGh);

  expect(called).toBe(false);
  const link: any = db.query("SELECT title FROM links WHERE ref='acme-api#10'").get();
  expect(link.title).toBe("Already set");
});

test("enrichPRs: handles missing title/state fields in gh JSON gracefully", async () => {
  const db = openDb(":memory:");
  seedPrLink(db, "acme-api#200");
  db.run("UPDATE sessions SET git_repo='acme/acme-api' WHERE id='s1'");

  const fakeGh: GhRunner = async () => JSON.stringify({ statusCheckRollup: null });

  await enrichPRs(db, fakeGh);

  const link: any = db.query("SELECT title, meta FROM links WHERE ref='acme-api#200'").get();
  expect(link.title).toBeNull();
  const meta = JSON.parse(link.meta);
  expect(meta.state).toBeNull();
  expect(meta.checks).toBeNull();
});
