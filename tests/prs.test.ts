import { test, expect, describe } from "bun:test";
import { fetchAndClassifyPRs, persistPRs } from "../src/prs";
import type { GhRunner } from "../src/links";
import { openDb } from "../src/db";
import { createServer } from "../src/server";

// ── fake data helpers ──────────────────────────────────────────────────────

const ME = "octocat";

function makePR(n: number, opts: {
  author?: string;
  isDraft?: boolean;
  repo?: string;
  updatedAt?: string;
}) {
  const repo = opts.repo ?? "acme/api";
  return {
    number: n,
    title: `PR ${n}`,
    repository: { nameWithOwner: repo },
    url: `https://github.com/${repo}/pull/${n}`,
    author: { login: opts.author ?? "other-user" },
    isDraft: opts.isDraft ?? false,
    updatedAt: opts.updatedAt ?? "2024-01-01T00:00:00Z",
  };
}

function makeDetail(opts: {
  author?: string;
  reviewDecision?: string | null;
  mergeable?: string;
  isDraft?: boolean;
  checks?: Array<{ conclusion: string | null }>;
  reviews?: Array<{ author: { login: string }; state: string; submittedAt?: string }>;
  latestReviews?: Array<{ author: { login: string }; state: string }>;
  comments?: Array<{ author: { login: string }; createdAt?: string }>;
}) {
  return {
    author: { login: opts.author ?? "other-user" },
    reviewDecision: opts.reviewDecision ?? null,
    mergeable: opts.mergeable ?? "MERGEABLE",
    isDraft: opts.isDraft ?? false,
    statusCheckRollup: opts.checks ?? null,
    reviews: opts.reviews ?? [],
    latestReviews: opts.latestReviews ?? [],
    comments: opts.comments ?? [],
  };
}

// ── test fixture: 6 PRs, one per bucket ───────────────────────────────────

// PR 1: needs_my_review — review requested from me, I haven't reviewed
const pr1 = makePR(1, { author: "alice" });
const detail1 = makeDetail({ author: "alice", reviews: [], latestReviews: [] });

// PR 2: changes_requested — mine, CHANGES_REQUESTED
const pr2 = makePR(2, { author: ME });
const detail2 = makeDetail({ author: ME, reviewDecision: "CHANGES_REQUESTED", reviews: [{ author: { login: "reviewer" }, state: "CHANGES_REQUESTED", submittedAt: "2024-01-02T00:00:00Z" }] });

// PR 3: commented_unanswered — involved, latest comment by someone else
const pr3 = makePR(3, { author: "bob" });
const detail3 = makeDetail({
  author: "bob",
  reviews: [],
  latestReviews: [],
  comments: [
    { author: { login: ME }, createdAt: "2024-01-01T00:00:00Z" },
    { author: { login: "bob" }, createdAt: "2024-01-02T00:00:00Z" },
  ],
});

// PR 4: mine_mergeable — mine, approved, all checks success, mergeable
const pr4 = makePR(4, { author: ME });
const detail4 = makeDetail({
  author: ME,
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  checks: [{ conclusion: "SUCCESS" }, { conclusion: "SUCCESS" }],
  reviews: [{ author: { login: "reviewer" }, state: "APPROVED" }],
});

// PR 5: mine_blocked — mine, draft
const pr5 = makePR(5, { author: ME, isDraft: true });
const detail5 = makeDetail({ author: ME, isDraft: true, reviewDecision: null });

// PR 6: reviewed_by_me — someone else's PR, I reviewed
const pr6 = makePR(6, { author: "carol" });
const detail6 = makeDetail({
  author: "carol",
  reviews: [{ author: { login: ME }, state: "APPROVED" }],
  latestReviews: [{ author: { login: ME }, state: "APPROVED" }],
  comments: [{ author: { login: ME }, createdAt: "2024-01-01T00:00:00Z" }],
});

const allPRs = [pr1, pr2, pr3, pr4, pr5, pr6];
const details: Record<number, object> = {
  1: detail1, 2: detail2, 3: detail3, 4: detail4, 5: detail5, 6: detail6,
};

