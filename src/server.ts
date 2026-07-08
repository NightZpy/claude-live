import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { watch } from "node:fs";
import { openDb } from "./db";
import { sweep } from "./sweeper";
import { loadConfig, saveConfig, type Config } from "./config";
import { detectInstances } from "./setup";
import { homedir } from "node:os";
import { runSummarizer, summarizeOne, defaultRunner, type LlmRunner } from "./summarizer";
import { search } from "./search";
import { generateDaily, dateKey } from "./daily";
import { runSlack, defaultRunner as slackDefaultRunner } from "./slack";
import { buildResumePrompt, buildResumePromptRich } from "./resume";
import { notify, checkNotifications } from "./notify";
import { runLinks, enrichPRs, defaultGhRunner, type GhRunner } from "./links";
import { runPRFetch, BUCKET_ORDER } from "./prs";
import { enrichLinear } from "./linear";
import { syncDeadlines } from "./deadlines";
import { llmAllowed } from "./llm-gate";
import { listProjects, projectDetail, listConversations } from "./projects";

const UI_DIR = join(import.meta.dir, "../ui");
const STATIC = new Set(["index.html", "app.js", "style.css"]);

const _sseControllers = new Set<ReadableStreamDefaultController<string>>();
let _watcherStarted = false;

function _ensureWatcher() {
  if (_watcherStarted) return;
  _watcherStarted = true;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  try {
    watch(UI_DIR, { recursive: true }, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        const msg = "event: reload\ndata: {}\n\n";
        _sseControllers.forEach(ctrl => { try { ctrl.enqueue(msg); } catch {} });
      }, 300);
    });
  } catch {
    // fs.watch not available — hot reload disabled
  }
}

const INNER_SIGNALS_SQL = `
    (SELECT COUNT(*) FROM session_files f WHERE f.session_id = s.id) AS file_count,
    (SELECT COUNT(*) FROM mentions m WHERE m.session_id = s.id AND m.resolved = 0 AND (m.resolved_manual IS NULL OR m.resolved_manual = 0)) AS mentions_open,
    (SELECT COUNT(*) FROM tasks t WHERE t.session_id = s.id AND t.status NOT IN ('done', 'blocked')) AS open_tasks,
    (SELECT COUNT(*) FROM tasks t WHERE t.session_id = s.id AND t.status = 'blocked') AS blocked_tasks,
    (SELECT COUNT(*) FROM links l WHERE l.session_id = s.id AND l.kind IN ('pr', 'linear')) AS link_count`;
// is_filler requires an EXPLICIT filler phrase AND zero real activity (including zero file edits).
// A NULL/empty summary is never filler — unknown != empty.
// waiting_input sessions always need attention and are never filler.
const FILLER_CASE_SQL = `CASE WHEN
      open_tasks = 0 AND blocked_tasks = 0 AND link_count = 0 AND mentions_open = 0 AND file_count = 0
      AND status != 'waiting_input'
      AND summary IS NOT NULL AND summary != ''
      AND (LOWER(summary) LIKE '%sin tarea%'
           OR LOWER(summary) LIKE '%aguardando indicaci%'
           OR LOWER(summary) LIKE '%awaiting user%'
           OR LOWER(summary) LIKE '%no defined task%')
    THEN 1 ELSE 0 END AS is_filler`;
const ACTIVE_SQL = `
  SELECT *, ${FILLER_CASE_SQL}
  FROM (
    SELECT s.*, ${INNER_SIGNALS_SQL}
    FROM sessions s WHERE s.status != 'archived'
  )
  ORDER BY CASE status WHEN 'waiting_input' THEN 0 WHEN 'running' THEN 1 ELSE 2 END, last_activity DESC`;
const ARCHIVED_SQL = `
  SELECT *, ${FILLER_CASE_SQL}
  FROM (
    SELECT s.*, ${INNER_SIGNALS_SQL}
    FROM sessions s WHERE s.status = 'archived' ORDER BY s.ended_at DESC LIMIT 50
  )`;
