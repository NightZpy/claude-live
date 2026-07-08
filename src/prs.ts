import type { Database } from "bun:sqlite";
import { defaultGhRunner } from "./links";
import type { GhRunner } from "./links";

export type PRBucket =
  | "needs_my_review"
  | "changes_requested"
  | "commented_unanswered"
  | "mine_mergeable"
  | "mine_blocked"
  | "reviewed_by_me";

export const BUCKET_ORDER: PRBucket[] = [
  "needs_my_review",
  "changes_requested",
  "commented_unanswered",
  "mine_mergeable",
  "mine_blocked",
  "reviewed_by_me",
];

export type PRItem = {
  number: number;
  repo: string;
  title: string;
  url: string;
  author: string;
  bucket: PRBucket;
  isDraft: boolean;
  reviewDecision: string | null;
  checks: "success" | "failing" | "pending" | null;
  updatedAt: string;
};

type SearchPR = {
  number: number;
  title: string;
  repository: { nameWithOwner: string };
  url: string;
  author: { login: string };
  isDraft: boolean;
  updatedAt: string;
};

type ReviewEntry = {
  author: { login: string };
  state: string;
  submittedAt?: string;
};

type CommentEntry = {
  author: { login: string };
  createdAt?: string;
};

type DetailPR = {
  author: { login: string };
  reviewDecision: string | null;
  mergeable: string | null;
  isDraft: boolean;
  statusCheckRollup: Array<{ conclusion: string | null; status?: string }> | null;
  reviews: ReviewEntry[];
  latestReviews: ReviewEntry[];
  comments: CommentEntry[];
};

const SEARCH_JSON = "number,title,repository,url,author,isDraft,createdAt,updatedAt";
const DETAIL_JSON = "reviewDecision,mergeable,isDraft,statusCheckRollup,reviews,latestReviews,comments,author";

function checksFromRollup(
  rollup: Array<{ conclusion: string | null; status?: string }> | null
): "success" | "failing" | "pending" | null {
  if (!rollup || rollup.length === 0) return null;
  if (rollup.some(c => c.conclusion === "FAILURE" || c.conclusion === "ERROR" || c.conclusion === "CANCELLED")) {
    return "failing";
  }
  if (rollup.some(c => !c.conclusion || c.status === "IN_PROGRESS" || c.status === "QUEUED" || c.status === "PENDING")) {
    return "pending";
  }
  return "success";
}

function isBot(login: string): boolean {
  if (!login) return true;
  const lower = login.toLowerCase();
  return lower.endsWith("[bot]") || lower.includes("-bot") || lower === "dependabot";
}