function makeRunner(reviewRequestedNums: number[] = [1]): GhRunner {
  const rrSet = new Set(reviewRequestedNums);
  return async (args: string[]) => {
    const cmd = args.join(" ");
    if (cmd.includes("api") && cmd.includes("user")) return '"' + ME + '"';
    if (cmd.includes("--involves=@me")) return JSON.stringify(allPRs);
    if (cmd.includes("--review-requested=@me")) {
      return JSON.stringify(allPRs.filter(p => rrSet.has(p.number)));
    }
    // pr view <N> --repo acme/api
    const vmatch = cmd.match(/pr view (\d+)/);
    if (vmatch) {
      const n = parseInt(vmatch[1], 10);
      return JSON.stringify(details[n] ?? {});
    }
    return "[]";
  };
}

// ── classifier: all 6 buckets ─────────────────────────────────────────────

describe("fetchAndClassifyPRs: all 6 buckets", () => {
  test("needs_my_review: review-requested, not yet reviewed", async () => {
    const runner = makeRunner([1]);
    const results = await fetchAndClassifyPRs(ME, runner);
    const pr = results.find(r => r.number === 1);
    expect(pr).toBeDefined();
    expect(pr!.bucket).toBe("needs_my_review");
  });

  test("changes_requested: mine and CHANGES_REQUESTED", async () => {
    const runner = makeRunner([]);
    const results = await fetchAndClassifyPRs(ME, runner);
    const pr = results.find(r => r.number === 2);
    expect(pr).toBeDefined();
    expect(pr!.bucket).toBe("changes_requested");
  });

  test("commented_unanswered: involved, latest comment by other", async () => {
    const runner = makeRunner([]);
    const results = await fetchAndClassifyPRs(ME, runner);
    const pr = results.find(r => r.number === 3);
    expect(pr).toBeDefined();
    expect(pr!.bucket).toBe("commented_unanswered");
  });

  test("mine_mergeable: mine, approved, all checks success, mergeable", async () => {
    const runner = makeRunner([]);
    const results = await fetchAndClassifyPRs(ME, runner);
    const pr = results.find(r => r.number === 4);
    expect(pr).toBeDefined();
    expect(pr!.bucket).toBe("mine_mergeable");
  });

  test("mine_blocked: mine and draft", async () => {
    const runner = makeRunner([]);
    const results = await fetchAndClassifyPRs(ME, runner);
    const pr = results.find(r => r.number === 5);
    expect(pr).toBeDefined();
    expect(pr!.bucket).toBe("mine_blocked");
  });

  test("reviewed_by_me: not mine, I reviewed", async () => {
    const runner = makeRunner([]);
    const results = await fetchAndClassifyPRs(ME, runner);
    const pr = results.find(r => r.number === 6);
    expect(pr).toBeDefined();
    expect(pr!.bucket).toBe("reviewed_by_me");
  });
});

// ── priority ordering ─────────────────────────────────────────────────────

test("priority: mine+CHANGES_REQUESTED wins over mine_blocked", async () => {
  // PR 2 is mine and CHANGES_REQUESTED — should be changes_requested, not mine_blocked
  const runner = makeRunner([]);
  const results = await fetchAndClassifyPRs(ME, runner);
  const pr = results.find(r => r.number === 2);
  expect(pr!.bucket).toBe("changes_requested");
});

test("priority: mine+CHANGES_REQUESTED beats commented_unanswered", async () => {
  // PR 2 has reviews by someone, so there could be a comment. But changes_requested wins.
  const prX = makePR(99, { author: ME });
  const detailX = makeDetail({
    author: ME,
    reviewDecision: "CHANGES_REQUESTED",
    comments: [{ author: { login: "reviewer" }, createdAt: "2024-01-03T00:00:00Z" }],
    reviews: [{ author: { login: "reviewer" }, state: "CHANGES_REQUESTED", submittedAt: "2024-01-02T00:00:00Z" }],
  });
  const runner: GhRunner = async (args: string[]) => {
    const cmd = args.join(" ");
    if (cmd.includes("--involves=@me")) return JSON.stringify([prX]);
    if (cmd.includes("--review-requested=@me")) return "[]";
    if (cmd.includes("pr view 99")) return JSON.stringify(detailX);
    return "[]";
  };
  const results = await fetchAndClassifyPRs(ME, runner);
  const pr = results.find(r => r.number === 99);
  expect(pr!.bucket).toBe("changes_requested");
});