const INBOX_MENTIONS_SQL = `
  SELECT m.*, s.name AS session_name
  FROM mentions m LEFT JOIN sessions s ON s.id = m.session_id
  WHERE m.resolved = 0 AND (m.resolved_manual IS NULL OR m.resolved_manual = 0)
  ORDER BY m.last_at DESC LIMIT 50`;
const INBOX_SIGNALS_SQL = `
  SELECT sg.*, s.name AS session_name
  FROM signals sg LEFT JOIN sessions s ON s.id = sg.session_id
  ORDER BY sg.created_at DESC LIMIT 50`;

const DEBOUNCE_MS = 60 * 60 * 1000;

function buildUsagePayload(db: Database, cfg: Config, now: number): object {
  const startOfToday = now - (now % 86400000);
  const startOfWeek = startOfToday - 7 * 86400000;

  type KindRow = { kind: string; cnt: number };
  const todayRows = db.query(
    "SELECT kind, COUNT(*) as cnt FROM llm_calls WHERE ts > ? GROUP BY kind"
  ).all(startOfToday) as KindRow[];

  const byKind: Record<string, number> = {};
  let todayTotal = 0;
  for (const row of todayRows) {
    byKind[row.kind] = row.cnt;
    todayTotal += row.cnt;
  }

  type CountRow = { total: number };
  const weekRow = db.query(
    "SELECT COUNT(*) as total FROM llm_calls WHERE ts > ?"
  ).get(startOfWeek) as CountRow;

  type LastRow = { ts: number; kind: string; model: string | null; ok: number };
  const lastRow = db.query(
    "SELECT ts, kind, model, ok FROM llm_calls ORDER BY ts DESC LIMIT 1"
  ).get() as LastRow | null;

  const cap = cfg.llmDailyCap ?? 100;
  return {
    today: { total: todayTotal, byKind },
    week: { total: weekRow.total },
    lastCall: lastRow ? { ts: lastRow.ts, kind: lastRow.kind, model: lastRow.model, ok: lastRow.ok === 1 } : null,
    cap,
    remaining: Math.max(0, cap - todayTotal),
    paused: cfg.llmPaused ?? false,
  };
}

function llmBlockedResponse(err: unknown): Response | null {
  if (err instanceof Error && err.message.startsWith('LLM_BLOCKED:')) {
    const reason = err.message.slice('LLM_BLOCKED:'.length);
    const error = reason === 'paused' ? 'llm_paused' : 'llm_cap';
    return Response.json({ error }, { status: 429 });
  }
  return null;
}

