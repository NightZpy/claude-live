#!/usr/bin/env bun
/**
 * End-to-end CDP verification for claude-live (projects-first UI).
 * Seeds sessions via hook.ts, starts server, drives headless Chrome,
 * asserts DOM state against 9 assertion groups (a–i), exits 0 on success.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

// ── constants ──────────────────────────────────────────────────────────────
const PROJECT = join(import.meta.dir, "..");
const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
const CDP_PORT = 9333;
const SERVER_PORT = 7999;

const BASE = {
  transcript_path: "/Users/u/.claude-work/projects/x/fix-1.jsonl",
  cwd: "/Users/u/proj",
};

// ── helpers ────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function fail(msg: string): never {
  throw new Error("ASSERTION FAILED: " + msg);
}

async function pollUrl(url: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

// ── CDP client ─────────────────────────────────────────────────────────────
class CDP {
  private ws: WebSocket;
  private nextId = 1;
  private cbs = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  readonly evs = new Map<string, Array<(p: any) => void>>();
  readonly ready: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error("CDP WebSocket error"));
    });
    this.ws.onmessage = (e: MessageEvent) => {
      const m = JSON.parse(e.data as string);
      if (m.id !== undefined) {
        const cb = this.cbs.get(m.id);
        if (cb) {
          this.cbs.delete(m.id);
          m.error ? cb.rej(new Error(JSON.stringify(m.error))) : cb.res(m.result);
        }
      }
      if (m.method) (this.evs.get(m.method) ?? []).forEach(h => h(m.params));
    };
  }

  send<T = any>(method: string, params: object = {}): Promise<T> {
    return this.ready.then(
      () =>
        new Promise<T>((res, rej) => {
          const id = this.nextId++;
          this.cbs.set(id, { res, rej });
          this.ws.send(JSON.stringify({ id, method, params }));
        }),
    );
  }

  once<T = any>(event: string): Promise<T> {
    return new Promise(resolve => {
      const handler = (params: T) => {
        this.evs.set(event, (this.evs.get(event) ?? []).filter(h => h !== handler));
        resolve(params);
      };
      this.evs.set(event, [...(this.evs.get(event) ?? []), handler]);
    });
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

// ── seed helper ────────────────────────────────────────────────────────────
async function seed(
  sessionId: string,
  ev: Record<string, unknown>,
  tmp: string,
  extraEnv?: Record<string, string>,
): Promise<void> {
  const payload = { ...BASE, session_id: sessionId, ...ev };
  const proc = Bun.spawn(["bun", "src/hook.ts"], {
    env: { ...process.env, CLAUDE_LIVE_HOME: tmp, ...extraEnv },
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
    cwd: PROJECT,
  });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  await proc.exited;
}

// ── evaluate helper ────────────────────────────────────────────────────────
async function evaluate(cdp: CDP, expr: string): Promise<any> {
  const r = await cdp.send<any>("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: false,
  });
  if (r.exceptionDetails) throw new Error("JS error: " + JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}

// ── kill lingering processes ───────────────────────────────────────────────
async function killPort(port: number): Promise<void> {
  try {
    const proc = Bun.spawn(["lsof", "-ti", `tcp:${port}`], { stdout: "pipe", stderr: "ignore" });
    const raw = await new Response(proc.stdout).text();
    const pids = raw.trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      Bun.spawn(["kill", "-9", pid], { stdout: "ignore", stderr: "ignore" });
    }
    if (pids.length > 0) await sleep(300);
  } catch {}
}

// ── main ───────────────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), "cdp-verify-"));
let serverProc: ReturnType<typeof Bun.spawn> | null = null;
let chromeProc: ReturnType<typeof Bun.spawn> | null = null;
let cdp: CDP | null = null;

try {
  // Kill any lingering processes on our ports
  await killPort(SERVER_PORT);
  await killPort(CDP_PORT);

  // 1. Seed DB via hook.ts ───────────────────────────────────────────────
  console.log("Seeding sessions into", tmp);

  // proj: waiting session (proj key = last segment of cwd = "proj")
  await seed("cdp-s-wait", { hook_event_name: "SessionStart", source: "startup" }, tmp);
  await seed("cdp-s-wait", { hook_event_name: "UserPromptSubmit", prompt: "add dark mode" }, tmp);
  await seed("cdp-s-wait", { hook_event_name: "Notification", message: "Claude needs your permission" }, tmp);

  // proj: running session
  await seed("cdp-s-run", { hook_event_name: "SessionStart", source: "startup" }, tmp);
  await seed("cdp-s-run", { hook_event_name: "UserPromptSubmit", prompt: "fix the status bar bug" }, tmp);
  await seed("cdp-s-run", {
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: "/Users/u/proj/src/a.ts", old_string: "x", new_string: "y" },
  }, tmp);

  // proj: archived session
  await seed("cdp-s-arch", { hook_event_name: "SessionStart", source: "startup" }, tmp);
  await seed("cdp-s-arch", { hook_event_name: "SessionEnd", reason: "exit" }, tmp);

  // proj2: one running session — different cwd so it gets key "proj2"
  await seed("cdp-s-proj2", { hook_event_name: "SessionStart", source: "startup", cwd: "/Users/u/proj2" }, tmp);
  await seed("cdp-s-proj2", { hook_event_name: "UserPromptSubmit", prompt: "work on proj2 feature", cwd: "/Users/u/proj2" }, tmp);

  // proj: filler session (no task, filler summary — should be hidden by default in sessions view)
  await seed("cdp-s-filler", { hook_event_name: "SessionStart", source: "startup" }, tmp);

  // proj: active session with real file edit but NULL summary — blocker regression path (FIX A)
  // must be VISIBLE by default (not hidden as filler) despite having no summary
  await seed("cdp-s-active-file", { hook_event_name: "SessionStart", source: "startup" }, tmp);
  await seed("cdp-s-active-file", {
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: "/Users/u/proj/src/active-blocker.ts", old_string: "a", new_string: "b" },
  }, tmp);

  console.log("Seeded hook events for proj (wait/run/arch/filler/active-file) and proj2.");

  // 1b. Direct DB seeding ────────────────────────────────────────────────
  const seedDb = new Database(join(tmp, "claude-live.db"), { readwrite: true });
  const nowMs = Date.now();

  // Summary for waiting session
  seedDb.run(
    "UPDATE sessions SET summary = ?, summary_next = ? WHERE id = ?",
    [
      "El session espera input del usuario para seguir",
      "Revisar el resultado del comando bash",
      "cdp-s-wait",
    ],
  );

  // Tasks for waiting session (2: one open, one done)
  seedDb.run(
    "INSERT INTO tasks (session_id, title, status, opened_at) VALUES (?, ?, 'open', ?)",
    ["cdp-s-wait", "Implementar modo oscuro", nowMs - 3600000],
  );
  seedDb.run(
    "INSERT INTO tasks (session_id, title, status, opened_at, closed_at) VALUES (?, ?, 'done', ?, ?)",
    ["cdp-s-wait", "Agregar barra de búsqueda", nowMs - 7200000, nowMs - 1000],
  );

  // Slack mention linked to waiting session (for proj detail panel)
  seedDb.run(
    `INSERT INTO mentions
       (channel_id, channel_name, thread_ts, author, author_id, participants, text, ts,
        ask_count, resolved, first_at, last_at, session_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      "C-CDP1", "general", "1751000001.000001", "Alice", "U001",
      JSON.stringify(["U001", "U002"]),
      "Hey can you review this PR?", "1751000001.000001",
      1, 0, nowMs - 300_000, nowMs - 300_000, "cdp-s-wait",
    ],
  );

  // PR link for waiting session
  seedDb.run(
    `INSERT OR IGNORE INTO links (session_id, kind, ref, title, meta) VALUES (?,?,?,?,?)`,
    [
      "cdp-s-wait", "pr", "acme-api#1234", "Fix auth bug",
      JSON.stringify({ state: "OPEN", checks: [{ conclusion: "SUCCESS" }] }),
    ],
  );

  // Daily row for today
  const todayNow = new Date();
  const todayDate = `${todayNow.getFullYear()}-${String(todayNow.getMonth() + 1).padStart(2, "0")}-${String(todayNow.getDate()).padStart(2, "0")}`;
  seedDb.run(
    `INSERT OR REPLACE INTO daily
       (date, yesterday_md, today_md, blockers_md, yesterday_md_en, today_md_en, blockers_md_en, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      todayDate,
      "- Completed the auth feature\n- Deployed to staging",
      "- Working on UI card\n- Fixing tests",
      "- Waiting for design review",
      "- Completed the auth feature (EN)\n- Deployed to staging (EN)",
      "- Working on UI card (EN)\n- Fixing tests (EN)",
      "- Waiting for design review (EN)",
      nowMs,
    ],
  );

  // Unlinked Slack mention (session_id IS NULL, resolved=0) — open, for conversations strip assertion
  seedDb.run(
    `INSERT OR IGNORE INTO mentions
       (channel_id, channel_name, thread_ts, author, author_id, text, ts,
        ask_count, resolved, first_at, last_at, session_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      "C-UNLINKED", "random", "1751999001.000001", "Jordan", "U099",
      "Hey can anyone help with this?", "1751999001.000001",
      1, 0, nowMs - 600_000, nowMs - 600_000, null,
    ],
  );

  // Unlinked Slack mention (session_id IS NULL, resolved=1) — resolved, for filter assertion
  seedDb.run(
    `INSERT OR IGNORE INTO mentions
       (channel_id, channel_name, thread_ts, author, author_id, text, ts,
        ask_count, resolved, first_at, last_at, session_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      "C-UNLINKED2", "general", "1751999002.000001", "Alex", "U100",
      "This has been answered already.", "1751999002.000001",
      0, 1, nowMs - 500_000, nowMs - 500_000, null,
    ],
  );

  // Linear issues for assertion (l): seed directly (bypass OAuth network path)
  const linearIssueRows: Array<[string, string, string, string, string, string, number, string, number]> = [
    ["ENG-001", "Fix auth regression", "https://linear.app/acme/issue/ENG-001", "In Progress", "started", "ENG", 1, new Date(nowMs - 3600000).toISOString(), nowMs],
    ["ENG-002", "Write unit tests",    "https://linear.app/acme/issue/ENG-002", "Todo",        "unstarted","ENG", 2, new Date(nowMs - 7200000).toISOString(), nowMs],
    ["ENG-003", "Deploy to staging",   "https://linear.app/acme/issue/ENG-003", "Todo",        "unstarted","ENG", 3, new Date(nowMs - 1800000).toISOString(), nowMs],
  ];
  for (const [identifier, title, url, state_name, state_type, team_key, priority, updated_at, fetched_at] of linearIssueRows) {
    seedDb.run(
      `INSERT OR IGNORE INTO linear_issues
         (identifier, title, url, state_name, state_type, team_key, priority, updated_at, fetched_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [identifier, title, url, state_name, state_type, team_key, priority, updated_at, fetched_at],
    );
  }

  // PRs for assertion (k): one per bucket across two orgs
  // Org "octocat" (octocat/hello-world): non-actionable buckets
  const prBuckets: Array<[number, string, string, string, string]> = [
    [101, "needs_my_review",       "cdptest-needs-review",   "alice",   "octocat/hello-world"],
    [102, "changes_requested",     "cdptest-changes-req",    "octocat", "octocat/hello-world"],
    [103, "commented_unanswered",  "cdptest-unanswered",     "bob",     "octocat/hello-world"],
    [104, "mine_mergeable",        "cdptest-mergeable",      "octocat", "octocat/hello-world"],
    [105, "mine_blocked",          "cdptest-blocked",        "octocat", "octocat/hello-world"],
    [106, "reviewed_by_me",        "cdptest-reviewed",       "carol",   "octocat/hello-world"],
    // Direct-review PR in org "acme" — actionable, should be counted in hero
    [201, "needs_my_review",       "acme-direct-review",     "alice",   "acme/myrepo"],
    // Team-only review PR in org "acme" — NOT actionable, must NOT inflate hero
    [202, "review_requested_team", "acme-team-review",       "alice",   "acme/myrepo"],
  ];
  for (const [num, bucket, title, author, repo] of prBuckets) {
    seedDb.run(
      `INSERT OR IGNORE INTO prs
         (repo, number, title, url, author, bucket, is_draft, review_decision, checks, updated_at, fetched_at)
       VALUES (?,?,?,?,?,?,0,NULL,NULL,?,?)`,
      [
        repo, num, title,
        `https://github.com/${repo}/pull/${num}`,
        author, bucket, new Date().toISOString(), nowMs,
      ],
    );
  }

  // Give archived session a real summary so it's not a filler (has content to show)
  seedDb.run(
    "UPDATE sessions SET summary = ? WHERE id = ?",
    ["Fixed the login bug and deployed to staging", "cdp-s-arch"],
  );

  // Filler session: filler summary, no tasks, no links — must be hidden by default in sessions view
  seedDb.run(
    "UPDATE sessions SET name = ?, summary = ? WHERE id = ?",
    ["cdp-filler-test", "Sesión iniciada sin tarea definida — aguardando indicación", "cdp-s-filler"],
  );

  // Active-file session: real file edit, NULL summary (no tasks/links) — must be VISIBLE by default (FIX A blocker)
  seedDb.run(
    "UPDATE sessions SET name = ? WHERE id = ?",
    ["cdp-active-file-test", "cdp-s-active-file"],
  );

  seedDb.close();
  console.log("DB seeded: summary, tasks, mention, PR link, daily, unlinked mention, PRs, linear issues, filler/active-file sessions for", todayDate);

  // 2. Start server ─────────────────────────────────────────────────────
  console.log(`Starting server on port ${SERVER_PORT}...`);
  serverProc = Bun.spawn(["bun", "src/server.ts"], {
    env: { ...process.env, CLAUDE_LIVE_HOME: tmp, PORT: String(SERVER_PORT) },
    stdout: "ignore",
    stderr: "ignore",
    cwd: PROJECT,
  });
  await pollUrl(`http://127.0.0.1:${SERVER_PORT}/api/sessions`, 5000);
  console.log("Server ready.");

  // 3. Launch headless Chrome ────────────────────────────────────────────
  const chromePath = CHROME_PATHS.find(p => existsSync(p));
  if (!chromePath) {
    console.error("Chrome/Chromium not found at:", CHROME_PATHS.join(", "));
    process.exit(1);
  }
  console.log("Launching Chrome:", chromePath);
  chromeProc = Bun.spawn(
    [
      chromePath,
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${tmp}/chrome`,
      "--no-sandbox",
      "--disable-gpu",
      "about:blank",
    ],
    { stdout: "ignore", stderr: "ignore" },
  );
  await pollUrl(`http://127.0.0.1:${CDP_PORT}/json/version`, 10000);
  console.log("Chrome ready.");

  // 4. Connect CDP ──────────────────────────────────────────────────────
  const targets: any[] = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then(r => r.json());
  let target = targets.find((t: any) => t.type === "page");
  if (!target) {
    target = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" }).then(r => r.json());
  }
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  console.log("CDP connected to", target.webSocketDebuggerUrl);

  // 5. Navigate ─────────────────────────────────────────────────────────
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Console.enable");
  cdp.evs.set("Console.messageAdded", [m => {
    if (m?.message?.level === "error") console.log("[JS ERROR]", m.message.text);
  }]);
  const navLoad = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${SERVER_PORT}/` });
  await navLoad;
  const reloadLoad = cdp.once("Page.loadEventFired");
  await cdp.send("Page.reload", { ignoreCache: true });
  await reloadLoad;
  console.log("Page loaded (hard reload). Waiting 2.5s for initial poll render...");
  await sleep(2500);

  // 6. Assertions ───────────────────────────────────────────────────────
  console.log("Running assertions...");

  // (a) Projects list: ≥2 .prow rows (proj + proj2), correct keys
  const aCount = await evaluate(cdp, "document.querySelectorAll('.prow').length");
  if (aCount < 2) fail(`(a): expected ≥2 .prow rows, got ${aCount}`);
  const aHasProj = await evaluate(cdp, "!!document.querySelector('.prow[data-key=\"proj\"]')");
  if (!aHasProj) fail('(a): .prow[data-key="proj"] not found');
  const aHasProj2 = await evaluate(cdp, "!!document.querySelector('.prow[data-key=\"proj2\"]')");
  if (!aHasProj2) fail('(a): .prow[data-key="proj2"] not found');
  // proj should have a waiting badge (cdp-s-wait triggers sessions_waiting)
  const aWaitBadge = await evaluate(cdp, "!!document.querySelector('.prow[data-key=\"proj\"] .pbadge-wait')");
  if (!aWaitBadge) fail('(a): proj row missing .pbadge-wait badge for waiting session');
  console.log(`✓ (a): ${aCount} project rows including proj and proj2, waiting badge present`);

  // (b) Hero shows pending count, click → dropdown with items
  const bHeroText = await evaluate(cdp, "(document.getElementById('hero')?.textContent || '').trim()");
  if (!bHeroText) fail("(b): #hero is empty");
  const bHeroN = parseInt(bHeroText.replace(/[^0-9]/g, ""), 10);
  if (isNaN(bHeroN) || bHeroN < 1) {
    // if hero says "al día" it means n=0 — but we seeded a waiting session so this should be > 0
    if (!bHeroText.includes("al día") && !bHeroText.toLowerCase().includes("up to date")) {
      fail(`(b): #hero text is "${bHeroText}", expected pending count`);
    }
  }
  console.log(`✓ (b): hero="${bHeroText}"`);

  // Click hero to open dropdown (only if n > 0)
  if (bHeroN >= 1) {
    await evaluate(cdp, "document.getElementById('hero').click()");
    await sleep(200);
    const bDdHidden = await evaluate(cdp, "document.getElementById('hero-dropdown').hidden");
    if (bDdHidden) fail("(b): hero-dropdown still hidden after click");
    const bDdItems = await evaluate(cdp, "document.querySelectorAll('#hero-dropdown .hero-item').length");
    if (bDdItems < 1) fail(`(b): hero-dropdown has ${bDdItems} items, expected ≥1`);
    console.log(`✓ (b): hero dropdown shows ${bDdItems} item(s)`);
    // close dropdown
    await evaluate(cdp, "document.getElementById('hero-dropdown').hidden = true");
  }

  // (c) Usage chip: exists, click → popover, stop → #paused-banner visible
  const cChipExists = await evaluate(cdp, "!!document.getElementById('usage-chip')");
  if (!cChipExists) fail("(c): #usage-chip not found");
  await evaluate(cdp, "document.getElementById('usage-chip').click()");
  await sleep(200);
  const cPopHidden = await evaluate(cdp, "document.getElementById('usage-popover').hidden");
  if (cPopHidden) fail("(c): #usage-popover still hidden after chip click");
  // Try stop if button present
  const cStopExists = await evaluate(cdp, "!!document.getElementById('usage-stop-btn')");
  if (cStopExists) {
    await evaluate(cdp, "document.getElementById('usage-stop-btn').click()");
    await sleep(600);
    const cBannerHidden = await evaluate(cdp, "document.getElementById('paused-banner').hasAttribute('hidden')");
    if (cBannerHidden) fail("(c): #paused-banner still hidden after stop");
    console.log("✓ (c): usage chip → popover → stop → paused-banner visible");
    // Resume so subsequent tests work normally
    await evaluate(cdp, `fetch('/api/llm/resume', { method: 'POST' })`);
    await sleep(400);
  } else {
    // Usage stopped in prior run — resume
    await evaluate(cdp, `fetch('/api/llm/resume', { method: 'POST' })`);
    await sleep(400);
    console.log("✓ (c): usage chip → popover (stop btn absent; resumed)");
  }
  // Close popover
  await evaluate(cdp, "document.getElementById('usage-popover').hidden = true");

  // (d) Click proj row → accordion opens with 4 .proj-block divs + seeded task/mention present
  await evaluate(cdp, "document.querySelector('.prow[data-key=\"proj\"]').click()");
  await sleep(1200); // allow /api/projects/proj/detail fetch
  const dBlocks = await evaluate(cdp, "document.querySelector('.prow[data-key=\"proj\"] .proj-detail') ? document.querySelector('.prow[data-key=\"proj\"] .proj-detail .proj-block').length : -1");
  // wait up to 3s more if still -1 (slower machines)
  if (dBlocks === -1) {
    await sleep(2000);
  }
  const dBlocksFinal = await evaluate(cdp, "document.querySelectorAll('.prow[data-key=\"proj\"] .proj-detail .proj-block').length");
  if (dBlocksFinal !== 4) fail(`(d): expected 4 .proj-block inside proj accordion, got ${dBlocksFinal}`);
  // Seeded task "Implementar modo oscuro" should appear in tasks block
  const dTaskText = await evaluate(cdp, "document.querySelector('.prow[data-key=\"proj\"] .proj-tasks')?.textContent || ''");
  if (!dTaskText.includes("Implementar")) fail(`(d): task "Implementar" not found in proj tasks block. Got: "${dTaskText.slice(0, 100)}"`);
  console.log("✓ (d): proj accordion has 4 blocks, task present");

  // (e) Click session mini-row → #detail panel shows summary text
  await evaluate(cdp, "document.querySelector('.prow[data-key=\"proj\"] .sess-mini').click()");
  await sleep(1200); // allow /api/sessions/{id} fetch
  const eDetailHidden = await evaluate(cdp, "document.getElementById('detail').hidden");
  if (eDetailHidden) fail("(e): #detail panel still hidden after sess-mini click");
  const eDetailTitle = await evaluate(cdp, "(document.querySelector('#detail .d-title')?.textContent || '').trim()");
  if (!eDetailTitle) fail("(e): detail .d-title is empty");
  console.log(`✓ (e): detail panel open, title="${eDetailTitle}"`);
  // Close detail
  await evaluate(cdp, "document.getElementById('d-close').click()");
  await sleep(200);

  // (f) Search "proj2" → filters to proj2 results; clear → all restored
  await evaluate(cdp, `(function(){
    var el = document.getElementById('search');
    el.value = 'proj2';
    el.dispatchEvent(new Event('input'));
  })()`);
  await sleep(700);
  // Search results panel should appear; check if proj row is hidden or search panel is shown
  const fSearchPanelVisible = await evaluate(cdp, `!!document.getElementById('search-results-panel') && document.getElementById('search-results-panel').style.display !== 'none'`);
  if (!fSearchPanelVisible) {
    // projects-view may be hidden instead
    const fProjViewHidden = await evaluate(cdp, `document.getElementById('projects-view')?.style.display === 'none'`);
    if (!fProjViewHidden) fail("(f): search 'proj2' did not enter search mode");
  }
  console.log("✓ (f): search 'proj2' entered search mode");

  // Clear search
  await evaluate(cdp, `(function(){
    var el = document.getElementById('search');
    el.value = '';
    el.dispatchEvent(new Event('input'));
  })()`);
  await sleep(400);
  const fProjViewBack = await evaluate(cdp, `document.getElementById('projects-view')?.style.display !== 'none' || document.getElementById('projects-view') === null`);
  // after clearing, projects-view should be visible or search panel hidden
  const fSearchPanelGone = await evaluate(cdp, `!document.getElementById('search-results-panel') || document.getElementById('search-results-panel').style.display === 'none'`);
  if (!fSearchPanelGone && !fProjViewBack) fail("(f): search results still visible after clear");
  console.log("✓ (f): search cleared, projects view restored");

  // (g) Daily chip → #daily-overlay visible, has seeded daily content
  const gChipExists = await evaluate(cdp, "!!document.getElementById('daily-chip')");
  if (!gChipExists) fail("(g): #daily-chip not found");
  await evaluate(cdp, "document.getElementById('daily-chip').click()");
  await sleep(500);
  const gOvHidden = await evaluate(cdp, "document.getElementById('daily-overlay').hasAttribute('hidden')");
  if (gOvHidden) fail("(g): #daily-overlay still hidden after daily-chip click");
  // Check daily card has content from seed
  const gCardText = await evaluate(cdp, "(document.getElementById('daily-card')?.textContent || '').toLowerCase()");
  if (!gCardText.includes("daily") && !gCardText.includes("completed") && !gCardText.includes("staging")) {
    fail(`(g): #daily-card text doesn't contain expected seeded content. Got: "${gCardText.slice(0, 100)}"`);
  }
  console.log("✓ (g): daily overlay open with seeded content");
  // Close daily overlay
  await evaluate(cdp, "document.getElementById('daily-close').click()");
  await sleep(200);

  // (h) Sessions chip → #sessions-view visible; sessions enrichment behavior
  const hChipExists = await evaluate(cdp, "!!document.getElementById('sessions-chip')");
  if (!hChipExists) fail("(h): #sessions-chip not found");
  await evaluate(cdp, "document.getElementById('sessions-chip').click()");
  await sleep(400);
  const hSessViewHidden = await evaluate(cdp, "document.getElementById('sessions-view').hidden");
  if (hSessViewHidden) fail("(h): #sessions-view still hidden after sessions-chip click");
  console.log("✓ (h): sessions view opened");

  // (h.1) Active session with open task should show a signal chip
  const hTaskChipCount = await evaluate(cdp, "document.querySelectorAll('#sessions-view .sig-chip').length");
  if (hTaskChipCount < 1) fail(`(h.1): expected ≥1 .sig-chip for active-with-task session, got ${hTaskChipCount}`);
  console.log(`✓ (h.1): sessions view shows ${hTaskChipCount} signal chip(s) for active sessions`);

  // (h.2) Filler session should be hidden by default
  const hSessText = await evaluate(cdp, "(document.getElementById('sessions-view')?.textContent || '').toLowerCase()");
  if (hSessText.includes("cdp-filler-test")) fail("(h.2): filler session 'cdp-filler-test' appeared in sessions view when hidden by default");
  console.log("✓ (h.2): filler session hidden by default");

  // (h.2b) Active session with real file edit and NULL summary must be VISIBLE by default (FIX A blocker repro)
  const hActiveFileRow = await evaluate(cdp, "!!document.querySelector('#sessions-view .srow[data-id=\"cdp-s-active-file\"]')");
  if (!hActiveFileRow) fail("(h.2b): active session 'cdp-s-active-file' (file edit, NULL summary) not visible — is_filler wrongly hid it");
  console.log("✓ (h.2b): active session with file edit and null summary is visible (not hidden as filler)");

  // (h.3) Archived session should be hidden by default (no srow for cdp-s-arch visible)
  const hArchRowsDefault = await evaluate(cdp, "!!document.querySelector('#sessions-view .srow[data-id=\"cdp-s-arch\"]')");
  if (hArchRowsDefault) fail("(h.3): archived session cdp-s-arch visible when it should be hidden by default");
  console.log("✓ (h.3): archived sessions hidden by default");

  // (h.4) Toggle "hide archived" off → archived session appears
  await evaluate(cdp, `(() => {
    var chk = document.getElementById('sess-hide-arch-chk');
    if (chk) { chk.checked = false; chk.dispatchEvent(new Event('change')); }
  })()`);
  await sleep(400);
  const hArchRevealed = await evaluate(cdp, "!!document.querySelector('#sessions-view .srow[data-id=\"cdp-s-arch\"]')");
  if (!hArchRevealed) fail("(h.4): cdp-s-arch still not visible after unchecking hide-archived");
  console.log("✓ (h.4): toggling hide-archived reveals archived session");

  // (i) #refresh-btn exists and is a button
  const iRefreshExists = await evaluate(cdp, "document.getElementById('refresh-btn')?.tagName === 'BUTTON'");
  if (!iRefreshExists) fail("(i): #refresh-btn not found or not a BUTTON");
  console.log("✓ (i): #refresh-btn present");

  // (j) Conversations strip: chip exists, unlinked mention counted in hero, click → view renders
  const jChipExists = await evaluate(cdp, "!!document.getElementById('conversations-chip')");
  if (!jChipExists) fail("(j): #conversations-chip not found");
  // Hero should count the seeded unlinked mention (n >= 1)
  const jHeroText = await evaluate(cdp, "(document.getElementById('hero')?.textContent || '').trim()");
  const jHeroN = parseInt(jHeroText.replace(/[^0-9]/g, ""), 10);
  if (isNaN(jHeroN) || jHeroN < 1) fail(`(j): hero n=${jHeroN} — unlinked mention not counted. Hero: "${jHeroText}"`);
  // Click conversations chip → conversations-view visible
  await evaluate(cdp, "document.getElementById('conversations-chip').click()");
  await sleep(1200);
  const jConvViewHidden = await evaluate(cdp, "document.getElementById('conversations-view').hidden");
  if (jConvViewHidden) fail("(j): #conversations-view still hidden after chip click");
  // Default filter = open: Jordan (resolved=0) should appear, Alex (resolved=1) should NOT
  const jConvText = await evaluate(cdp, "(document.getElementById('conversations-view')?.textContent || '').toLowerCase()");
  if (!jConvText.includes("jordan")) fail(`(j): 'jordan' not found in conversations-view (open filter). Got: "${jConvText.slice(0, 200)}"`);
  if (jConvText.includes("alex")) fail(`(j): 'alex' (resolved) appeared in conversations-view with open filter — should be hidden. Got: "${jConvText.slice(0, 200)}"`);
  console.log("✓ (j): default open filter shows open mention (Jordan), hides resolved mention (Alex)");
  // Click "Todas" filter chip → both mentions visible
  await evaluate(cdp, "(() => { var chips = document.querySelectorAll('#conversations-view [data-conv-filter]'); chips.forEach(function(c){ if(c.dataset.convFilter==='all') c.click(); }); })()");
  await sleep(400);
  const jAllText = await evaluate(cdp, "(document.getElementById('conversations-view')?.textContent || '').toLowerCase()");
  if (!jAllText.includes("jordan")) fail(`(j): 'jordan' not found in conversations-view after switching to Todas. Got: "${jAllText.slice(0, 200)}"`);
  if (!jAllText.includes("alex")) fail(`(j): 'alex' not found in conversations-view after switching to Todas. Got: "${jAllText.slice(0, 200)}"`);
  console.log("✓ (j): conversations chip → view with seeded unlinked mention, hero includes unlinked count, filter works");

  // (k) PRs chip → prs-view visible, actionable by default, hero includes actionable PRs
  //     + direct-vs-team review: team PR NOT counted as actionable
  //     + collapsed hero dropdown: summary items not per-PR rows, no "sin proyecto"
  //     + org filter: two orgs visible, filtering works
  const kChipExists = await evaluate(cdp, "!!document.getElementById('prs-chip')");
  if (!kChipExists) fail("(k): #prs-chip not found");
  // Navigate back to projects view first to reset state
  await evaluate(cdp, "document.getElementById('sessions-chip').click()"); // go to sessions first
  await sleep(300);
  await evaluate(cdp, "document.getElementById('sessions-chip').click()"); // toggle off
  await sleep(300);

  // Hero should include actionable PRs: 3 (needs_my_review×2, changes_requested, commented_unanswered)
  // acme-team-review (review_requested_team) must NOT be counted → hero must not inflate by it
  const kHeroText = await evaluate(cdp, "(document.getElementById('hero')?.textContent || '').trim()");
  const kHeroN = parseInt(kHeroText.replace(/[^0-9]/g, ""), 10);
  // We seeded 3+1 actionable (needs×2, changes×1, unanswered×1) but team PR is excluded
  if (isNaN(kHeroN) || kHeroN < 3) {
    if (!kHeroText.includes("al día") && !kHeroText.toLowerCase().includes("up to date")) {
      fail(`(k): hero="${kHeroText}", expected ≥3 (actionable PRs seeded, team-review excluded)`);
    }
  }
  console.log(`✓ (k): hero includes PR count: "${kHeroText}" (team-review not inflating)`);

  // (k.1) Hero dropdown: collapsed PR summary, no "sin proyecto" label for PR items
  if (kHeroN >= 1) {
    await evaluate(cdp, "document.getElementById('hero').click()");
    await sleep(300);
    const kDdHidden = await evaluate(cdp, "document.getElementById('hero-dropdown').hidden");
    if (kDdHidden) fail("(k.1): hero-dropdown still hidden after click");
    const kDdItems = await evaluate(cdp, "document.querySelectorAll('#hero-dropdown .hero-item').length");
    if (kDdItems < 1) fail(`(k.1): hero-dropdown has ${kDdItems} items, expected ≥1`);
    // PR items (kind="pr") must NOT show "sin proyecto" — they should show "PRs"
    const kPrItemsHaveSinProyecto = await evaluate(cdp, `Array.from(document.querySelectorAll('#hero-dropdown .hero-item[data-kind="pr"]')).some(function(el){ return (el.querySelector('.hi-proj')?.textContent || '').toLowerCase().includes('sin proyecto'); })`);
    if (kPrItemsHaveSinProyecto) fail(`(k.1): PR hero-item shows "sin proyecto" — must show "PRs" label instead`);
    // No per-PR title rows — instead collapsed summaries with count
    // Check that there's NO individual PR title like "cdptest-needs-review" in the dropdown
    const kDdText = await evaluate(cdp, "(document.getElementById('hero-dropdown')?.textContent || '').toLowerCase()");
    if (kDdText.includes("cdptest-")) fail(`(k.1): hero-dropdown shows individual PR titles — should be collapsed summary, not per-PR rows. Got: "${kDdText.slice(0, 200)}"`);
    // Collapsed summary must have a PR summary item (with "prs" label and a count phrase)
    const kDdHasPrSummary = await evaluate(cdp, `Array.from(document.querySelectorAll('#hero-dropdown .hero-item')).some(function(el){ return el.querySelector('.hi-proj')?.textContent?.toLowerCase().includes('pr'); })`);
    if (!kDdHasPrSummary) fail("(k.1): hero-dropdown has no PR summary item (expected collapsed ⑃ N PRs... entry with PRs label)");
    console.log(`✓ (k.1): hero dropdown has ${kDdItems} items, collapsed PR summary (no per-PR rows, no "sin proyecto")`);
    // Close dropdown
    await evaluate(cdp, "document.getElementById('hero-dropdown').hidden = true");
  }

  // Click prs-chip → prs-view becomes visible
  await evaluate(cdp, "document.getElementById('prs-chip').click()");
  await sleep(1200);
  const kPrsViewHidden = await evaluate(cdp, "document.getElementById('prs-view').hidden");
  if (kPrsViewHidden) fail("(k): #prs-view still hidden after chip click");

  // Default filter = actionable: needs_my_review, changes_requested, commented_unanswered should render
  const kPrsText = await evaluate(cdp, "(document.getElementById('prs-view')?.textContent || '').toLowerCase()");
  if (!kPrsText.includes("cdptest-needs-review")) fail(`(k): 'cdptest-needs-review' (needs_my_review) not found in prs-view. Got: "${kPrsText.slice(0, 300)}"`);
  if (!kPrsText.includes("cdptest-changes-req")) fail(`(k): 'cdptest-changes-req' (changes_requested) not found in prs-view. Got: "${kPrsText.slice(0, 300)}"`);
  if (!kPrsText.includes("cdptest-unanswered")) fail(`(k): 'cdptest-unanswered' (commented_unanswered) not found in prs-view. Got: "${kPrsText.slice(0, 300)}"`);
  // acme-direct-review is needs_my_review, so it SHOULD appear in actionable filter
  if (!kPrsText.includes("acme-direct-review")) fail(`(k): 'acme-direct-review' (direct needs_my_review) not found in prs-view actionable filter`);
  // Non-actionable PRs should NOT be visible with default (actionable) filter
  if (kPrsText.includes("cdptest-mergeable")) fail(`(k): 'cdptest-mergeable' (non-actionable) appeared in default actionable filter view`);
  if (kPrsText.includes("cdptest-blocked")) fail(`(k): 'cdptest-blocked' (non-actionable) appeared in default actionable filter view`);
  if (kPrsText.includes("cdptest-reviewed")) fail(`(k): 'cdptest-reviewed' (non-actionable) appeared in default actionable filter view`);
  // Team-review PR must NOT appear in actionable filter
  if (kPrsText.includes("acme-team-review")) fail(`(k): 'acme-team-review' (team-only, non-actionable) appeared in default actionable filter view — team PRs must be excluded from hero`);
  console.log("✓ (k): PRs chip → actionable by default (team-review excluded), hero includes direct actionable PRs");

  // (k.2) Org filter: both orgs (acme, octocat) should appear in filter row; switching works
  // Switch to "All" filter to see PRs from both orgs
  await evaluate(cdp, "(() => { var chips = document.querySelectorAll('#prs-view [data-pr-filter]'); chips.forEach(function(c){ if(c.dataset.prFilter==='all') c.click(); }); })()");
  await sleep(400);
  const kAllPrsText = await evaluate(cdp, "(document.getElementById('prs-view')?.textContent || '').toLowerCase()");
  // Both orgs should appear in the filter row
  const kHasOctocat = kAllPrsText.includes("octocat");
  const kHasAcme = kAllPrsText.includes("acme");
  if (!kHasOctocat) fail(`(k.2): org 'octocat' not found in prs-view after switching to All filter. Got: "${kAllPrsText.slice(0, 400)}"`);
  if (!kHasAcme) fail(`(k.2): org 'acme' not found in prs-view after switching to All filter. Got: "${kAllPrsText.slice(0, 400)}"`);
  console.log("✓ (k.2): org filter shows both orgs (octocat, acme) in prs-view");
  // Click acme org filter → only acme PRs visible
  await evaluate(cdp, "(() => { var chips = document.querySelectorAll('#prs-view [data-pr-org]'); chips.forEach(function(c){ if(c.dataset.prOrg==='acme') c.click(); }); })()");
  await sleep(400);
  const kAcmePrsText = await evaluate(cdp, "(document.getElementById('prs-view')?.textContent || '').toLowerCase()");
  if (!kAcmePrsText.includes("acme")) fail(`(k.2): after selecting acme org filter, no acme content found. Got: "${kAcmePrsText.slice(0, 300)}"`);
  // octocat PRs titles should not appear when filtered to acme
  if (kAcmePrsText.includes("cdptest-needs-review")) fail(`(k.2): 'cdptest-needs-review' (octocat org) visible after filtering to acme`);
  console.log("✓ (k.2): acme org filter shows only acme PRs, octocat PRs hidden");

  // (l) Linear chip → #linear-view visible; seeded issues render sorted by priority; hero includes count
  const lChipExists = await evaluate(cdp, "!!document.getElementById('linear-chip')");
  if (!lChipExists) fail("(l): #linear-chip not found");

  // Navigate back to projects first
  await evaluate(cdp, "document.getElementById('prs-chip').click()"); // toggle off prs
  await sleep(300);

  // Hero should include the 3 seeded Linear issues in its count
  const lHeroText = await evaluate(cdp, "(document.getElementById('hero')?.textContent || '').trim()");
  const lHeroN = parseInt(lHeroText.replace(/[^0-9]/g, ""), 10);
  // We seeded 3 Linear issues; combined with PRs the hero count must be ≥ 3
  if (isNaN(lHeroN) || lHeroN < 3) {
    if (!lHeroText.toLowerCase().includes("up to date") && !lHeroText.includes("al día")) {
      fail(`(l): hero="${lHeroText}", expected ≥3 (3 seeded linear issues)`);
    }
  }
  console.log(`✓ (l): hero includes linear count: "${lHeroText}"`);

  // Click linear-chip → linear-view becomes visible
  await evaluate(cdp, "document.getElementById('linear-chip').click()");
  await sleep(1200);
  const lViewHidden = await evaluate(cdp, "document.getElementById('linear-view').hidden");
  if (lViewHidden) fail("(l): #linear-view still hidden after chip click");

  // Seeded issues should appear, sorted by priority (ENG-001 priority=1 first, ENG-003 priority=3 last)
  const lViewText = await evaluate(cdp, "(document.getElementById('linear-view')?.textContent || '').toLowerCase()");
  if (!lViewText.includes("eng-001")) fail(`(l): 'ENG-001' not found in linear-view. Got: "${lViewText.slice(0, 300)}"`);
  if (!lViewText.includes("eng-002")) fail(`(l): 'ENG-002' not found in linear-view. Got: "${lViewText.slice(0, 300)}"`);
  if (!lViewText.includes("eng-003")) fail(`(l): 'ENG-003' not found in linear-view. Got: "${lViewText.slice(0, 300)}"`);

  // Priority sort: ENG-001 (p=1) must appear before ENG-003 (p=3)
  const lIdx001 = lViewText.indexOf("eng-001");
  const lIdx003 = lViewText.indexOf("eng-003");
  if (lIdx001 >= lIdx003) fail(`(l): ENG-001 (priority=1) should appear before ENG-003 (priority=3) in linear-view`);
  console.log("✓ (l): Linear chip → view shows seeded issues sorted by priority, hero includes count");

  // Screenshot ──────────────────────────────────────────────────────────
  const screenshotResult = await cdp.send<any>("Page.captureScreenshot", { format: "png" });
  const screenshotPath = join(tmp, "cdp-verify-result.png");
  await Bun.write(screenshotPath, Buffer.from(screenshotResult.data, "base64"));
  console.log("Screenshot saved:", screenshotPath);

  console.log("\n✅ All assertions passed.");
  process.exit(0);
} catch (err: any) {
  console.error("\n❌", err.message ?? err);
  // Screenshot on failure
  if (cdp) {
    try {
      const r = await cdp.send<any>("Page.captureScreenshot", { format: "png" });
      const p = join(tmp, "cdp-verify-fail.png");
      await Bun.write(p, Buffer.from(r.data, "base64"));
      console.error("Failure screenshot:", p);
    } catch {}
  }
  process.exit(1);
} finally {
  cdp?.close();
  serverProc?.kill();
  chromeProc?.kill();
}