test("priority: needs_my_review beats commented_unanswered", async () => {
  // review-requested AND latest comment by someone else — needs_my_review wins
  const prX = makePR(98, { author: "alice" });
  const detailX = makeDetail({
    author: "alice",
    comments: [{ author: { login: "alice" }, createdAt: "2024-01-02T00:00:00Z" }],
    reviews: [],
    latestReviews: [],
  });
  const runner: GhRunner = async (args: string[]) => {
    const cmd = args.join(" ");
    if (cmd.includes("--involves=@me")) return JSON.stringify([prX]);
    if (cmd.includes("--review-requested=@me")) return JSON.stringify([prX]);
    if (cmd.includes("pr view 98")) return JSON.stringify(detailX);
    return "[]";
  };
  const results = await fetchAndClassifyPRs(ME, runner);
  const pr = results.find(r => r.number === 98);
  expect(pr!.bucket).toBe("needs_my_review");
});

// ── return shape ──────────────────────────────────────────────────────────

test("return shape has required fields", async () => {
  const runner = makeRunner([1]);
  const results = await fetchAndClassifyPRs(ME, runner);
  expect(results.length).toBeGreaterThan(0);
  for (const row of results) {
    expect(typeof row.number).toBe("number");
    expect(typeof row.repo).toBe("string");
    expect(typeof row.title).toBe("string");
    expect(typeof row.url).toBe("string");
    expect(typeof row.author).toBe("string");
    expect(["needs_my_review","changes_requested","commented_unanswered","mine_mergeable","mine_blocked","reviewed_by_me"]).toContain(row.bucket);
    expect(typeof row.isDraft).toBe("boolean");
    expect(typeof row.updatedAt).toBe("string");
    // checks is 'success'|'failing'|'pending'|null
    expect([null, "success", "failing", "pending"]).toContain(row.checks);
  }
});

// ── dedup: same PR from both searches appears once ────────────────────────

test("dedup: PR in both involves and review-requested appears once", async () => {
  const prX = makePR(50, { author: "alice" });
  const detailX = makeDetail({ author: "alice", reviews: [], latestReviews: [] });
  const runner: GhRunner = async (args: string[]) => {
    const cmd = args.join(" ");
    if (cmd.includes("--involves=@me")) return JSON.stringify([prX]);
    if (cmd.includes("--review-requested=@me")) return JSON.stringify([prX]);
    if (cmd.includes("pr view 50")) return JSON.stringify(detailX);
    return "[]";
  };
  const results = await fetchAndClassifyPRs(ME, runner);
  const all50 = results.filter(r => r.number === 50);
  expect(all50.length).toBe(1);
  expect(all50[0].bucket).toBe("needs_my_review");
});

// ── bot filtering: bot comments don't count for commented_unanswered ──────

test("bot comments don't trigger commented_unanswered", async () => {
  const prX = makePR(51, { author: "alice" });
  const detailX = makeDetail({
    author: "alice",
    comments: [{ author: { login: "github-actions[bot]" }, createdAt: "2024-01-02T00:00:00Z" }],
    reviews: [],
    latestReviews: [],
  });
  const runner: GhRunner = async (args: string[]) => {
    const cmd = args.join(" ");
    if (cmd.includes("--involves=@me")) return JSON.stringify([prX]);
    if (cmd.includes("--review-requested=@me")) return "[]";
    if (cmd.includes("pr view 51")) return JSON.stringify(detailX);
    return "[]";
  };
  const results = await fetchAndClassifyPRs(ME, runner);
  const pr = results.find(r => r.number === 51);
  // no bucket should be commented_unanswered — if not mine and not reviewed, gets dropped
  if (pr) {
    expect(pr.bucket).not.toBe("commented_unanswered");
  }
});