export function createServer(db: Database, opts: { port?: number; dailyRunner?: LlmRunner; refreshRunner?: LlmRunner; prRunner?: GhRunner } = {}) {
  const cfg = loadConfig();
  const port = opts.port ?? Number(process.env.PORT ?? cfg.port);

  _ensureWatcher();

  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    // /api/daily/regenerate, /api/sessions/:id/summarize, and /api/sessions/:id/resume-prompt
    // invoke the LLM and can take longer than Bun's 10s default idleTimeout.
    idleTimeout: 255, // Bun's maximum (seconds)
    async fetch(req) {
      const host = (req.headers.get("host") ?? "").split(":")[0];
      if (host !== "localhost" && host !== "127.0.0.1") return new Response("forbidden", { status: 403 });
      const url = new URL(req.url);
      if (url.pathname === "/api/sessions") {
        return Response.json({
          language: cfg.language,
          active: db.query(ACTIVE_SQL).all(),
          archived: db.query(ARCHIVED_SQL).all(),
        });
      }
      if (url.pathname === "/api/projects") {
        type UnlinkedRow = { id: number; author: string; text: string | null };
        const unlinkedWhere = `session_id IS NULL
             AND resolved = 0 AND (resolved_manual IS NULL OR resolved_manual = 0)`;
        const unlinkedCount = (db.query(
          `SELECT COUNT(*) c FROM mentions WHERE ${unlinkedWhere}`
        ).get() as { c: number }).c;
        const unlinkedItems = db.query(
          `SELECT id, author, text FROM mentions
           WHERE ${unlinkedWhere}
           ORDER BY last_at DESC LIMIT 20`
        ).all() as UnlinkedRow[];
        return Response.json({
          projects: listProjects(db, Date.now()),
          unlinked_mentions_open: unlinkedCount,
          unlinked_mentions_open_items: unlinkedItems,
        });
      }
      if (url.pathname === "/api/conversations") {
        return Response.json({ conversations: listConversations(db) });
      }
      const pdm = url.pathname.match(/^\/api\/projects\/([^/]+)\/detail$/);
      if (pdm) {
        const key = decodeURIComponent(pdm[1]);
        const detail = projectDetail(db, key);
        if (!detail) return new Response("not found", { status: 404 });
        return Response.json(detail);
      }
      if (url.pathname === "/api/inbox") {
        return Response.json({
          mentions: db.query(INBOX_MENTIONS_SQL).all(),
          signals: db.query(INBOX_SIGNALS_SQL).all(),
        });
      }
      const resolveM = url.pathname.match(/^\/api\/mentions\/(\d+)\/resolve$/);
      if (resolveM && req.method === "POST") {
        const id = Number(resolveM[1]);
        db.run(
          "UPDATE mentions SET resolved_manual = CASE WHEN resolved_manual = 1 THEN NULL ELSE 1 END WHERE id = ?",
          [id]
        );
        const updated = db.query("SELECT resolved_manual FROM mentions WHERE id = ?").get(id) as any;
        return Response.json({ id, resolved_manual: updated?.resolved_manual ?? null });
      }
      const m = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)$/);
      if (m) {
        const session = db.query("SELECT * FROM sessions WHERE id = ?").get(m[1]);
        if (!session) return new Response("not found", { status: 404 });
        return Response.json({
          session,
          files: db.query("SELECT * FROM session_files WHERE session_id = ? ORDER BY ts DESC").all(m[1]),
          events: db.query("SELECT * FROM events WHERE session_id = ? ORDER BY ts DESC LIMIT 100").all(m[1]),
          tasks: db.query("SELECT * FROM tasks WHERE session_id = ? ORDER BY opened_at DESC").all(m[1]),
          mentions: db.query(
            "SELECT * FROM mentions WHERE session_id = ? AND resolved = 0 AND (resolved_manual IS NULL OR resolved_manual = 0) ORDER BY last_at DESC"
          ).all(m[1]),
          links: db.query("SELECT * FROM links WHERE session_id = ? ORDER BY kind, ref").all(m[1]),
        });
      }
      if (url.pathname === "/api/search") {
        const q = url.searchParams.get("q") ?? "";
        if (q.length < 2) return Response.json({ results: [] });
        return Response.json({ results: search(db, q) });
      }
      if (url.pathname === "/api/daily" && req.method === "GET") {
        const row = db.query("SELECT * FROM daily ORDER BY date DESC LIMIT 1").get();
        if (!row) return Response.json({ date: null });
        return Response.json(row);
      }
      if (url.pathname === "/api/daily/regenerate" && req.method === "POST") {
        const force = url.searchParams.get("force") === "1";
        const today = dateKey(Date.now());
        if (!force) {
          const existing = db.query("SELECT * FROM daily WHERE date = ?").get(today) as any;
          if (existing && typeof existing.generated_at === "number" && Date.now() - existing.generated_at < DEBOUNCE_MS) {
            return Response.json(existing);
          }
        }
        const runner = opts.dailyRunner ?? defaultRunner;
        let result: Awaited<ReturnType<typeof generateDaily>>;
        try {
          result = await generateDaily(db, runner, cfg.language, Date.now(), cfg);
        } catch (err) {
          const blocked = llmBlockedResponse(err);
          if (blocked) return blocked;
          return new Response("generation failed", { status: 500 });
        }
        if (!result) return new Response("generation failed", { status: 500 });
        return Response.json(result);
      }
      const fm = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)\/file$/);
      if (fm && req.method === "GET") {
        const sessionId = fm[1];
        const rawPath = url.searchParams.get("path");
        if (!rawPath) return new Response("bad request", { status: 400 });
        const absPath = rawPath;

        // 1. allowlist check — must happen before filesystem access
        const allowed = db.query("SELECT 1 FROM session_files WHERE session_id=? AND path=?").get(sessionId, absPath);
        if (!allowed) return new Response("not found", { status: 404, headers: { "X-Content-Type-Options": "nosniff" } });

        // 2. stat (existence + size)
        let stat: { size: number };
        try {
          stat = await Bun.file(absPath).stat();
        } catch {
          return Response.json({ error: "missing" }, { status: 410, headers: { "X-Content-Type-Options": "nosniff" } });
        }
        if (stat.size > 262144) return Response.json({ error: "too_large" }, { status: 413, headers: { "X-Content-Type-Options": "nosniff" } });

        // 3. image fast path
        // svg intentionally excluded — serving svg as image/svg+xml allows script execution
        const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
        const ext = absPath.split(".").pop()?.toLowerCase() ?? "";
        if (IMAGE_EXTS.has(ext)) {
          const ct = "image/" + (ext === "jpg" ? "jpeg" : ext);
          return new Response(Bun.file(absPath), { headers: { "Content-Type": ct, "X-Content-Type-Options": "nosniff" } });
        }

        // 4. binary detection
        const chunkSize = Math.min(stat.size, 8192);
        const chunk = await Bun.file(absPath).slice(0, chunkSize).arrayBuffer();
        const bytes = new Uint8Array(chunk);
        for (let i = 0; i < bytes.length; i++) {
          if (bytes[i] === 0) return Response.json({ error: "binary" }, { status: 200, headers: { "X-Content-Type-Options": "nosniff" } });
        }

        // 5. serve as text
        const text = await Bun.file(absPath).text();
        return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } });
      }
      if (url.pathname === "/api/dev-events") {
        let ctrl!: ReadableStreamDefaultController<string>;
        const stream = new ReadableStream<string>({
          start(controller) {
            ctrl = controller;
            _sseControllers.add(ctrl);
            controller.enqueue(": connected\n\n");
          },
          cancel() {
            _sseControllers.delete(ctrl);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
          },
        });
      }
      const rm = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)\/resume-prompt$/);
      if (rm) {
        try {
          const prompt = await buildResumePromptRich(db, rm[1], defaultRunner, cfg);
          if (!prompt) return new Response("not found", { status: 404 });
          return new Response(prompt, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
        } catch (err) {
          const blocked = llmBlockedResponse(err);
          if (blocked) return blocked;
          return new Response("not found", { status: 404 });
        }
      }
      const sm = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)\/summarize$/);
      if (sm && req.method === "POST") {
        const session = db.query("SELECT * FROM sessions WHERE id = ?").get(sm[1]) as any;
        if (!session) return new Response("not found", { status: 404 });
        try {
          await summarizeOne(db, session, defaultRunner, loadConfig().language, cfg);
        } catch (err) {
          const blocked = llmBlockedResponse(err);
          if (blocked) return blocked;
          return Response.json({ error: "summarize_failed" }, { status: 502 });
        }
        return Response.json(db.query("SELECT * FROM sessions WHERE id = ?").get(sm[1]));
      }
      if (url.pathname === "/api/prs" && req.method === "GET") {
        type PRRow = {
          id: number; repo: string; number: number; title: string | null;
          url: string | null; author: string | null; bucket: string;
          is_draft: number; review_decision: string | null; checks: string | null;
          updated_at: string | null; fetched_at: number | null;
        };
        const rows = db.query(
          `SELECT * FROM prs ORDER BY
             CASE bucket
               WHEN 'needs_my_review'      THEN 0
               WHEN 'changes_requested'    THEN 1
               WHEN 'mine_mergeable'       THEN 2
               WHEN 'mine_blocked'         THEN 3
               WHEN 'commented_unanswered' THEN 4
               WHEN 'reviewed_by_me'       THEN 5
               ELSE 6
             END, updated_at DESC`
        ).all() as PRRow[];
        const counts: Record<string, number> = {};
        for (const b of BUCKET_ORDER) counts[b] = 0;
        for (const r of rows) {
          if (r.bucket in counts) counts[r.bucket]++;
        }
        return Response.json({ prs: rows, counts });
      }
      if (url.pathname === "/api/config" && req.method === "GET") {
        const c = loadConfig();
        const tokenSet = typeof c.slackToken === "string" && c.slackToken.length > 0;
        const tokenLast4 = tokenSet ? c.slackToken!.slice(-4) : "";
        const linTokenSet = typeof c.linearToken === "string" && c.linearToken.length > 0;
        const linTokenLast4 = linTokenSet ? c.linearToken!.slice(-4) : "";
        return Response.json({
          language: c.language,
          port: c.port,
          notifyWaiting: c.notifyWaiting ?? true,
          summariesAuto: c.summariesAuto === true,
          dailyAuto: c.dailyAuto === true,
          slackAuto: c.slackAuto === true,
          slackChannelsAlerts: c.slackChannelsAlerts ?? [],
          slackChannelsDeploys: c.slackChannelsDeploys ?? [],
          slackTokenSet: tokenSet,
          slackTokenLast4: tokenLast4,
          linearTokenSet: linTokenSet,
          linearTokenLast4: linTokenLast4,
          instances: c.instances,
          detectedInstances: detectInstances(homedir()),
          mentionName: c.mentionName ?? "",
          llmPaused: c.llmPaused ?? false,
          llmDailyCap: c.llmDailyCap ?? 100,
        });
      }
      if (url.pathname === "/api/config" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return new Response("bad request", { status: 400 });
        }
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          return new Response("bad request", { status: 400 });
        }
        const patch = body as Record<string, unknown>;
        const current = loadConfig();

        if ("language" in patch) {
          const lang = patch.language;
          if (lang !== "es" && lang !== "en" && lang !== "pt") {
            return new Response("invalid language", { status: 400 });
          }
          current.language = lang;
        }
        if ("notifyWaiting" in patch && typeof patch.notifyWaiting === "boolean") {
          current.notifyWaiting = patch.notifyWaiting;
        }
        if ("summariesAuto" in patch && typeof patch.summariesAuto === "boolean") {
          current.summariesAuto = patch.summariesAuto;
        }
        if ("dailyAuto" in patch && typeof patch.dailyAuto === "boolean") {
          current.dailyAuto = patch.dailyAuto;
        }
        if ("slackAuto" in patch && typeof patch.slackAuto === "boolean") {
          current.slackAuto = patch.slackAuto;
        }
        if ("slackChannelsAlerts" in patch && Array.isArray(patch.slackChannelsAlerts) &&
            (patch.slackChannelsAlerts as unknown[]).every(x => typeof x === "string")) {
          current.slackChannelsAlerts = patch.slackChannelsAlerts as string[];
        }
        if ("slackChannelsDeploys" in patch && Array.isArray(patch.slackChannelsDeploys) &&
            (patch.slackChannelsDeploys as unknown[]).every(x => typeof x === "string")) {
          current.slackChannelsDeploys = patch.slackChannelsDeploys as string[];
        }
        if ("instances" in patch && Array.isArray(patch.instances)) {
          const detected = detectInstances(homedir());
          const detectedDirs = new Set(detected.map(d => d.dir));
          const valid = (patch.instances as unknown[]).filter(
            (inst): inst is { dir: string; name: string } =>
              typeof inst === "object" && inst !== null &&
              typeof (inst as any).dir === "string" &&
              typeof (inst as any).name === "string" &&
              detectedDirs.has((inst as any).dir)
          );
          current.instances = valid;
        }
        if ("slackToken" in patch && typeof patch.slackToken === "string") {
          const tok = patch.slackToken;
          if (tok === "") {
            current.slackToken = "";
          } else if (!tok.startsWith("\u{2022}\u{2022}\u{2022}\u{2022}")) {
            current.slackToken = tok;
          }
          // masked placeholder (starts with "••••") → do not overwrite
        }
        if ("linearToken" in patch && typeof patch.linearToken === "string") {
          const tok = patch.linearToken;
          if (tok === "") {
            current.linearToken = "";
          } else if (!tok.startsWith("\u{2022}\u{2022}\u{2022}\u{2022}")) {
            current.linearToken = tok;
          }
          // masked placeholder → do not overwrite
        }
        if ("mentionName" in patch && typeof patch.mentionName === "string") {
          current.mentionName = patch.mentionName;
        }
        if ("llmPaused" in patch && typeof patch.llmPaused === "boolean") {
          current.llmPaused = patch.llmPaused;
        }
        if ("llmDailyCap" in patch) {
          const cap = patch.llmDailyCap;
          if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1 || cap > 10000) {
            return new Response("invalid llmDailyCap: must be integer 1..10000", { status: 400 });
          }
          current.llmDailyCap = cap;
        }

        saveConfig(current);

        const c = current;
        const tokenSet = typeof c.slackToken === "string" && c.slackToken.length > 0;
        const tokenLast4 = tokenSet ? c.slackToken!.slice(-4) : "";
        const linTokenSet = typeof c.linearToken === "string" && c.linearToken.length > 0;
        const linTokenLast4 = linTokenSet ? c.linearToken!.slice(-4) : "";
        return Response.json({
          language: c.language,
          port: c.port,
          notifyWaiting: c.notifyWaiting ?? true,
          summariesAuto: c.summariesAuto === true,
          dailyAuto: c.dailyAuto === true,
          slackAuto: c.slackAuto === true,
          slackChannelsAlerts: c.slackChannelsAlerts ?? [],
          slackChannelsDeploys: c.slackChannelsDeploys ?? [],
          slackTokenSet: tokenSet,
          slackTokenLast4: tokenLast4,
          linearTokenSet: linTokenSet,
          linearTokenLast4: linTokenLast4,
          instances: c.instances,
          detectedInstances: detectInstances(homedir()),
          mentionName: c.mentionName ?? "",
          llmPaused: c.llmPaused ?? false,
          llmDailyCap: c.llmDailyCap ?? 100,
        });
      }
      if (url.pathname === "/api/usage" && req.method === "GET") {
        const freshCfg = loadConfig();
        return Response.json(buildUsagePayload(db, freshCfg, Date.now()));
      }
      if (url.pathname === "/api/llm/pause" && req.method === "POST") {
        const freshCfg = loadConfig();
        freshCfg.llmPaused = true;
        saveConfig(freshCfg);
        return Response.json(buildUsagePayload(db, freshCfg, Date.now()));
      }
      if (url.pathname === "/api/llm/resume" && req.method === "POST") {
        const freshCfg = loadConfig();
        freshCfg.llmPaused = false;
        saveConfig(freshCfg);
        return Response.json(buildUsagePayload(db, freshCfg, Date.now()));
      }
      if (url.pathname === "/api/deadlines" && req.method === "GET") {
        const rows = db.query(
          "SELECT * FROM deadlines WHERE status != 'dismissed' ORDER BY due_at ASC NULLS LAST, confidence DESC"
        ).all();
        return Response.json({ deadlines: rows });
      }
      if (url.pathname === "/api/deadlines" && req.method === "POST") {
        let body: unknown;
        try { body = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
        if (typeof body !== "object" || body === null) return new Response("bad request", { status: 400 });
        const b = body as Record<string, unknown>;
        const now = Date.now();
        const placeholder = "manual:pending:" + now + ":" + Math.random().toString(36).slice(2, 10);
        db.run(
          `INSERT INTO deadlines (source, ref, title, due_at, estimate_hours, session_id, instance, status, confidence, manual_override, created_at, updated_at)
           VALUES ('manual', ?, ?, ?, ?, ?, ?, 'open', 1.0, 1, ?, ?)`,
          [placeholder,
           typeof b.title === "string" ? b.title : null,
           typeof b.due_at === "number" ? b.due_at : null,
           typeof b.estimate_hours === "number" ? b.estimate_hours : null,
           typeof b.session_id === "string" ? b.session_id : null,
           typeof b.instance === "string" ? b.instance : null,
           now, now]
        );
        const rowid = (db.query("SELECT last_insert_rowid() AS id").get() as any).id;
        db.run("UPDATE deadlines SET ref = 'manual:' || id WHERE id = ?", [rowid]);
        const row = db.query("SELECT * FROM deadlines WHERE id = ?").get(rowid);
        return Response.json(row);
      }
      const dlIdM = url.pathname.match(/^\/api\/deadlines\/(\d+)$/);
      if (dlIdM && req.method === "PATCH") {
        const id = Number(dlIdM[1]);
        let body: unknown;
        try { body = await req.json(); } catch { return new Response("bad request", { status: 400 }); }
        if (typeof body !== "object" || body === null) return new Response("bad request", { status: 400 });
        const b = body as Record<string, unknown>;
        const existing = db.query("SELECT * FROM deadlines WHERE id = ?").get(id) as any;
        if (!existing) return Response.json({ error: "not found" }, { status: 404 });
        const fields: string[] = ["manual_override = 1", "updated_at = ?"];
        const vals: unknown[] = [Date.now()];
        if ("title" in b && typeof b.title === "string") { fields.push("title = ?"); vals.push(b.title); }
        if ("due_at" in b && (typeof b.due_at === "number" || b.due_at === null)) { fields.push("due_at = ?"); vals.push(b.due_at); }
        if ("estimate_hours" in b && (typeof b.estimate_hours === "number" || b.estimate_hours === null)) { fields.push("estimate_hours = ?"); vals.push(b.estimate_hours); }
        if ("status" in b && (b.status === "open" || b.status === "done" || b.status === "dismissed")) { fields.push("status = ?"); vals.push(b.status); }
        vals.push(id);
        try {
          db.run(`UPDATE deadlines SET ${fields.join(", ")} WHERE id = ?`, vals);
        } catch {
          return new Response("bad request", { status: 400 });
        }
        return Response.json(db.query("SELECT * FROM deadlines WHERE id = ?").get(id));
      }
      if (dlIdM && req.method === "DELETE") {
        const id = Number(dlIdM[1]);
        db.run("UPDATE deadlines SET status = 'dismissed', updated_at = ? WHERE id = ?", [Date.now(), id]);
        return Response.json({ ok: true });
      }
      if (url.pathname === "/api/refresh" && req.method === "POST") {
        const freshCfg = loadConfig();
        const now = Date.now();
        const runner = opts.refreshRunner ?? defaultRunner;

        // 1. PRs — deterministic, zero-LLM; runs on every refresh regardless of LLM state
        if (freshCfg.prsEnabled !== false) {
          const ghRunner = opts.prRunner ?? defaultGhRunner;
          try {
            await runPRFetch(db, ghRunner);
          } catch {
            // best-effort: gh not auth'd or not installed — skip silently
          }
        }

        const { allowed, reason } = llmAllowed(db, freshCfg, now);
        if (!allowed) {
          return Response.json({
            summaries: 0,
            slack_ok: false,
            deadlines_checked: 0,
            daily: false,
            llm_calls_used: 0,
            blocked: reason,
          });
        }

        type CountRow = { n: number };
        const before = (db.query("SELECT COUNT(*) as n FROM llm_calls").get() as CountRow).n;

        let summaries = 0;
        let slack_ok = false;
        let deadlines_checked = 0;
        let daily = false;

        // 2. Summarizer
        try {
          summaries = await runSummarizer(db, runner, freshCfg.language, freshCfg);
        } catch (err) {
          if (err instanceof Error && err.message.startsWith('LLM_BLOCKED:')) {
            const after = (db.query("SELECT COUNT(*) as n FROM llm_calls").get() as CountRow).n;
            return Response.json({ summaries, slack_ok, deadlines_checked, daily, llm_calls_used: after - before, blocked: err.message.split(':')[1] });
          }
        }

        // 3. Slack (only if mentionName configured)
        if (freshCfg.mentionName) {
          try {
            await runSlack(db, slackDefaultRunner, runner, freshCfg, now, freshCfg);
            slack_ok = true;
          } catch (err) {
            if (err instanceof Error && err.message.startsWith('LLM_BLOCKED:')) {
              const after = (db.query("SELECT COUNT(*) as n FROM llm_calls").get() as CountRow).n;
              return Response.json({ summaries, slack_ok, deadlines_checked, daily, llm_calls_used: after - before, blocked: err.message.split(':')[1] });
            }
          }
        }

        // 4. Deadlines
        try {
          await syncDeadlines(db, { llmRunner: runner, linearToken: freshCfg.linearToken, cfg: freshCfg });
          type KindCount = { n: number };
          deadlines_checked = (db.query(
            "SELECT COUNT(*) as n FROM llm_calls WHERE kind='deadline' AND ts > ?"
          ).get(now) as KindCount).n;
        } catch (err) {
          if (err instanceof Error && err.message.startsWith('LLM_BLOCKED:')) {
            const after = (db.query("SELECT COUNT(*) as n FROM llm_calls").get() as CountRow).n;
            return Response.json({ summaries, slack_ok, deadlines_checked, daily, llm_calls_used: after - before, blocked: err.message.split(':')[1] });
          }
        }

        // 5. Daily (only if ?daily=1)
        if (url.searchParams.get("daily") === "1") {
          try {
            const result = await generateDaily(db, runner, freshCfg.language, now, freshCfg);
            daily = result !== null;
          } catch (err) {
            if (err instanceof Error && err.message.startsWith('LLM_BLOCKED:')) {
              const after = (db.query("SELECT COUNT(*) as n FROM llm_calls").get() as CountRow).n;
              return Response.json({ summaries, slack_ok, deadlines_checked, daily, llm_calls_used: after - before, blocked: err.message.split(':')[1] });
            }
          }
        }

        const after = (db.query("SELECT COUNT(*) as n FROM llm_calls").get() as CountRow).n;
        return Response.json({
          summaries,
          slack_ok,
          deadlines_checked,
          daily,
          llm_calls_used: after - before,
          blocked: null,
        });
      }
      const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (STATIC.has(name)) return new Response(Bun.file(join(UI_DIR, name)));
      return new Response("not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const db = openDb();
  const cfg = loadConfig();
  sweep(db);
  setInterval(() => {
    sweep(db);
    const liveCfg = loadConfig();
    checkNotifications(db, liveCfg.notifyWaiting !== false ? notify : () => {});
  }, 60_000);
  runLinks(db);
  enrichPRs(db, defaultGhRunner).catch(() => {});
  enrichLinear(db, cfg.linearToken).catch(() => {});
  const llmRunnerForDeadlines = cfg.summariesAuto === true ? defaultRunner : undefined;
  syncDeadlines(db, { llmRunner: llmRunnerForDeadlines, linearToken: cfg.linearToken, cfg }).catch(() => {});
  setInterval(() => {
    const liveCfg = loadConfig();
    try { runLinks(db); } catch {}
    enrichPRs(db, defaultGhRunner).catch(() => {});
    enrichLinear(db, liveCfg.linearToken).catch(() => {});
    const llmRunnerForDeadlines = liveCfg.summariesAuto === true ? defaultRunner : undefined;
    syncDeadlines(db, { llmRunner: llmRunnerForDeadlines, linearToken: liveCfg.linearToken, cfg: liveCfg }).catch(() => {});
  }, 300_000);
  setInterval(() => {
    const liveCfg = loadConfig();
    if (liveCfg.summariesAuto === true) runSummarizer(db, defaultRunner, liveCfg.language, liveCfg).catch(() => {});
  }, 3_600_000);
  setInterval(() => {
    const liveCfg = loadConfig();
    if (liveCfg.slackAuto === true) runSlack(db, slackDefaultRunner, defaultRunner, liveCfg, Date.now(), liveCfg).catch(() => {});
  }, 1_800_000);
  const srv = createServer(db);
  console.log(`claude-live on http://localhost:${srv.port}`);
}