function latestHumanCommentAuthor(detail: DetailPR): string | null {
  // Use PR comments only (not review summaries) — a review approval is not an "unanswered comment"
  const human = (detail.comments || []).filter(c => !isBot(c.author?.login ?? ""));
  if (human.length === 0) return null;
  // Sort by createdAt if available; otherwise treat last in array as latest
  const sorted = human.slice().sort((a, b) => {
    const at = a.createdAt ?? "";
    const bt = b.createdAt ?? "";
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
  return sorted[sorted.length - 1].author.login;
}

function classify(
  pr: SearchPR,
  detail: DetailPR,
  login: string,
  isReviewRequested: boolean
): PRBucket | null {
  const me = login.toLowerCase();
  const authorLogin = (detail.author?.login || pr.author?.login || "").toLowerCase();
  const isMine = authorLogin === me;

  // 1. needs_my_review: review requested from me AND I have not submitted a review
  if (isReviewRequested) {
    const allMyReviews = [
      ...(detail.reviews || []),
      ...(detail.latestReviews || []),
    ].filter(r => (r.author?.login ?? "").toLowerCase() === me);
    if (allMyReviews.length === 0) return "needs_my_review";
  }

  // 2. changes_requested: mine AND CHANGES_REQUESTED
  if (isMine && detail.reviewDecision === "CHANGES_REQUESTED") return "changes_requested";

  // 3. commented_unanswered: involved AND latest human comment is not by me
  const latestHuman = latestHumanCommentAuthor(detail);
  if (latestHuman && latestHuman.toLowerCase() !== me) return "commented_unanswered";

  // 4. mine_mergeable: mine AND not draft AND APPROVED AND all checks SUCCESS AND MERGEABLE
  const cs = checksFromRollup(detail.statusCheckRollup);
  if (
    isMine &&
    !detail.isDraft &&
    !pr.isDraft &&
    detail.reviewDecision === "APPROVED" &&
    cs === "success" &&
    detail.mergeable === "MERGEABLE"
  ) {
    return "mine_mergeable";
  }

  // 5. mine_blocked: mine (not already caught by changes_requested above)
  if (isMine) return "mine_blocked";

  // 6. reviewed_by_me: I submitted a review on someone else's PR
  const allReviews = [
    ...(detail.reviews || []),
    ...(detail.latestReviews || []),
  ];
  const iReviewed = allReviews.some(r => (r.author?.login ?? "").toLowerCase() === me);
  if (!isMine && iReviewed) return "reviewed_by_me";

  return null;
}

export async function fetchAndClassifyPRs(
  login: string,
  ghRunner: GhRunner = defaultGhRunner
): Promise<PRItem[]> {
  async function searchPRs(filter: string): Promise<SearchPR[]> {
    try {
      const raw = await ghRunner([
        "gh", "search", "prs",
        filter,
        "--state=open",
        "--json", SEARCH_JSON,
        "--limit", "100",
      ]);
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  const involvesMe = await searchPRs("--involves=@me");
  const reviewRequested = await searchPRs("--review-requested=@me");

  // Build dedup key → PR map; track which are review-requested
  const reviewRequestedKeys = new Set(
    reviewRequested.map(p => `${p.repository?.nameWithOwner}#${p.number}`)
  );
  const seen = new Map<string, { pr: SearchPR; isReviewRequested: boolean }>();
  for (const pr of [...involvesMe, ...reviewRequested]) {
    const key = `${pr.repository?.nameWithOwner}#${pr.number}`;
    if (!seen.has(key)) {
      seen.set(key, { pr, isReviewRequested: reviewRequestedKeys.has(key) });
    }
  }

  const results: PRItem[] = [];

  for (const { pr, isReviewRequested } of seen.values()) {
    const repo = pr.repository?.nameWithOwner ?? "";
    try {
      const raw = await ghRunner([
        "gh", "pr", "view", String(pr.number),
        "--repo", repo,
        "--json", DETAIL_JSON,
      ]);
      const detail: DetailPR = JSON.parse(raw);
      const bucket = classify(pr, detail, login, isReviewRequested);
      if (!bucket) continue;
      results.push({
        number: pr.number,
        repo,
        title: pr.title,
        url: pr.url,
        author: detail.author?.login || pr.author?.login || "",
        bucket,
        isDraft: detail.isDraft ?? pr.isDraft,
        reviewDecision: detail.reviewDecision ?? null,
        checks: checksFromRollup(detail.statusCheckRollup),
        updatedAt: pr.updatedAt,
      });
    } catch {
      // skip on error
    }
  }

  return results;
}

export function persistPRs(db: Database, items: PRItem[]): void {
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO prs (repo, number, title, url, author, bucket, is_draft, review_decision, checks, updated_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo, number) DO UPDATE SET
       title = excluded.title,
       url = excluded.url,
       author = excluded.author,
       bucket = excluded.bucket,
       is_draft = excluded.is_draft,
       review_decision = excluded.review_decision,
       checks = excluded.checks,
       updated_at = excluded.updated_at,
       fetched_at = excluded.fetched_at`
  );
  for (const item of items) {
    stmt.run(
      item.repo,
      item.number,
      item.title,
      item.url,
      item.author,
      item.bucket,
      item.isDraft ? 1 : 0,
      item.reviewDecision ?? null,
      item.checks ?? null,
      item.updatedAt,
      now
    );
  }
}

export async function runPRFetch(db: Database, ghRunner: GhRunner = defaultGhRunner): Promise<void> {
  // Resolve login — if gh is not auth'd this will throw and we'll skip
  const loginRaw = await ghRunner(["gh", "api", "user", "--jq", ".login"]);
  const login = loginRaw.trim().replace(/^"|"$/g, "");
  if (!login) return;

  const items = await fetchAndClassifyPRs(login, ghRunner);
  persistPRs(db, items);
}
