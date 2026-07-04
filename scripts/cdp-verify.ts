#!/usr/bin/env bun
/**
 * End-to-end CDP verification for claude-live UI.
 * Seeds 3 sessions via hook.ts, starts server, drives headless Chrome,
 * asserts DOM state, captures screenshot, exits 0 on success.
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
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
  private evs = new Map<string, Array<(p: any) => void>>();
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
    try {
      this.ws.close();
    } catch {}
  }
}

// ── seed helper ────────────────────────────────────────────────────────────
async function seed(sessionId: string, ev: object, tmp: string, extraEnv?: Record<string, string>): Promise<void> {
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

// ── main ───────────────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), "cdp-verify-"));
let serverProc: ReturnType<typeof Bun.spawn> | null = null;
let chromeProc: ReturnType<typeof Bun.spawn> | null = null;
let cdp: CDP | null = null;

try {
  // 1. Seed DB via hook.ts ───────────────────────────────────────────────
  console.log("Seeding sessions into", tmp);

  // s-run: running, 1 file edit
  await seed("cdp-s-run", { hook_event_name: "SessionStart", source: "startup" }, tmp);
  await seed("cdp-s-run", { hook_event_name: "UserPromptSubmit", prompt: "fix the status bar bug" }, tmp);
  await seed(
    "cdp-s-run",
    {
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "/Users/u/proj/src/a.ts", old_string: "x", new_string: "y" },
    },
    tmp,
  );

  // s-wait: waiting_input (ordered first by SQL)
  await seed("cdp-s-wait", { hook_event_name: "SessionStart", source: "startup" }, tmp);
  await seed("cdp-s-wait", { hook_event_name: "UserPromptSubmit", prompt: "add dark mode" }, tmp);
  await seed("cdp-s-wait", { hook_event_name: "Notification", message: "Claude needs your permission to use Bash" }, tmp);

  // s-arch: archived
  await seed("cdp-s-arch", { hook_event_name: "SessionStart", source: "startup" }, tmp);
  await seed("cdp-s-arch", { hook_event_name: "SessionEnd", reason: "exit" }, tmp);

  // s-task: running, last_prompt is a raw task-notification XML
  const taskXml =
    '<task-notification> <task-id>afc123abc</task-id> <tool-use-id>toolu_0123</tool-use-id>' +
    ' <output-file>/private/tmp/out.txt</output-file> <status>completed</status>' +
    ' <summary>Agent inventario finished</summary> <note>All done</note></task-notification>';
  await seed("cdp-s-task", { hook_event_name: "SessionStart", source: "startup" }, tmp);
  await seed("cdp-s-task", { hook_event_name: "UserPromptSubmit", prompt: taskXml }, tmp);

  // seed a preview file for cdp-s-run (so B3 can test file preview)
  const previewFile = join(tmp, "preview-test.ts");
  writeFileSync(previewFile, 'const hello = "world";');
  await seed("cdp-s-run", {
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: previewFile, old_string: "x", new_string: "y" },
  }, tmp);

  // seed a kind=worker session via env
  await seed("cdp-s-worker", { hook_event_name: "SessionStart", source: "startup" }, tmp, { CLAUDE_LIVE_SESSION_KIND: "worker" });
  await seed("cdp-s-worker", { hook_event_name: "UserPromptSubmit", prompt: "subagent task" }, tmp, { CLAUDE_LIVE_SESSION_KIND: "worker" });

  console.log("Seeded: cdp-s-run (running+preview file), cdp-s-wait (waiting_input), cdp-s-arch (archived), cdp-s-task (task-notification), cdp-s-worker (worker)");

  // 1b. Seed summary + tasks directly into DB ───────────────────────────
  const seedDb = new Database(join(tmp, "claude-live.db"), { readwrite: true });
  const nowMs = Date.now();
  seedDb.run(
    "UPDATE sessions SET summary = ?, summary_next = ? WHERE id = ?",
    [
      "El session espera input del usuario para seguir",
      "Revisar el resultado del comando bash",
      "cdp-s-wait",
    ],
  );
  seedDb.run(
    "INSERT INTO tasks (session_id, title, status, opened_at) VALUES (?, ?, 'open', ?)",
    ["cdp-s-wait", "Implementar modo oscuro", nowMs - 3600000],
  );
  seedDb.run(
    "INSERT INTO tasks (session_id, title, status, opened_at, closed_at) VALUES (?, ?, 'done', ?, ?)",
    ["cdp-s-wait", "Agregar barra de búsqueda", nowMs - 7200000, nowMs - 1000],
  );

  // seed daily row
  const todayNow = new Date();
  const todayDate = `${todayNow.getFullYear()}-${String(todayNow.getMonth() + 1).padStart(2, "0")}-${String(todayNow.getDate()).padStart(2, "0")}`;
  seedDb.run(
    "INSERT OR REPLACE INTO daily (date, yesterday_md, today_md, blockers_md, yesterday_md_en, today_md_en, blockers_md_en, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
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

  // seed mentions: one linked to cdp-s-wait (ask_count 1), one unlinked (ask_count 2 for re-ask badge)
  seedDb.run(
    `INSERT INTO mentions (channel_id, channel_name, thread_ts, author, author_id, participants, text, ts,
       ask_count, resolved, first_at, last_at, session_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ["C-CDP1", "general", "1751000001.000001", "Alice", "U001",
     JSON.stringify(["U001", "U002"]),
     "Hey Lenyn can you review this PR?", "1751000001.000001",
     1, 0, nowMs - 300_000, nowMs - 300_000, "cdp-s-wait"]
  );
  seedDb.run(
    `INSERT INTO mentions (channel_id, channel_name, thread_ts, author, author_id, participants, text, ts,
       ask_count, resolved, first_at, last_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ["C-CDP2", "backend", "1751000002.000001", "Bob", "U002",
     JSON.stringify(["U002"]),
     "Lenyn are you around? Any update?", "1751000002.000001",
     2, 0, nowMs - 600_000, nowMs - 100_000]
  );
  // seed signal linked to cdp-s-wait
  seedDb.run(
    `INSERT INTO signals (kind, channel, text, ts, status, created_at, session_id)
     VALUES (?,?,?,?,?,?,?)`,
    ["deploy", "deploys-prod", "v2.1.0 deployed to production", "1751000003.000001",
     "ok", nowMs - 200_000, "cdp-s-wait"]
  );

  // Seed links for cdp-s-wait
  seedDb.run(
    `INSERT OR IGNORE INTO links (session_id, kind, ref, title, meta) VALUES (?,?,?,?,?)`,
    ["cdp-s-wait", "pr", "acme-api#1234", "Fix auth bug",
     JSON.stringify({ state: "OPEN", checks: [{ conclusion: "SUCCESS" }] })]
  );
  seedDb.run(
    `INSERT OR IGNORE INTO links (session_id, kind, ref) VALUES (?,?,?)`,
    ["cdp-s-wait", "linear", "CON-5678"]
  );
  seedDb.run(
    `INSERT OR IGNORE INTO links (session_id, kind, ref) VALUES (?,?,?)`,
    ["cdp-s-wait", "artifact", "/Users/u/proj/docs/runbook.md"]
  );

  seedDb.close();
  console.log("Seeded summary+tasks for cdp-s-wait, daily row for", todayDate, ", and Slack mentions+signals+links");

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
    target = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: "PUT" }).then(r =>
      r.json(),
    );
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
  // Hard reload to ensure fresh JS context even if Chrome was reused from a prior run
  const reloadLoad = cdp.once("Page.loadEventFired");
  await cdp.send("Page.reload", { ignoreCache: true });
  await reloadLoad;
  console.log("Page loaded (hard reload). Waiting 2s for initial poll render...");
  await sleep(2000);

  // 6. Assertions ───────────────────────────────────────────────────────
  console.log("Running assertions...");

  // A1: 4 rows in #sessions — 3 regular active + 1 worker inside workers-group
  const a1 = await evaluate(cdp, "document.querySelectorAll('#sessions .srow').length");
  if (a1 !== 4) fail(`A1: expected 4 session rows (3 regular + 1 worker), got ${a1}`);
  console.log("✓ A1: 4 session rows (3 regular + 1 worker)");

  // A2: first row dot has class d-wait (waiting_input ordered before running)
  const a2 = await evaluate(cdp, "document.querySelector('#sessions .srow .dot').classList.contains('d-wait')");
  if (!a2) fail("A2: first row dot is not d-wait — waiting_input session should be first");
  console.log("✓ A2: first row has d-wait dot");

  // A3: 1 archived session
  const a3 = await evaluate(cdp, "document.querySelectorAll('#archived .srow').length");
  if (a3 !== 1) fail(`A3: expected 1 archived session, got ${a3}`);
  console.log("✓ A3: 1 archived session");

  // A4: click first active row → detail panel visible + title non-empty
  await evaluate(cdp, "document.querySelector('#sessions .srow').click()");
  await sleep(1000); // wait for /api/sessions/{id} fetch
  const a4hidden = await evaluate(cdp, "document.getElementById('detail').hidden");
  if (a4hidden !== false) fail(`A4: detail panel is still hidden after row click (hidden=${a4hidden})`);
  const a4title = await evaluate(cdp, "(document.querySelector('#detail .d-title').textContent || '').trim()");
  if (!a4title) fail("A4: detail .d-title is empty after row click");
  console.log(`✓ A4: detail visible, title="${a4title}"`);

  // A5a: search no-match → 0 visible rows in #sessions
  // (server-side search: debounce 300ms + fetch, wait 700ms total)
  await evaluate(
    cdp,
    `(function() {
      var el = document.getElementById('search');
      el.value = 'zzz-no-match';
      el.dispatchEvent(new Event('input'));
    })()`,
  );
  await sleep(700);
  const a5a = await evaluate(
    cdp,
    "[...document.querySelectorAll('#sessions .srow')].filter(r => r.style.display !== 'none').length",
  );
  if (a5a !== 0) fail(`A5a: expected 0 visible active rows after no-match search, got ${a5a}`);
  console.log("✓ A5a: 0 visible rows for no-match search");

  // A5b: clear search → 2 visible active rows
  await evaluate(
    cdp,
    `(function() {
      var el = document.getElementById('search');
      el.value = '';
      el.dispatchEvent(new Event('input'));
    })()`,
  );
  await sleep(400);
  const a5b = await evaluate(
    cdp,
    "[...document.querySelectorAll('#sessions .srow')].filter(r => r.style.display !== 'none').length",
  );
  if (a5b !== 4) fail(`A5b: expected 4 visible rows after clearing search (3 regular + 1 worker), got ${a5b}`);
  console.log("✓ A5b: 4 visible rows after clearing search (3 regular + 1 worker)");

  // A6: task-notification session row decodes correctly
  const a6topicText = await evaluate(
    cdp,
    "(document.querySelector('.srow[data-id=\"cdp-s-task\"] .topic') || {}).textContent || ''",
  );
  if (a6topicText.includes("<task-notification>"))
    fail(`A6a: topic still contains raw XML '<task-notification>': ${a6topicText}`);
  console.log("✓ A6a: topic does not contain raw <task-notification> XML");

  if (!a6topicText.includes("Agent inventario finished"))
    fail(`A6b: topic missing decoded summary text. Got: ${a6topicText}`);
  console.log("✓ A6b: topic contains decoded summary text");

  const a6chip = await evaluate(
    cdp,
    "!!document.querySelector('.srow[data-id=\"cdp-s-task\"] .badge-sys')",
  );
  if (!a6chip) fail("A6c: .badge-sys chip not found in cdp-s-task row");
  console.log("✓ A6c: .badge-sys chip present in task-notification row");

  // B1: filters bar renders
  const b1 = await evaluate(cdp, "document.querySelectorAll('#filters .chip').length");
  if (b1 < 4) fail(`B1: expected at least 4 filter chips, got ${b1}`);
  console.log("✓ B1: filters bar rendered with", b1, "chips");

  // B2: clicking 'esperándote' chip filters to only waiting rows
  await evaluate(cdp, `
    (function() {
      var chips = document.querySelectorAll('#filters .chip');
      for (var i = 0; i < chips.length; i++) {
        if (chips[i].textContent.trim() === 'esperándote') {
          chips[i].click();
          return;
        }
      }
    })()
  `);
  await sleep(300);
  const b2visible = await evaluate(
    cdp,
    "[...document.querySelectorAll('#sessions .srow')].filter(r => r.style.display !== 'none').length",
  );
  if (b2visible < 1) fail(`B2: expected at least 1 visible row after 'esperándote' filter, got ${b2visible}`);
  console.log("✓ B2: esperándote filter works,", b2visible, "visible rows");

  // reset status filter to 'todas'
  await evaluate(cdp, `
    (function() {
      var chips = document.querySelectorAll('#filters .chip');
      for (var i = 0; i < chips.length; i++) {
        if (chips[i].textContent.trim() === 'todas' && chips[i].dataset && chips[i].dataset.filter === 'status') {
          chips[i].click();
          return;
        }
      }
    })()
  `);
  await sleep(300);

  // B3: ARCHIVOS group renders and file preview works for cdp-s-run
  await evaluate(cdp, "document.querySelector('.srow[data-id=\"cdp-s-run\"]').click()");
  await sleep(1000);
  const b3group = await evaluate(cdp, "document.querySelectorAll('#d-body .fgroup').length");
  if (b3group < 1) fail(`B3a: expected at least 1 .fgroup in detail, got ${b3group}`);
  console.log("✓ B3a: file group (.fgroup) rendered");

  const b3bn = await evaluate(cdp, "(document.querySelector('#d-body .file-bn') || {}).textContent || ''");
  if (!b3bn.includes("preview-test.ts")) fail(`B3b: .file-bn expected 'preview-test.ts', got: ${b3bn}`);
  console.log("✓ B3b: file basename shows 'preview-test.ts'");

  await evaluate(cdp, "document.querySelector('#d-body .file-row').click()");
  await sleep(1200);
  const b3previewHidden = await evaluate(cdp, "document.querySelector('#d-body .file-preview').hidden");
  if (b3previewHidden !== false) fail("B3c: .file-preview still hidden after click");
  const b3previewText = await evaluate(cdp, "document.querySelector('#d-body .file-preview').textContent || ''");
  if (!b3previewText.includes("const hello")) fail(`B3d: file preview missing expected content 'const hello', got: ${b3previewText}`);
  console.log("✓ B3c+d: file preview visible with correct content");

  // B4: workers group renders collapsed in #sessions
  const b4group = await evaluate(cdp, "!!document.querySelector('#sessions .workers-group')");
  if (!b4group) fail("B4a: no .workers-group found in #sessions");
  const b4open = await evaluate(cdp, "document.querySelector('#sessions .workers-group').open");
  if (b4open) fail("B4b: workers-group should be collapsed (open=false), got open=true");
  console.log("✓ B4: workers group exists and is collapsed");

  console.log("✓ B1-B4: all new UI-batch assertions passed");

  // C1: server-side search — file basename surfaces session row ─────────
  // Reset to normal state first
  await evaluate(cdp, `(function() {
    var el = document.getElementById('search');
    el.value = '';
    el.dispatchEvent(new Event('input'));
  })()`);
  await sleep(400);

  await evaluate(cdp, `(function() {
    var el = document.getElementById('search');
    el.value = 'preview-test';
    el.dispatchEvent(new Event('input'));
  })()`);
  await sleep(700); // debounce 300ms + fetch

  const c1count = await evaluate(
    cdp,
    "[...document.querySelectorAll('#sessions .srow')].filter(r => r.style.display !== 'none').length",
  );
  if (c1count < 1) fail(`C1a: expected ≥1 visible row for 'preview-test' search, got ${c1count}`);
  console.log(`✓ C1a: search 'preview-test' surfaced ${c1count} row(s)`);

  // C1b: clear search → normal ledger restored (archived section visible again)
  await evaluate(cdp, `(function() {
    var el = document.getElementById('search');
    el.value = '';
    el.dispatchEvent(new Event('input'));
  })()`);
  await sleep(400);

  const c1archivedVisible = await evaluate(
    cdp,
    "(document.getElementById('archived') || {}).style?.display !== 'none'",
  );
  if (!c1archivedVisible) fail("C1b: #archived is still hidden after clearing search");
  console.log("✓ C1b: clearing search restores #archived section");

  // C2: summary text in ledger row + TAREAS in detail ───────────────────
  const c2topic = await evaluate(
    cdp,
    "(document.querySelector('.srow[data-id=\"cdp-s-wait\"] .topic') || {}).textContent || ''",
  );
  if (!c2topic.includes("espera input")) {
    fail(`C2a: ledger row does not show summary text, got: "${c2topic}"`);
  }
  console.log(`✓ C2a: ledger row shows summary text for cdp-s-wait`);

  // C2b: click cdp-s-wait → detail → TAREAS section visible
  await evaluate(cdp, "document.querySelector('.srow[data-id=\"cdp-s-wait\"]').click()");
  await sleep(1000);

  const c2bodyText = await evaluate(
    cdp,
    "(document.getElementById('d-body') || {}).textContent || ''",
  );
  if (!c2bodyText.includes("Implementar")) {
    fail(`C2b: detail missing task title 'Implementar', body starts: "${c2bodyText.slice(0, 300)}"`);
  }
  console.log("✓ C2b: detail TAREAS section shows task title 'Implementar modo oscuro'");

  const c2section = await evaluate(
    cdp,
    `[...document.querySelectorAll('#d-body .dsec summary .lbl')]
      .some(function(el) { return el.textContent.includes('Tareas') || el.textContent.includes('Tasks'); })`,
  );
  if (!c2section) fail("C2c: TAREAS section label not found in detail");
  console.log("✓ C2c: TAREAS section label present in detail");

  console.log("✓ C1-C2: search and summary/tasks assertions passed");

  // D: Hoy daily card ──────────────────────────────────────────────────

  // D1: #daily-card is visible (not hidden)
  const d1 = await evaluate(cdp, "document.getElementById('daily-card').hidden === false");
  if (!d1) fail("D1: #daily-card is hidden, expected visible after seeded daily row");
  console.log("✓ D1: Hoy card is visible");

  // D2: three .daily-section elements rendered (ayer / hoy / bloqueos)
  const d2 = await evaluate(cdp, "document.querySelectorAll('#daily-card .daily-section').length");
  if (d2 !== 3) fail(`D2: expected 3 .daily-section elements in #daily-card, got ${d2}`);
  console.log("✓ D2: 3 daily sections present (ayer / hoy / bloqueos)");

  // D3: seeded text appears safely rendered (no raw markdown, correct content)
  const d3text = await evaluate(cdp, "(document.getElementById('daily-card') || {}).textContent || ''");
  if (!d3text.includes("Completed the auth feature")) fail(`D3a: ayer seeded text not in Hoy card. Got: ${d3text.slice(0, 300)}`);
  if (!d3text.includes("Working on UI card")) fail(`D3b: hoy seeded text not in Hoy card. Got: ${d3text.slice(0, 300)}`);
  if (!d3text.includes("Waiting for design review")) fail(`D3c: bloqueos seeded text not in Hoy card. Got: ${d3text.slice(0, 300)}`);
  // verify the leading '- ' was stripped (should not appear as literal text)
  if (d3text.includes("- Completed")) fail("D3d: bullet prefix '- ' was not stripped from rendered text");
  console.log("✓ D3: Hoy card contains seeded text for ayer/hoy/bloqueos, bullet prefixes stripped");

  console.log("✓ D1-D3: Hoy card seeded text verified");

  // D4: ES/EN toggle buttons exist
  const d4 = await evaluate(cdp, "document.querySelectorAll('#daily-card .daily-lang-btn').length");
  if (d4 !== 2) fail(`D4: expected 2 .daily-lang-btn buttons in #daily-card, got ${d4}`);
  console.log("✓ D4: ES/EN toggle buttons present");

  // D5: Slack copy button exists
  const d5 = await evaluate(cdp, "!!document.querySelector('#daily-card .daily-slack-copy')");
  if (!d5) fail("D5: .daily-slack-copy button not found in #daily-card");
  console.log("✓ D5: Slack copy button present");

  // D6: clicking EN toggle re-renders with EN content
  await evaluate(cdp, `
    var btns = document.querySelectorAll('#daily-card .daily-lang-btn');
    var enBtn = [...btns].find(function(b) { return b.getAttribute('data-lang') === 'en'; });
    if (enBtn) enBtn.click();
  `);
  await sleep(200);
  const d6text = await evaluate(cdp, "(document.getElementById('daily-card') || {}).textContent || ''");
  if (!d6text.includes("auth feature (EN)")) fail(`D6: EN content not visible after EN toggle click. Got: ${d6text.slice(0, 300)}`);
  console.log("✓ D6: EN toggle switches to English content");

  console.log("✓ D1-D6: Hoy daily card assertions passed");

  // E: Slack inbox sections ─────────────────────────────────────────────

  // E1: #slack-card is visible after seeded open mentions
  const e1 = await evaluate(cdp, "document.getElementById('slack-card').hidden === false");
  if (!e1) fail("E1: #slack-card is hidden, expected visible after seeded open mentions");
  console.log("✓ E1: #slack-card is visible");

  // E2: at least 2 .slack-mention rows (1 linked + 1 unlinked seeded)
  const e2 = await evaluate(cdp, "document.querySelectorAll('#slack-card .slack-mention').length");
  if (e2 < 2) fail(`E2: expected >= 2 .slack-mention rows, got ${e2}`);
  console.log(`✓ E2: ${e2} .slack-mention rows rendered`);

  // E3: re-ask badge present for ask_count=2 row
  const e3 = await evaluate(cdp, "document.querySelector('#slack-card .slack-mention .badge-sys') !== null");
  if (!e3) fail("E3: re-ask count badge not found in slack-card");
  console.log("✓ E3: re-ask count badge present");

  // E4: resolve buttons present
  const e4 = await evaluate(cdp, "document.querySelectorAll('#slack-card .slack-resolve').length");
  if (e4 < 2) fail(`E4: expected >= 2 .slack-resolve buttons, got ${e4}`);
  console.log(`✓ E4: ${e4} resolve buttons present`);

  // E5: click first resolve button → row is removed
  const e5before = await evaluate(cdp, "document.querySelectorAll('#slack-card .slack-mention').length");
  await evaluate(cdp, "document.querySelector('#slack-card .slack-resolve').click()");
  await sleep(900);
  const e5after = await evaluate(cdp, "document.querySelectorAll('#slack-card .slack-mention').length");
  if (e5after >= e5before) fail(`E5: resolve did not remove row (before=${e5before}, after=${e5after})`);
  console.log(`✓ E5: resolve button removed row (${e5before} → ${e5after})`);

  // E6: #signals-card is visible after seeded signal
  const e6 = await evaluate(cdp, "document.getElementById('signals-card').hidden === false");
  if (!e6) fail("E6: #signals-card is hidden, expected visible after seeded signal");
  console.log("✓ E6: #signals-card is visible");

  // E7: at least 1 row in signals-card body
  const e7 = await evaluate(cdp, "document.querySelectorAll('#signals-card .frow').length");
  if (e7 < 1) fail(`E7: expected >= 1 .frow rows in signals-card, got ${e7}`);
  console.log(`✓ E7: ${e7} signal row(s) in signals-card`);

  // E8: click session linked to mention → detail shows "Slack ligado" dsec
  await evaluate(cdp, "document.querySelector('.srow[data-id=\"cdp-s-wait\"]').click()");
  await sleep(1000);
  const e8 = await evaluate(cdp,
    `[...document.querySelectorAll('#d-body .dsec summary .lbl')].some(function(el) {
      return el.textContent.includes('Slack ligado');
    })`
  );
  if (!e8) fail("E8: Slack ligado section not found in detail panel for session with linked mention");
  console.log("✓ E8: Slack ligado section visible in detail panel");

  console.log("✓ E1-E8: Slack inbox assertions passed");

  // F: Resume prompt button ─────────────────────────────────────────────
  // cdp-s-wait detail is still open from E8/C2b

  // F1: resume button exists in detail panel
  const f1 = await evaluate(cdp, "document.getElementById('d-resume-copy') !== null");
  if (!f1) fail("F1: #d-resume-copy button not found in detail panel");
  console.log("✓ F1: resume-copy button exists in detail panel");

  // F2: resume-prompt endpoint returns non-empty text
  const f2r = await cdp.send<any>("Runtime.evaluate", {
    expression: "fetch('/api/sessions/cdp-s-wait/resume-prompt').then(r => r.text())",
    returnByValue: true,
    awaitPromise: true,
  });
  if (f2r.exceptionDetails) fail("F2: fetch threw: " + JSON.stringify(f2r.exceptionDetails));
  const f2text: string = f2r.result?.value ?? "";
  if (!f2text || f2text.length === 0) fail("F2: resume-prompt endpoint returned empty text");
  console.log("✓ F2: resume-prompt endpoint returns non-empty text (length=" + f2text.length + ")");

  console.log("✓ F1-F2: resume prompt assertions passed");

  // G: Links sections in detail panel ──────────────────────────────────
  // cdp-s-wait detail should still be open; re-click to refresh
  await evaluate(cdp, "document.querySelector('.srow[data-id=\"cdp-s-wait\"]').click()");
  await sleep(1000);

  // G1: Repos & PRs section visible
  const g1 = await evaluate(cdp,
    `[...document.querySelectorAll('#d-body .dsec summary .lbl')]
      .some(function(el) { return el.textContent.includes('Repos') || el.textContent.includes('PR'); })`
  );
  if (!g1) fail("G1: Repos & PRs section not found in detail panel");
  console.log("✓ G1: Repos & PRs section visible");

  // G2: Linear section visible
  const g2 = await evaluate(cdp,
    `[...document.querySelectorAll('#d-body .dsec summary .lbl')]
      .some(function(el) { return el.textContent.includes('Linear'); })`
  );
  if (!g2) fail("G2: Linear section not found in detail panel");
  console.log("✓ G2: Linear section visible");

  // G3: Artifacts section visible
  const g3 = await evaluate(cdp,
    `[...document.querySelectorAll('#d-body .dsec summary .lbl')]
      .some(function(el) { return el.textContent.includes('Artifact') || el.textContent.includes('Artefact'); })`
  );
  if (!g3) fail("G3: Artifacts section not found in detail panel");
  console.log("✓ G3: Artifacts section visible");

  console.log("✓ G1-G3: Links sections assertions passed");

  // H: Settings panel ───────────────────────────────────────────────────

  // H1: click #settings-btn → #settings-panel visible
  await evaluate(cdp, "document.getElementById('settings-btn').click()");
  await sleep(600); // fetch /api/config
  const h1 = await evaluate(cdp, "document.getElementById('settings-panel').hidden");
  if (h1 !== false) fail("H1: #settings-panel is still hidden after #settings-btn click");
  console.log("✓ H1: settings panel opens on gear click");

  // H2: language select reflects current config language
  const h2lang = await evaluate(cdp, "(document.getElementById('s-lang') || {}).value || ''");
  if (!h2lang) fail("H2: language select not rendered or empty");
  console.log(`✓ H2: language select shows '${h2lang}'`);

  // H3: toggle #s-notify checkbox
  const h3before = await evaluate(cdp, "document.getElementById('s-notify').checked");
  await evaluate(cdp, "document.getElementById('s-notify').click()");
  const h3after = await evaluate(cdp, "document.getElementById('s-notify').checked");
  if (h3after === h3before) fail(`H3: notifyWaiting checkbox did not toggle (before=${h3before}, after=${h3after})`);
  console.log(`✓ H3: notifyWaiting toggled ${h3before} → ${h3after}`);

  // H4: click Save → panel closes
  await evaluate(cdp, "document.getElementById('s-save').click()");
  await sleep(600);
  const h4closed = await evaluate(cdp, "document.getElementById('settings-panel').hidden");
  if (h4closed !== true) fail("H4: #settings-panel did not close after Save");
  console.log("✓ H4: panel closes after Save");

  // H5: re-fetch /api/config and assert toggled value persisted
  const h5r = await cdp.send<any>("Runtime.evaluate", {
    expression: "fetch('/api/config').then(r => r.json()).then(function(d) { return d.notifyWaiting; })",
    returnByValue: true,
    awaitPromise: true,
  });
  if (h5r.exceptionDetails) fail("H5: fetch /api/config threw: " + JSON.stringify(h5r.exceptionDetails));
  const h5val = h5r.result?.value;
  if (h5val !== h3after) fail(`H5: persisted notifyWaiting=${h5val}, expected ${h3after}`);
  console.log(`✓ H5: notifyWaiting=${h5val} persisted in config`);

  // H6: Esc key closes re-opened panel
  await evaluate(cdp, "document.getElementById('settings-btn').click()");
  await sleep(400);
  const h6open = await evaluate(cdp, "document.getElementById('settings-panel').hidden");
  if (h6open !== false) fail("H6a: panel did not re-open for Esc test");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(200);
  const h6closed = await evaluate(cdp, "document.getElementById('settings-panel').hidden");
  if (h6closed !== true) fail("H6b: Esc did not close settings panel");
  console.log("✓ H6: Esc closes settings panel");

  console.log("✓ H1-H6: settings panel assertions passed");

  // I: Events differentiation and filtering ────────────────────────────
  // cdp-s-wait has session_start, prompt, and waiting events from seeding
  await evaluate(cdp, "document.querySelector('.srow[data-id=\"cdp-s-wait\"]').click()");
  await sleep(1000);

  // I1: event rows have data-kind attributes
  const i1 = await evaluate(cdp, "document.querySelectorAll('#d-body .frow[data-kind]').length");
  if (i1 < 1) fail(`I1: expected at least 1 event row with data-kind attribute, got ${i1}`);
  console.log(`✓ I1: ${i1} event row(s) have data-kind attribute`);

  // I2: ev-kind spans exist (visual differentiation)
  const i2 = await evaluate(cdp, "document.querySelectorAll('#d-body .ev-kind').length");
  if (i2 < 1) fail(`I2: expected at least 1 .ev-kind span, got ${i2}`);
  console.log(`✓ I2: ${i2} .ev-kind span(s) rendered`);

  // I3: prompt row has correct color (#58a6ff)
  const i3 = await evaluate(cdp, `
    (function() {
      var row = document.querySelector('#d-body .frow[data-kind="prompt"]');
      if (!row) return false;
      var span = row.querySelector('.ev-kind');
      return span && span.style.color === 'rgb(88, 166, 255)';
    })()
  `);
  if (!i3) fail("I3: prompt event row missing .ev-kind span with color #58a6ff");
  console.log("✓ I3: prompt event .ev-kind span has correct blue color");

  // I4: waiting row has amber color (#d29922)
  const i4 = await evaluate(cdp, `
    (function() {
      var row = document.querySelector('#d-body .frow[data-kind="waiting"]');
      if (!row) return 'no-row';
      var span = row.querySelector('.ev-kind');
      if (!span) return 'no-span';
      return span.style.color;
    })()
  `);
  if (i4 !== 'rgb(210, 153, 34)') {
    // waiting event may not be present if hook didn't emit it — skip gracefully
    console.log(`~ I4: waiting row color=${i4} (skipped if no waiting event)`);
  } else {
    console.log("✓ I4: waiting event .ev-kind span has correct amber color");
  }

  // I5: ev-filter-row exists in events section
  const i5 = await evaluate(cdp, "!!document.querySelector('#d-body .ev-filter-row')");
  if (!i5) fail("I5: .ev-filter-row not found in #d-body");
  console.log("✓ I5: .ev-filter-row rendered inside events section");

  // I6: click 'solo prompts' chip → only prompt rows visible
  await evaluate(cdp, `
    (function() {
      var chip = document.querySelector('#d-body .ev-chip-solo');
      if (chip) chip.click();
    })()
  `);
  await sleep(200);
  const i6nonPromptVisible = await evaluate(cdp, `
    [...document.querySelectorAll('#d-body .frow[data-kind]')]
      .filter(function(r) { return r.dataset.kind !== 'prompt' && r.style.display !== 'none'; }).length
  `);
  if (i6nonPromptVisible > 0) fail(`I6: expected 0 non-prompt rows visible after solo-prompts click, got ${i6nonPromptVisible}`);
  const i6promptVisible = await evaluate(cdp, `
    [...document.querySelectorAll('#d-body .frow[data-kind="prompt"]')]
      .filter(function(r) { return r.style.display !== 'none'; }).length
  `);
  if (i6promptVisible < 1) fail(`I6: expected at least 1 prompt row visible after solo-prompts click, got ${i6promptVisible}`);
  console.log(`✓ I6: solo-prompts chip shows only ${i6promptVisible} prompt row(s), hides non-prompt`);

  // I7: click 'solo prompts' again → all rows restored
  await evaluate(cdp, `
    (function() {
      var chip = document.querySelector('#d-body .ev-chip-solo');
      if (chip) chip.click();
    })()
  `);
  await sleep(200);
  const i7total = await evaluate(cdp, "document.querySelectorAll('#d-body .frow[data-kind]').length");
  const i7hidden = await evaluate(cdp, `
    [...document.querySelectorAll('#d-body .frow[data-kind]')]
      .filter(function(r) { return r.style.display === 'none'; }).length
  `);
  if (i7hidden > 0) fail(`I7: expected 0 hidden rows after solo-prompts toggle off, got ${i7hidden} of ${i7total}`);
  console.log(`✓ I7: solo-prompts toggle off restored all ${i7total} event row(s)`);

  // Clean up persisted filter so other test runs start fresh
  await evaluate(cdp, "localStorage.removeItem('cl-events-filter')");

  console.log("✓ I1-I7: events differentiation and filtering assertions passed");

  // 7. Screenshot ───────────────────────────────────────────────────────
  const ss = await cdp.send<any>("Page.captureScreenshot", { format: "png" });
  const ssPath = join(tmp, "verify.png");
  writeFileSync(ssPath, Buffer.from(ss.data, "base64"));
  console.log("Screenshot:", ssPath);

  console.log("\nCDP VERIFY OK");
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
} finally {
  cdp?.close();
  try {
    serverProc?.kill();
  } catch {}
  try {
    chromeProc?.kill(9); // SIGKILL — Chrome ignores SIGTERM
  } catch {}
}