// ── persistPRs ────────────────────────────────────────────────────────────

test("persistPRs upserts rows into prs table", () => {
  const db = openDb(":memory:");
  const items = [
    {
      number: 42, repo: "acme/api", title: "Fix auth", url: "https://github.com/acme/api/pull/42",
      author: "alice", bucket: "needs_my_review" as const, isDraft: false,
      reviewDecision: null, checks: null, updatedAt: "2024-01-01T00:00:00Z",
    },
  ];
  persistPRs(db, items);
  const rows = db.query("SELECT * FROM prs").all() as any[];
  expect(rows.length).toBe(1);
  expect(rows[0].repo).toBe("acme/api");
  expect(rows[0].number).toBe(42);
  expect(rows[0].bucket).toBe("needs_my_review");
});

test("persistPRs upserts on (repo, number): updates bucket when re-inserted", () => {
  const db = openDb(":memory:");
  const base = {
    number: 42, repo: "acme/api", title: "Fix auth", url: "https://github.com/acme/api/pull/42",
    author: "alice", isDraft: false, reviewDecision: null, checks: null as const,
    updatedAt: "2024-01-01T00:00:00Z",
  };
  persistPRs(db, [{ ...base, bucket: "needs_my_review" as const }]);
  persistPRs(db, [{ ...base, bucket: "reviewed_by_me" as const }]);
  const rows = db.query("SELECT * FROM prs").all() as any[];
  expect(rows.length).toBe(1);
  expect(rows[0].bucket).toBe("reviewed_by_me");
});

// ── /api/prs endpoint ─────────────────────────────────────────────────────

test("GET /api/prs returns grouped rows by bucket with counts", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  // Seed prs table directly
  db.run(
    `INSERT INTO prs (repo, number, title, url, author, bucket, is_draft, review_decision, checks, updated_at, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ["acme/api", 1, "PR 1", "https://github.com/acme/api/pull/1", "alice", "needs_my_review", 0, null, null, "2024-01-01T00:00:00Z", now]
  );
  db.run(
    `INSERT INTO prs (repo, number, title, url, author, bucket, is_draft, review_decision, checks, updated_at, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ["acme/api", 2, "PR 2", "https://github.com/acme/api/pull/2", "octocat", "changes_requested", 0, "CHANGES_REQUESTED", null, "2024-01-01T00:00:00Z", now]
  );
  const srv = createServer(db, { port: 0 });
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/prs`);
  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(Array.isArray(body.prs)).toBe(true);
  expect(typeof body.counts).toBe("object");
  expect(body.prs.length).toBe(2);
  // needs_my_review and changes_requested should be in actionable count
  expect(body.counts.needs_my_review).toBe(1);
  expect(body.counts.changes_requested).toBe(1);
  srv.stop();
});

test("GET /api/prs returns prs sorted by bucket order then updated_at DESC", async () => {
  const db = openDb(":memory:");
  const now = Date.now();
  db.run(
    `INSERT INTO prs (repo, number, title, url, author, bucket, is_draft, review_decision, checks, updated_at, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ["acme/api", 10, "P10", "url", "alice", "mine_blocked", 0, null, null, "2024-01-01T00:00:00Z", now]
  );
  db.run(
    `INSERT INTO prs (repo, number, title, url, author, bucket, is_draft, review_decision, checks, updated_at, fetched_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ["acme/api", 11, "P11", "url", "alice", "needs_my_review", 0, null, null, "2024-01-02T00:00:00Z", now]
  );
  const srv = createServer(db, { port: 0 });
  const body = await (await fetch(`http://127.0.0.1:${srv.port}/api/prs`)).json() as any;
  // needs_my_review (bucket order 0) before mine_blocked (order 4)
  expect(body.prs[0].bucket).toBe("needs_my_review");
  expect(body.prs[1].bucket).toBe("mine_blocked");
  srv.stop();
});
