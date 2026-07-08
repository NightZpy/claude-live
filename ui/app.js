/* claude-live — total UI rewrite: situation map (projects-first) */

// ── I18N ─────────────────────────────────────────────────────────────────
const I18N = {
  es: {
    sessions: "Sesiones", active: "activas", archived: "Archivadas",
    search_placeholder: "buscar…", waiting_you: "esperándote",
    idle: "idle", running: "corriendo", no_sessions: "sin sesiones",
    files: "archivos", events: "eventos", close: "cerrar",
    started: "iniciada", ended: "terminó",
    sys_task: "tarea background", sys_reminder: "sistema", sys_command: "comando",
    kind_worker: "worker", workers_group: "workers (subagentes)",
    reason_exit: "terminó", reason_other: "terminó", reason_clear: "clear",
    reason_process_died: "proceso murió", reason_stale: "inactiva 24h+",
    outside_project: "fuera del proyecto", scratchpad: "scratchpad",
    preview_too_large: "archivo muy grande", preview_missing: "archivo no encontrado",
    preview_binary: "archivo binario", preview_error: "error de vista previa",
    tasks_section: "Tareas", task_open: "abierta", task_in_progress: "en progreso",
    task_done: "hecha", task_blocked: "bloqueada", task_delegated: "delegada",
    task_blocked_by: "bloqueada por", task_delegated_to: "delegada a",
    task_opened_at: "abierta", task_closed_at: "cerrada",
    match_file: "archivo", match_event: "evento", match_session: "sesión",
    opened_ago: "abierta",
    daily_title: "Hoy", daily_yesterday: "Ayer", daily_today: "Hoy",
    daily_blockers: "Bloqueos", daily_regenerate: "Regenerar", daily_empty: "—",
    slack_section: "Slack", slack_unresolved: "sin resolver",
    slack_reasks: "re-preguntas", slack_unlinked: "sin ligar",
    slack_mark_resolved: "✓ resolver",
    signals_section: "Señales", signal_alert: "alerta", signal_deploy: "deploy",
    resume_copy: "Copiar prompt de recuperación", resume_copy_id: "copiar id",
    resume_copied: "copiado", resume_failed: "error al copiar",
    links_repos: "Repos & PRs", links_linear: "Linear",
    links_artifacts: "Artefactos", files_artifact_badge: "artefacto",
    settings_title: "Configuración", settings_language: "Idioma",
    settings_notify: "Notificar cuando Claude espera tu input",
    settings_summaries_auto: "Resúmenes automáticos",
    settings_daily_auto: "Daily automático",
    settings_slack_auto: "Slack automático",
    settings_alerts: "Canales de alertas (separados por coma)",
    settings_deploys: "Canales de deploys (separados por coma)",
    settings_instances: "Instancias activas",
    settings_slack_token: "Slack token", settings_linear_token: "Linear token",
    settings_mention_name: "Nombre a buscar en Slack",
    summary_generate: "generar resumen",
    settings_slack_token_set: "configurado ····",
    settings_save: "Guardar", settings_saved: "guardado", settings_clear: "Borrar",
    usage_section: "Uso", usage_today: "hoy", usage_week: "semana",
    usage_last: "última llamada", usage_remaining: "restantes",
    usage_paused: "LLM en pausa", usage_stop: "Detener LLM", usage_resume: "Reanudar",
    refresh_all: "Actualizar todo", refresh_running: "actualizando…",
    settings_llm_cap: "Tope diario de llamadas LLM",
    daily_auto: "auto", daily_copy_slack: "copiar para Slack",
    daily_lang_es: "ES", daily_lang_en: "EN",
    day_yesterday_desc: "lo que avancé", day_today_desc: "lo que sigue",
    day_blockers_desc: "lo que me traba",
    // new keys
    hero_te_esperan: "Te esperan", hero_al_dia: "al día ✓",
    proj_sessions_block: "Sesiones", proj_tasks_block: "Tareas",
    proj_mentions_block: "Conversaciones", proj_prs_block: "PRs & Linear",
    proj_empty: "—", proj_expand_loading: "cargando…",
    strip_daily: "📋 Daily", strip_sessions: "Sesiones",
    strip_conversations: "Conversaciones",
    conv_open: "abierta", conv_resolved: "respondida",
    conv_mark_resolved: "marcar respondida", conv_no_project: "sin proyecto",
    conv_filter_open: "Abiertas", conv_filter_resolved: "Respondidas", conv_filter_all: "Todas",
    conv_all_resolved: "Todo respondido",
    usage_chip_paused: "⏸ pausado",
    strip_prs: "PRs",
    pr_rail_title: "Pull Requests",
    pr_needs_my_review: "Por revisar",
    pr_reviewed_by_me: "Ya revisé",
    pr_mine_blocked: "Míos sin poder mergear",
    pr_mine_mergeable: "Míos mergeables",
    pr_commented_unanswered: "Me comentaron, sin responder",
    pr_changes_requested: "Cambios pedidos",
    pr_filter_all: "Todos",
    pr_filter_actionable: "Pendientes",
  },
  en: {
    sessions: "Sessions", active: "active", archived: "Archived",
    search_placeholder: "search…", waiting_you: "waiting for you",
    idle: "idle", running: "running", no_sessions: "no sessions",
    files: "files", events: "events", close: "close",
    started: "started", ended: "ended",
    sys_task: "background task", sys_reminder: "system", sys_command: "command",
    kind_worker: "worker", workers_group: "workers (subagents)",
    reason_exit: "finished", reason_other: "finished", reason_clear: "clear",
    reason_process_died: "process died", reason_stale: "stale 24h+",
    outside_project: "outside project", scratchpad: "scratchpad",
    preview_too_large: "file too large", preview_missing: "file not found",
    preview_binary: "binary file", preview_error: "preview error",
    tasks_section: "Tasks", task_open: "open", task_in_progress: "in progress",
    task_done: "done", task_blocked: "blocked", task_delegated: "delegated",
    task_blocked_by: "blocked by", task_delegated_to: "delegated to",
    task_opened_at: "opened", task_closed_at: "closed",
    match_file: "file", match_event: "event", match_session: "session",
    opened_ago: "opened",
    daily_title: "Today", daily_yesterday: "Yesterday", daily_today: "Today",
    daily_blockers: "Blockers", daily_regenerate: "Regenerate", daily_empty: "—",
    slack_section: "Slack", slack_unresolved: "unresolved",
    slack_reasks: "re-asks", slack_unlinked: "unlinked",
    slack_mark_resolved: "✓ resolve",
    signals_section: "Signals", signal_alert: "alert", signal_deploy: "deploy",
    resume_copy: "Copy recovery prompt", resume_copy_id: "copy id",
    resume_copied: "copied", resume_failed: "copy failed",
    links_repos: "Repos & PRs", links_linear: "Linear",
    links_artifacts: "Artifacts", files_artifact_badge: "artifact",
    settings_title: "Settings", settings_language: "Language",
    settings_notify: "Notify when Claude is waiting for input",
    settings_summaries_auto: "Auto summaries",
    settings_daily_auto: "Auto daily",
    settings_slack_auto: "Auto Slack",
    settings_alerts: "Alert channels (comma-separated)",
    settings_deploys: "Deploy channels (comma-separated)",
    settings_instances: "Active instances",
    settings_slack_token: "Slack token", settings_linear_token: "Linear token",
    settings_mention_name: "Slack mention name",
    summary_generate: "generate summary",
    settings_slack_token_set: "set ····",
    settings_save: "Save", settings_saved: "saved", settings_clear: "Clear",
    usage_section: "Usage", usage_today: "today", usage_week: "week",
    usage_last: "last call", usage_remaining: "remaining",
    usage_paused: "LLM paused", usage_stop: "Stop LLM", usage_resume: "Resume",
    refresh_all: "Refresh all", refresh_running: "refreshing…",
    settings_llm_cap: "Daily LLM call cap",
    daily_auto: "auto", daily_copy_slack: "copy for Slack",
    daily_lang_es: "ES", daily_lang_en: "EN",
    day_yesterday_desc: "what I did", day_today_desc: "what's next",
    day_blockers_desc: "what's blocking",
    hero_te_esperan: "Pending", hero_al_dia: "up to date ✓",
    proj_sessions_block: "Sessions", proj_tasks_block: "Tasks",
    proj_mentions_block: "Mentions", proj_prs_block: "PRs & Linear",
    proj_empty: "—", proj_expand_loading: "loading…",
    strip_daily: "📋 Daily", strip_sessions: "Sessions",
    strip_conversations: "Conversations",
    conv_open: "open", conv_resolved: "resolved",
    conv_mark_resolved: "mark resolved", conv_no_project: "no project",
    conv_filter_open: "Open", conv_filter_resolved: "Resolved", conv_filter_all: "All",
    conv_all_resolved: "All resolved",
    usage_chip_paused: "⏸ paused",
    strip_prs: "PRs",
    pr_rail_title: "Pull Requests",
    pr_needs_my_review: "To review",
    pr_reviewed_by_me: "Reviewed",
    pr_mine_blocked: "Mine, not mergeable",
    pr_mine_mergeable: "Mine, mergeable",
    pr_commented_unanswered: "Commented, unanswered",
    pr_changes_requested: "Changes requested",
    pr_filter_all: "All",
    pr_filter_actionable: "Pending",
  },
  pt: {
    sessions: "Sessões", active: "ativas", archived: "Arquivadas",
    search_placeholder: "buscar…", waiting_you: "esperando você",
    idle: "idle", running: "rodando", no_sessions: "sem sessões",
    files: "arquivos", events: "eventos", close: "fechar",
    started: "iniciada", ended: "terminou",
    sys_task: "tarefa background", sys_reminder: "sistema", sys_command: "comando",
    kind_worker: "worker", workers_group: "workers (subagentes)",
    reason_exit: "terminou", reason_other: "terminou", reason_clear: "clear",
    reason_process_died: "processo morreu", reason_stale: "inativa 24h+",
    outside_project: "fora do projeto", scratchpad: "scratchpad",
    preview_too_large: "arquivo muito grande", preview_missing: "arquivo não encontrado",
    preview_binary: "arquivo binário", preview_error: "erro de pré-visualização",
    tasks_section: "Tarefas", task_open: "aberta", task_in_progress: "em progresso",
    task_done: "feita", task_blocked: "bloqueada", task_delegated: "delegada",
    task_blocked_by: "bloqueada por", task_delegated_to: "delegada a",
    task_opened_at: "aberta", task_closed_at: "fechada",
    match_file: "arquivo", match_event: "evento", match_session: "sessão",
    opened_ago: "aberta",
    daily_title: "Hoje", daily_yesterday: "Ontem", daily_today: "Hoje",
    daily_blockers: "Bloqueios", daily_regenerate: "Regenerar", daily_empty: "—",
    slack_section: "Slack", slack_unresolved: "sem resolver",
    slack_reasks: "re-perguntas", slack_unlinked: "sem vincular",
    slack_mark_resolved: "✓ resolver",
    signals_section: "Sinais", signal_alert: "alerta", signal_deploy: "deploy",
    resume_copy: "Copiar prompt de recuperação", resume_copy_id: "copiar id",
    resume_copied: "copiado", resume_failed: "erro ao copiar",
    links_repos: "Repos & PRs", links_linear: "Linear",
    links_artifacts: "Artefatos", files_artifact_badge: "artefato",
    settings_title: "Configurações", settings_language: "Idioma",
    settings_notify: "Notificar quando Claude aguarda input",
    settings_summaries_auto: "Resumos automáticos",
    settings_daily_auto: "Daily automático",
    settings_slack_auto: "Slack automático",
    settings_alerts: "Canais de alertas (separados por vírgula)",
    settings_deploys: "Canais de deploys (separados por vírgula)",
    settings_instances: "Instâncias ativas",
    settings_slack_token: "Slack token", settings_linear_token: "Linear token",
    settings_mention_name: "Nome a buscar no Slack",
    summary_generate: "gerar resumo",
    settings_slack_token_set: "configurado ····",
    settings_save: "Salvar", settings_saved: "salvo", settings_clear: "Limpar",
    usage_section: "Uso", usage_today: "hoje", usage_week: "semana",
    usage_last: "última chamada", usage_remaining: "restantes",
    usage_paused: "LLM pausado", usage_stop: "Parar LLM", usage_resume: "Retomar",
    refresh_all: "Atualizar tudo", refresh_running: "atualizando…",
    settings_llm_cap: "Limite diário de chamadas LLM",
    daily_auto: "auto", daily_copy_slack: "copiar para Slack",
    daily_lang_es: "ES", daily_lang_en: "EN",
    day_yesterday_desc: "o que avancei", day_today_desc: "o que segue",
    day_blockers_desc: "o que trava",
    hero_te_esperan: "Aguardando", hero_al_dia: "em dia ✓",
    proj_sessions_block: "Sessões", proj_tasks_block: "Tarefas",
    proj_mentions_block: "Conversas", proj_prs_block: "PRs & Linear",
    proj_empty: "—", proj_expand_loading: "carregando…",
    strip_daily: "📋 Daily", strip_sessions: "Sessões",
    strip_conversations: "Conversas",
    conv_open: "aberta", conv_resolved: "respondida",
    conv_mark_resolved: "marcar respondida", conv_no_project: "sem projeto",
    conv_filter_open: "Abertas", conv_filter_resolved: "Respondidas", conv_filter_all: "Todas",
    conv_all_resolved: "Tudo respondido",
    usage_chip_paused: "⏸ pausado",
    strip_prs: "PRs",
    pr_rail_title: "Pull Requests",
    pr_needs_my_review: "Para revisar",
    pr_reviewed_by_me: "Já revisei",
    pr_mine_blocked: "Meus, não mergeáveis",
    pr_mine_mergeable: "Meus, mergeáveis",
    pr_commented_unanswered: "Comentaram, sem resposta",
    pr_changes_requested: "Mudanças pedidas",
    pr_filter_all: "Todos",
    pr_filter_actionable: "Pendentes",
  },
};

// ── state ─────────────────────────────────────────────────────────────────
let lang = "es";
let t = I18N.es;
let openId = null;          // session in detail panel
let openProjectKey = null;  // expanded project accordion
let _projectDetailCache = new Map(); // key → {sessions,tasks,mentions,prs}
let inSearchMode = false;
let searchDebounce = null;
let viewMode = "projects";  // "projects" | "sessions"
let dailyLang = null;
let _usageData = null;
let _lastProjects = [];
let _lastSessions = { active: [], archived: [] };
let _lastDailyData = null;
let _heroDropdownOpen = false;
let _unlinkedMentionsOpen = 0;
let _unlinkedMentionsOpenItems = [];
let _lastConversations = null;  // null = not yet fetched
let _convFilter = 'open';       // 'open' | 'resolved' | 'all'
let _lastPRs = null;            // null = not yet fetched; { prs: [], counts: {} }
let _prFilter = 'actionable';   // 'actionable' | 'all' | bucket name

// ── pure helpers (ported) ─────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtDur(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60),
        h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return d + "d " + (h % 24) + "h";
  if (h > 0) return h + "h " + (m % 60) + "m";
  if (m > 0) return m + "m";
  return s + "s";
}

function rel(ts) {
  if (!ts) return "";
  return fmtDur(Date.now() - ts);
}

function fmtTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtAbsDateTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function archiveReasonLabel(reason) {
  if (!reason) return "";
  if (reason === "exit" || reason === "other") return t.reason_exit || t.reason_other || reason;
  if (reason === "clear") return t.reason_clear || reason;
  if (reason === "process_died") return t.reason_process_died || reason;
  if (reason === "stale") return t.reason_stale || reason;
  return reason;
}

function decodePrompt(text) {
  const trimmed = (text || "").trimStart();
  if (trimmed.startsWith("<task-notification>")) {
    const summary = (/<summary>([\s\S]*?)<\/summary>/.exec(trimmed) || [])[1] || "";
    const status  = (/<status>([\s\S]*?)<\/status>/.exec(trimmed) || [])[1] || "";
    const taskId  = (/<task-id>([\s\S]*?)<\/task-id>/.exec(trimmed) || [])[1] || "";
    let decoded = summary.trim();
    if (status.trim()) decoded += " · " + status.trim();
    if (!decoded) decoded = taskId.trim();
    return { kind: "system", label: "sys_task", text: decoded };
  }
  if (trimmed.startsWith("<system-reminder>")) {
    const inner = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { kind: "system", label: "sys_reminder", text: inner };
  }
  if (trimmed.startsWith("<command-name>")) {
    const m = /<command-name>([\s\S]*?)<\/command-name>/.exec(trimmed);
    return { kind: "system", label: "sys_command", text: m ? m[1].trim() : "" };
  }
  if (trimmed.startsWith("<local-command-caveat>")) {
    const inner = trimmed.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return { kind: "system", label: "sys_command", text: inner };
  }
  return { kind: "user" };
}

function sysChip(label, decoded) {
  return '<span class="badge-sys">' + esc(t[label] || label) + "</span>" +
         ' <em class="dim">' + esc(decoded) + "</em>";
}

function basename(p) {
  if (!p) return "";
  return p.replace(/\/$/, "").split("/").pop() || p;
}

function relPath(filePath, cwd) {
  if (!cwd) return null;
  const cwdSlash = cwd.endsWith("/") ? cwd : cwd + "/";
  if (filePath.startsWith(cwdSlash)) return filePath.slice(cwdSlash.length);
  return null;
}

function fileGroup(filePath, cwd) {
  if (/\/tmp\/claude-[^/]+(?:\/.+)?\/scratchpad\//.test(filePath)) {
    return { dir: "__scratchpad__", label: t.scratchpad || "scratchpad" };
  }
  const rel2 = relPath(filePath, cwd);
  if (rel2 === null) return { dir: "__outside__", label: t.outside_project || "outside project" };
  const parts = rel2.split("/");
  const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
  return { dir, label: dir };
}

function dotClass(status) {
  if (status === "running") return "d-run";
  if (status === "waiting_input") return "d-wait";
  if (status === "idle") return "d-idle";
  return "d-arch";
}

function taskStatusClass(status) {
  if (status === "open") return "amber";
  if (status === "in_progress") return "blue";
  if (status === "done") return "dim";
  if (status === "blocked") return "red";
  if (status === "delegated") return "violet";
  return "muted";
}

// ── mdToSafeHtml (ported) ─────────────────────────────────────────────────
function mdToSafeHtml(escapedText) {
  var lines = escapedText.split("\n"), out = [], inCode = false,
      codeLines = [], listBuf = null, quoteBuf = [];
  function flushList() {
    if (!listBuf) return;
    out.push("<" + listBuf.tag + ">" + listBuf.items.map(function(i) { return "<li>" + i + "</li>"; }).join("") + "</" + listBuf.tag + ">");
    listBuf = null;
  }
  function flushQuote() {
    if (!quoteBuf.length) return;
    out.push("<blockquote>" + quoteBuf.join("<br>") + "</blockquote>");
    quoteBuf = [];
  }
  function inline(s) {
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, text, url) {
      if (url.startsWith("http://") || url.startsWith("https://")) {
        var safeUrl = url.replace(/&quot;/g, "%22").replace(/\s.*$/, "");
        return '<a href="' + safeUrl + '" target="_blank" rel="noopener">' + text + "</a>";
      }
      return "[" + text + "](" + url + ")";
    });
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__(.+?)__/g, "<strong>$1</strong>");
    s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
    s = s.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");
    return s;
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.trim() === "```") {
      if (inCode) { out.push("<pre><code>" + codeLines.join("\n") + "</code></pre>"); codeLines = []; inCode = false; }
      else { flushList(); flushQuote(); inCode = true; }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    var hm = line.match(/^(#{1,6}) (.+)$/);
    if (hm) { flushList(); flushQuote(); out.push("<h" + hm[1].length + ">" + inline(hm[2]) + "</h" + hm[1].length + ">"); continue; }
    if (line.startsWith("&gt; ")) { flushList(); quoteBuf.push(inline(line.slice(5))); continue; }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushQuote();
      var item = inline(line.slice(2));
      if (listBuf && listBuf.tag === "ul") listBuf.items.push(item);
      else { flushList(); listBuf = { tag: "ul", items: [item] }; }
      continue;
    }
    var om = line.match(/^\d+\. (.+)$/);
    if (om) {
      flushQuote();
      var olItem = inline(om[1]);
      if (listBuf && listBuf.tag === "ol") listBuf.items.push(olItem);
      else { flushList(); listBuf = { tag: "ol", items: [olItem] }; }
      continue;
    }
    flushList(); flushQuote();
    if (line.trim() === "") { out.push("<br>"); continue; }
    out.push("<p>" + inline(line) + "</p>");
  }
  flushList(); flushQuote();
  if (inCode) out.push("<pre><code>" + codeLines.join("\n") + "</code></pre>");
  return out.join("");
}

// ── EVENT_META ────────────────────────────────────────────────────────────
const EVENT_META = {
  prompt:        { icon: "›", color: "#58a6ff" },
  waiting:       { icon: "⏸", color: "#d29922" },
  stop:          { icon: "■", color: "#484f58" },
  session_start: { icon: "●", color: "#3fb950" },
  session_end:   { icon: "○", color: "#6e7681" },
};
function eventMeta(kind) { return EVENT_META[kind] || { icon: "·", color: "#484f58" }; }

function buildEventsFilterRow(presentKinds, activeEvKinds) {
  if (!presentKinds.length) return "";
  var isAll = activeEvKinds.size === 0 || presentKinds.every(function(k) { return activeEvKinds.has(k); });
  var chips = '<span class="ev-chip' + (isAll ? " active" : "") + '" data-kind="all">todas</span>';
  presentKinds.forEach(function(kind) {
    var meta = eventMeta(kind), isActive = isAll || activeEvKinds.has(kind);
    chips += '<span class="ev-chip' + (isActive ? " active" : "") + '" data-kind="' + esc(kind) + '">' +
      '<span style="color:' + meta.color + '">' + meta.icon + "</span> " + esc(kind) + "</span>";
  });
  if (presentKinds.indexOf("prompt") !== -1) {
    var soloActive = activeEvKinds.size === 1 && activeEvKinds.has("prompt");
    chips += '<span class="ev-chip ev-chip-solo' + (soloActive ? " active" : "") + '" data-kind="__solo_prompts__">solo prompts</span>';
  }
  return '<div class="ev-filter-row">' + chips + "</div>";
}

function buildConversationsFilterRow(activeFilter) {
  var segments = [
    { key: "open",     label: t.conv_filter_open     || "Abiertas"   },
    { key: "resolved", label: t.conv_filter_resolved || "Respondidas" },
    { key: "all",      label: t.conv_filter_all      || "Todas"      },
  ];
  var chips = segments.map(function(seg) {
    return '<span class="ev-chip' + (activeFilter === seg.key ? " active" : "") +
      '" data-conv-filter="' + esc(seg.key) + '">' + esc(seg.label) + "</span>";
  }).join("");
  return '<div class="ev-filter-row">' + chips + "</div>";
}

// ── hero counter ──────────────────────────────────────────────────────────
function computeHeroN(projects) {
  var fromProjects = projects.reduce(function(sum, p) {
    return sum + (p.sessions_waiting || 0) + (p.blocked_tasks || 0) + (p.mentions_open || 0);
  }, 0);
  var fromPRs = _lastPRs
    ? ((_lastPRs.counts.needs_my_review || 0) + (_lastPRs.counts.changes_requested || 0) + (_lastPRs.counts.commented_unanswered || 0))
    : 0;
  return fromProjects + _unlinkedMentionsOpen + fromPRs;
}

function renderHero(projects) {
  const heroEl = document.getElementById("hero");
  if (!heroEl) return;
  const n = computeHeroN(projects);
  const hasBlocked = projects.some(function(p) { return p.blocked_tasks > 0; });
  const hasAction = n > 0;
  heroEl.className = "hero " + (hasBlocked ? "hero-blocked" : hasAction ? "hero-action" : "hero-ok");
  if (n === 0) {
    heroEl.textContent = t.hero_al_dia || "al día ✓";
  } else {
    heroEl.textContent = (t.hero_te_esperan || "Te esperan") + ": " + n;
  }
}

function buildHeroDropdownItems(projects) {
  var items = [];
  projects.forEach(function(p) {
    if (p.sessions_waiting > 0) {
      items.push({ proj: p.key, what: "⏸ " + p.sessions_waiting + " " + (t.waiting_you || "esperándote"), id: null });
    }
    if (p.blocked_tasks > 0) {
      items.push({ proj: p.key, what: "⚠ " + p.blocked_tasks + " bloqueada(s)", id: null });
    }
    if (p.mentions_open > 0) {
      items.push({ proj: p.key, what: "@ " + p.mentions_open + " mención(es)", id: null });
    }
  });
  // Unlinked open mentions (session_id IS NULL)
  _unlinkedMentionsOpenItems.forEach(function(m) {
    var excerpt = (m.text || "").slice(0, 40);
    items.push({ proj: null, what: "@ " + (m.author || "") + ": " + excerpt, id: null, kind: "mention" });
  });
  // Actionable PRs
  var actionableBuckets = new Set(["needs_my_review", "changes_requested", "commented_unanswered"]);
  if (_lastPRs && _lastPRs.prs) {
    _lastPRs.prs.filter(function(pr) { return actionableBuckets.has(pr.bucket); }).slice(0, 10).forEach(function(pr) {
      var repoNum = (pr.repo || "").split("/").pop() + "#" + pr.number;
      var title = (pr.title || "").slice(0, 50);
      items.push({ proj: null, what: "⑃ " + repoNum + ": " + title, id: pr.id, kind: "pr", prBucket: pr.bucket });
    });
  }
  return items;
}

function toggleHeroDropdown(projects) {
  const dd = document.getElementById("hero-dropdown");
  if (!dd) return;
  if (!dd.hidden) { dd.hidden = true; _heroDropdownOpen = false; return; }
  const items = buildHeroDropdownItems(projects);
  if (!items.length) return;
  dd.innerHTML = items.map(function(item) {
    var projLabel = item.proj != null ? item.proj : (t.conv_no_project || "sin proyecto");
    return '<div class="hero-item" data-key="' + (item.proj != null ? esc(item.proj) : "") +
      '" data-unlinked="' + (item.proj == null ? "1" : "0") +
      '" data-kind="' + esc(item.kind || "proj") + '">' +
      '<span class="hi-proj">' + esc(projLabel) + '</span>' +
      '<span class="hi-what">' + esc(item.what) + '</span>' +
      "</div>";
  }).join("");
  dd.querySelectorAll(".hero-item").forEach(function(el) {
    el.addEventListener("click", function() {
      dd.hidden = true;
      _heroDropdownOpen = false;
      if (el.dataset.kind === "pr") {
        openPRsView();
      } else if (el.dataset.unlinked === "1") {
        openConversationsView();
      } else {
        expandProjectByKey(el.dataset.key);
      }
    });
  });
  dd.hidden = false;
  _heroDropdownOpen = true;
}

// ── usage chip ────────────────────────────────────────────────────────────
function renderUsageChip(usage) {
  _usageData = usage;
  const chip = document.getElementById("usage-chip");
  if (!chip) return;
  const todayTotal = (usage.today && usage.today.total != null) ? usage.today.total : 0;
  const cap = usage.cap != null ? usage.cap : 100;
  const pct = cap > 0 ? todayTotal / cap : 0;
  chip.className = "usage-chip" + (usage.paused ? " usage-paused" : pct >= 0.9 ? " usage-crit" : pct >= 0.7 ? " usage-warn" : "");
  const dotColor = usage.paused ? "usage-paused" : pct >= 0.9 ? "usage-crit" : pct >= 0.7 ? "usage-warn" : "";
  const dotClass2 = "usage-dot" + (dotColor ? "" : "");
  if (usage.paused) {
    chip.innerHTML = '<span class="usage-dot"></span>' + esc(t.usage_chip_paused || "⏸ pausado");
  } else {
    chip.innerHTML = '<span class="usage-dot"></span>LLM ' + todayTotal + "/" + cap;
  }
  // Paused banner
  const banner = document.getElementById("paused-banner");
  if (banner) {
    if (usage.paused) { banner.textContent = t.usage_paused || "LLM en pausa"; banner.removeAttribute("hidden"); }
    else banner.setAttribute("hidden", "");
  }
}

function openUsagePopover() {
  const pop = document.getElementById("usage-popover");
  if (!pop) return;
  if (!pop.hidden) { pop.hidden = true; return; }
  const usage = _usageData || {};
  const todayTotal = (usage.today && usage.today.total != null) ? usage.today.total : 0;
  const cap = usage.cap != null ? usage.cap : 100;
  const remaining = usage.remaining != null ? usage.remaining : cap;
  const weekTotal = (usage.week && usage.week.total != null) ? usage.week.total : 0;
  const byKind = usage.today && usage.today.byKind ? usage.today.byKind : {};
  var kindRows = Object.keys(byKind).map(function(k) {
    return '<div class="frow"><span class="dim">' + esc(k) + '</span><span>' + esc(String(byKind[k])) + '</span></div>';
  }).join("");
  var lastCallHtml = '<span class="dim">—</span>';
  if (usage.lastCall) {
    var lc = usage.lastCall, lcAge = lc.ts ? rel(lc.ts) : "";
    lastCallHtml = esc(lc.kind || "") + (lcAge ? " · " + esc(lcAge) : "") + (lc.ok === false ? ' <span class="red">✗</span>' : "");
  }
  var stopResumeBtn = usage.paused
    ? '<button class="sbtn-clear usage-action-btn" id="usage-resume-btn">' + esc(t.usage_resume || "Reanudar") + "</button>"
    : '<button class="sbtn-clear usage-action-btn usage-stop-btn" id="usage-stop-btn">' + esc(t.usage_stop || "Detener LLM") + "</button>";
  pop.innerHTML =
    '<div class="frow"><span class="dim">' + esc(t.usage_today || "hoy") + '</span><span>' + todayTotal + " / " + cap + ' <span class="dim">(' + remaining + ' ' + esc(t.usage_remaining || "restantes") + ')</span></span></div>' +
    '<div class="frow"><span class="dim">' + esc(t.usage_week || "semana") + '</span><span>' + weekTotal + "</span></div>" +
    '<div class="frow"><span class="dim">' + esc(t.usage_last || "última llamada") + '</span><span>' + lastCallHtml + "</span></div>" +
    (kindRows || "") +
    '<div style="margin-top:8px">' + stopResumeBtn + "</div>";
  pop.hidden = false;
  var stopBtn = pop.querySelector("#usage-stop-btn");
  if (stopBtn) {
    stopBtn.addEventListener("click", function() {
      stopBtn.disabled = true;
      fetch("/api/llm/pause", { method: "POST" })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) { if (d) { renderUsageChip(d); pop.hidden = true; } })
        .catch(function() { stopBtn.disabled = false; });
    });
  }
  var resumeBtn = pop.querySelector("#usage-resume-btn");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", function() {
      resumeBtn.disabled = true;
      fetch("/api/llm/resume", { method: "POST" })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) { if (d) { renderUsageChip(d); pop.hidden = true; } })
        .catch(function() { resumeBtn.disabled = false; });
    });
  }
}

function pollUsage() {
  fetch("/api/usage")
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) { if (d) renderUsageChip(d); })
    .catch(function() {});
}

// usage card at bottom (backward compat for CDP J1-J3) — also renders
function renderUsage(usage) {
  _usageData = usage;
  renderUsageChip(usage);
  var card = document.getElementById("usage-card");
  if (!card) return;
  var summaryLabel = esc(t.usage_section || "Uso");
  if (usage.paused) summaryLabel += ' <span class="badge-sys usage-paused-badge">' + esc(t.usage_paused || "LLM en pausa") + "</span>";
  var todayTotal = (usage.today && usage.today.total != null) ? usage.today.total : 0;
  var weekTotal = (usage.week && usage.week.total != null) ? usage.week.total : 0;
  var cap = usage.cap != null ? usage.cap : 100;
  var remaining = usage.remaining != null ? usage.remaining : cap;
  var byKind = usage.today && usage.today.byKind ? usage.today.byKind : {};
  var kindRows = Object.keys(byKind).map(function(k) {
    return '<div class="frow"><span class="dim">' + esc(k) + "</span><span>" + esc(String(byKind[k])) + "</span></div>";
  }).join("");
  if (!kindRows) kindRows = '<div class="dim">—</div>';
  var lastCallHtml = '<span class="dim">—</span>';
  if (usage.lastCall) {
    var lc = usage.lastCall, lcAge = lc.ts ? rel(lc.ts) : "";
    lastCallHtml = esc(lc.kind || "") + (lcAge ? " · " + esc(lcAge) : "") + (lc.ok === false ? ' <span class="red">✗</span>' : "");
  }
  var stopResumeBtn = usage.paused
    ? '<button class="sbtn-clear usage-action-btn" id="usage-resume-btn">' + esc(t.usage_resume || "Reanudar") + "</button>"
    : '<button class="sbtn-clear usage-action-btn usage-stop-btn" id="usage-stop-btn">' + esc(t.usage_stop || "Detener LLM") + "</button>";
  var bodyHtml =
    '<div class="frow"><span class="dim">' + esc(t.usage_today || "hoy") + "</span><span>" + todayTotal + " / " + cap + " · " + remaining + " " + esc(t.usage_remaining || "restantes") + "</span></div>" +
    '<div class="frow"><span class="dim">' + esc(t.usage_week || "semana") + "</span><span>" + weekTotal + "</span></div>" +
    '<div class="frow"><span class="dim">' + esc(t.usage_last || "última llamada") + "</span><span>" + lastCallHtml + "</span></div>" +
    kindRows + '<div style="margin-top:6px">' + stopResumeBtn + "</div>";
  card.innerHTML =
    '<details class="dsec" id="usage-details">' +
      "<summary><span class=\"arr\">▶</span><span class=\"lbl\">" + summaryLabel + "</span></summary>" +
      '<div class="body">' + bodyHtml + "</div>" +
    "</details>";
  var det = card.querySelector("#usage-details");
  if (det) det.addEventListener("toggle", function() { if (det.open) pollUsage(); });
  var stopBtn = card.querySelector("#usage-stop-btn");
  if (stopBtn) {
    stopBtn.addEventListener("click", function() {
      stopBtn.disabled = true;
      fetch("/api/llm/pause", { method: "POST" })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) { if (d) renderUsage(d); })
        .catch(function() { stopBtn.disabled = false; });
    });
  }
  var resumeBtn = card.querySelector("#usage-resume-btn");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", function() {
      resumeBtn.disabled = true;
      fetch("/api/llm/resume", { method: "POST" })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) { if (d) renderUsage(d); })
        .catch(function() { resumeBtn.disabled = false; });
    });
  }
}

// ── project dot class ─────────────────────────────────────────────────────
function projectDotClass(p) {
  if (p.blocked_tasks > 0 || p.sessions_waiting > 0) {
    return p.blocked_tasks > 0 ? "pdot-blocked" : "pdot-waiting";
  }
  if (p.sessions_active > 0) return "pdot-active";
  return "pdot-quiet";
}

// ── render projects ───────────────────────────────────────────────────────
function renderProjects(projects) {
  _lastProjects = projects;
  const list = document.getElementById("projects-list");
  if (!list) return;
  renderHero(projects);

  // client-side sort: blocked first, then waiting, then active, then quiet; within tier by last_activity DESC
  var sorted = projects.slice().sort(function(a, b) {
    function tier(p) {
      if (p.blocked_tasks > 0) return 0;
      if (p.sessions_waiting > 0) return 1;
      if (p.sessions_active > 0) return 2;
      return 3;
    }
    var ta = tier(a), tb = tier(b);
    if (ta !== tb) return ta - tb;
    return (b.last_activity || 0) - (a.last_activity || 0);
  });

  // preserve open accordion
  var wasOpen = openProjectKey;

  list.innerHTML = sorted.map(function(p) {
    var dotCls = projectDotClass(p);
    var badges = "";
    if (p.sessions_waiting > 0) badges += '<span class="pbadge pbadge-wait">⏸' + p.sessions_waiting + "</span>";
    if (p.blocked_tasks > 0) badges += '<span class="pbadge pbadge-blk">⚠' + p.blocked_tasks + "</span>";
    if (p.mentions_open > 0) badges += '<span class="pbadge pbadge-at">@' + p.mentions_open + "</span>";
    if (p.prs_open > 0) badges += '<span class="pbadge pbadge-pr">PR ' + p.prs_open + "</span>";
    var age = p.last_activity ? '<span class="prow-age">' + rel(p.last_activity) + "</span>" : "";
    var summary = p.latest_summary
      ? '<span class="prow-summary">' + esc(p.latest_summary.slice(0, 80)) + "</span>"
      : '<span class="prow-summary"></span>';
    return '<div class="prow" data-key="' + esc(p.key) + '">' +
      '<div class="prow-header">' +
        '<span class="prow-dot ' + dotCls + '"></span>' +
        '<span class="prow-name">' + esc(p.name) + "</span>" +
        summary +
        (badges ? '<div class="prow-badges">' + badges + "</div>" : "") +
        age +
      "</div>" +
      "</div>";
  }).join("");

  list.querySelectorAll(".prow").forEach(function(row) {
    row.addEventListener("click", function() {
      var key = row.dataset.key;
      if (openProjectKey === key) {
        collapseProject(row);
      } else {
        collapseAllProjects();
        expandProject(row, key);
      }
    });
  });

  // restore previously open accordion
  if (wasOpen) {
    var row = list.querySelector('.prow[data-key="' + CSS.escape(wasOpen) + '"]');
    if (row) expandProject(row, wasOpen);
  }
}

function expandProjectByKey(key) {
  if (viewMode !== "projects") switchToView("projects");
  var list = document.getElementById("projects-list");
  if (!list) return;
  var row = list.querySelector('.prow[data-key="' + CSS.escape(key) + '"]');
  if (!row) return;
  if (openProjectKey === key) return;
  collapseAllProjects();
  expandProject(row, key);
}

function collapseAllProjects() {
  var list = document.getElementById("projects-list");
  if (!list) return;
  list.querySelectorAll(".prow.prow-open").forEach(function(r) { collapseProject(r); });
}

function collapseProject(row) {
  row.classList.remove("prow-open");
  var detail = row.querySelector(".proj-detail");
  if (detail) detail.remove();
  if (openProjectKey === row.dataset.key) openProjectKey = null;
}

function expandProject(row, key) {
  openProjectKey = key;
  row.classList.add("prow-open");
  var existing = row.querySelector(".proj-detail");
  if (existing) existing.remove();
  var placeholder = document.createElement("div");
  placeholder.className = "proj-detail";
  placeholder.innerHTML = '<div class="dim" style="font-size:11px;padding:4px 0">' + esc(t.proj_expand_loading || "cargando…") + "</div>";
  row.appendChild(placeholder);

  // Check cache first
  if (_projectDetailCache.has(key)) {
    renderProjectDetailInline(row, key, _projectDetailCache.get(key));
    return;
  }

  fetch("/api/projects/" + encodeURIComponent(key) + "/detail")
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(detail) {
      if (!detail) return;
      _projectDetailCache.set(key, detail);
      if (openProjectKey === key) renderProjectDetailInline(row, key, detail);
    })
    .catch(function() {});
}

function renderProjectDetailInline(row, key, detail) {
  var existing = row.querySelector(".proj-detail");
  if (existing) existing.remove();

  var sessions = detail.sessions || [];
  var tasks = detail.tasks || [];
  var mentions = detail.mentions || [];
  var prs = detail.prs || [];
  var linearLinks = [];
  // note: prs already filtered in backend to kind='pr'; linear links not included in this endpoint
  // but if they were embedded we'd handle them here

  // SESSIONS block
  var sessHtml = sessions.slice(0, 5).map(function(s) {
    var dc = dotClass(s.status);
    var statusStr = s.status === "waiting_input" ? (t.waiting_you || "esperando") : s.status === "running" ? (t.running || "corriendo") : s.status;
    var elapsed = s.last_activity ? rel(s.last_activity) : "";
    var name = s.name || basename(s.cwd) || s.id;
    return '<div class="sess-mini" data-sid="' + esc(s.id) + '">' +
      '<span class="dot ' + dc + '"></span>' +
      '<span class="sess-mini-name">' + esc(name) + "</span>" +
      '<span class="sess-mini-status">' + esc(statusStr) + (elapsed ? " · " + esc(elapsed) : "") + "</span>" +
      "</div>";
  }).join("");
  if (!sessHtml) sessHtml = '<div class="proj-block-empty">' + esc(t.proj_empty || "—") + "</div>";
  if (sessions.length > 5) sessHtml += '<div class="dim" style="font-size:10px;padding:2px 0">+' + (sessions.length - 5) + " más</div>";

  // TASKS block
  var tasksHtml = tasks.slice(0, 6).map(function(task) {
    var cls = "task-mini " + (task.status === "done" ? "task-done" : task.status === "blocked" ? "task-blocked" : task.status === "open" ? "task-open" : "");
    var statusLabel = t["task_" + task.status] || task.status;
    return '<div class="' + cls.trim() + '">' +
      '<span class="' + taskStatusClass(task.status) + '" style="flex:none;font-size:10px">' + esc(statusLabel) + "</span>" +
      '<span class="task-mini-title">' + esc(task.title) + "</span>" +
      "</div>";
  }).join("");
  if (!tasksHtml) tasksHtml = '<div class="proj-block-empty">' + esc(t.proj_empty || "—") + "</div>";

  // MENTIONS block
  var mentionsHtml = mentions.slice(0, 4).map(function(m) {
    return '<div class="mention-mini">' +
      '<span class="mention-mini-author">' + esc(m.author || "") + "</span>" +
      '<span class="mention-mini-text">' + esc((m.text || "").slice(0, 60)) + "</span>" +
      "</div>";
  }).join("");
  if (!mentionsHtml) mentionsHtml = '<div class="proj-block-empty">' + esc(t.proj_empty || "—") + "</div>";

  // PRs block
  var prsHtml = prs.slice(0, 4).map(function(link) {
    var meta = {};
    try { meta = JSON.parse(link.meta || "{}"); } catch {}
    var rm = (link.ref || "").match(/^(.+)#(\d+)$/);
    var prNum = rm ? rm[2] : "";
    var label = link.title || link.ref;
    var href = (meta.fullRepo && prNum) ? "https://github.com/" + esc(meta.fullRepo) + "/pull/" + prNum : null;
    var stateBadge = meta.state === "OPEN" ? ' <span class="amber" style="font-size:10px">OPEN</span>' : meta.state ? ' <span class="dim" style="font-size:10px">' + esc(meta.state) + "</span>" : "";
    return '<div class="pr-mini">' + stateBadge +
      (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(label) + "</a>" : "<span>" + esc(label) + "</span>") +
      "</div>";
  }).join("");
  if (!prsHtml) prsHtml = '<div class="proj-block-empty">' + esc(t.proj_empty || "—") + "</div>";

  var detailEl = document.createElement("div");
  detailEl.className = "proj-detail";
  detailEl.innerHTML =
    '<div class="proj-grid">' +
      '<div class="proj-block proj-sessions">' +
        '<div class="proj-block-title">' + esc(t.proj_sessions_block || "Sesiones") + "</div>" +
        sessHtml +
      "</div>" +
      '<div class="proj-block proj-tasks">' +
        '<div class="proj-block-title">' + esc(t.proj_tasks_block || "Tareas") + "</div>" +
        tasksHtml +
      "</div>" +
      '<div class="proj-block proj-mentions">' +
        '<div class="proj-block-title">' + esc(t.proj_mentions_block || "Conversaciones") + "</div>" +
        mentionsHtml +
      "</div>" +
      '<div class="proj-block proj-prs">' +
        '<div class="proj-block-title">' + esc(t.proj_prs_block || "PRs & Linear") + "</div>" +
        prsHtml +
      "</div>" +
    "</div>";

  row.appendChild(detailEl);

  // Wire session mini clicks → detail panel
  detailEl.querySelectorAll(".sess-mini").forEach(function(el) {
    el.addEventListener("click", function(e) {
      e.stopPropagation();
      openDetail(el.dataset.sid);
    });
  });
}

// ── flat sessions view ────────────────────────────────────────────────────
function buildSessionRow(s) {
  var displayName = s.name || basename(s.cwd) || s.id;
  var dc = dotClass(s.status);
  var right = "";
  if (s.status === "waiting_input" && s.waiting_since) {
    var wm = Math.floor((Date.now() - s.waiting_since) / 60000);
    right = '<span class="amber">⏸ ' + wm + "m " + esc(t.waiting_you) + "</span>";
  } else if (s.status === "archived") {
    var dur = s.ended_at && s.started_at ? fmtDur(s.ended_at - s.started_at) : "";
    var reason = s.archived_reason ? esc(archiveReasonLabel(s.archived_reason)) : "";
    right = '<span class="dim">' + (reason ? reason + " · " : "") + esc(dur) + "</span>";
  } else {
    right = '<span class="dim">' + rel(s.last_activity) + "</span>";
  }
  var topicHtml = "";
  if (s.summary) {
    topicHtml = '<div class="topic">' + esc(s.summary.slice(0, 90)) + "</div>";
  } else if (s.last_prompt) {
    var dec = decodePrompt(s.last_prompt);
    var inner = dec.kind === "system"
      ? sysChip(dec.label, dec.text.slice(0, 90))
      : esc(s.last_prompt.slice(0, 90));
    topicHtml = '<div class="topic">' + inner + "</div>";
  }
  var kindBadge = s.kind === "worker"
    ? '<span class="badge-kind">' + esc(t.kind_worker || "worker") + "</span>" : "";
  return '<div class="row srow" data-id="' + esc(s.id) + '" tabindex="0">' +
    '<span class="dot ' + dc + '"></span>' +
    '<div class="srow-body">' +
      '<div class="srow-top">' +
        '<span class="name">' + esc(displayName) + "</span>" +
        '<span class="badge-instance tag">' + esc(s.instance || "") + "</span>" +
        kindBadge +
      "</div>" + topicHtml +
    "</div>" +
    '<div class="srow-right">' + right + "</div>" +
    "</div>";
}

function buildWorkersGroup(workers) {
  if (!workers.length) return "";
  var label = t.workers_group || "workers";
  return '<details class="workers-group"><summary>' + esc(label) + " (" + workers.length + ")</summary>" +
    workers.map(buildSessionRow).join("") + "</details>";
}

function renderSessionsView(active, archived) {
  var lblActive = document.getElementById("lbl-active");
  var lstActive = document.getElementById("sessions-list");
  var lblArch = document.getElementById("lbl-archived");
  var lstArch = document.getElementById("archived-list");
  if (!lstActive) return;

  var regular = active.filter(function(s) { return s.kind !== "worker"; });
  var workers = active.filter(function(s) { return s.kind === "worker"; });
  var archRegular = archived.filter(function(s) { return s.kind !== "worker"; });
  var archWorkers = archived.filter(function(s) { return s.kind === "worker"; });

  if (lblActive) lblActive.textContent = t.sessions + " · " + active.length + " " + t.active;
  lstActive.innerHTML = (regular.length
    ? regular.map(buildSessionRow).join("")
    : '<div class="row muted">' + esc(t.no_sessions) + "</div>") +
    buildWorkersGroup(workers);

  if (lblArch) lblArch.textContent = t.archived;
  if (lstArch) lstArch.innerHTML = archRegular.map(buildSessionRow).join("") + buildWorkersGroup(archWorkers);

  attachSrowHandlers(document.getElementById("sessions-view"));
}

function attachSrowHandlers(container) {
  (container || document).querySelectorAll(".srow").forEach(function(row) {
    row.addEventListener("click", function() { openDetail(row.dataset.id); });
    row.addEventListener("keydown", function(e) {
      if (e.key === "Enter" || e.key === " ") openDetail(row.dataset.id);
    });
  });
}

// ── search ────────────────────────────────────────────────────────────────
function buildSearchResultRow(r) {
  var s = r.session || {};
  var name = s.name || basename(s.cwd) || s.id;
  var chipKey = "match_" + r.matched_kind;
  var chip = '<span class="badge-sys">' + esc(t[chipKey] || r.matched_kind) + "</span>";
  var snippetHtml = r.snippet
    ? esc(r.snippet).replace(/\[([^\]]*)\]/g, function(_, w) { return "<mark>" + w + "</mark>"; })
    : "";
  var dc = dotClass(s.status);
  return '<div class="search-result-row" data-id="' + esc(s.id) + '">' +
    '<span class="dot ' + dc + '"></span>' +
    '<span class="search-result-proj">' + esc(name) + "</span>" +
    chip +
    '<span class="search-result-snippet">' + snippetHtml + "</span>" +
    "</div>";
}

function renderSearchResults(results) {
  inSearchMode = true;
  var projView = document.getElementById("projects-view");
  var sessView = document.getElementById("sessions-view");
  var container = viewMode === "sessions" ? sessView : projView;
  // show results in whichever container is active
  var existing = document.getElementById("search-results-panel");
  if (!existing) {
    existing = document.createElement("div");
    existing.id = "search-results-panel";
    (container || document.querySelector(".ledger") || document.body).prepend(existing);
  }
  if (projView) projView.style.display = "none";
  if (sessView) sessView.hidden = true;
  existing.style.display = "";
  if (results.length === 0) {
    existing.innerHTML = '<div class="row muted" style="padding:12px 14px">' + esc(t.no_sessions) + "</div>";
  } else {
    existing.innerHTML = results.map(buildSearchResultRow).join("");
    existing.querySelectorAll(".search-result-row").forEach(function(row) {
      row.addEventListener("click", function() { openDetail(row.dataset.id); });
    });
  }
}

function exitSearchMode() {
  if (!inSearchMode) return;
  inSearchMode = false;
  var sr = document.getElementById("search-results-panel");
  if (sr) { sr.style.display = "none"; }
  var projView = document.getElementById("projects-view");
  var sessView = document.getElementById("sessions-view");
  var convView = document.getElementById("conversations-view");
  var prsView2 = document.getElementById("prs-view");
  if (projView) projView.style.display = viewMode === "projects" ? "" : "none";
  if (sessView) sessView.hidden = viewMode !== "sessions";
  if (convView) convView.hidden = viewMode !== "conversations";
  if (prsView2) prsView2.hidden = viewMode !== "prs";
}

// ── view switching ────────────────────────────────────────────────────────
function switchToView(mode) {
  viewMode = mode;
  var projView = document.getElementById("projects-view");
  var sessView = document.getElementById("sessions-view");
  var convView = document.getElementById("conversations-view");
  var prsView = document.getElementById("prs-view");
  var sessChip = document.getElementById("sessions-chip");
  var convChip = document.getElementById("conversations-chip");
  var prsChip = document.getElementById("prs-chip");
  if (projView) projView.style.display = mode === "projects" ? "" : "none";
  if (sessView) sessView.hidden = mode !== "sessions";
  if (convView) convView.hidden = mode !== "conversations";
  if (prsView) prsView.hidden = mode !== "prs";
  if (sessChip) sessChip.classList.toggle("active", mode === "sessions");
  if (convChip) convChip.classList.toggle("active", mode === "conversations");
  if (prsChip) prsChip.classList.toggle("active", mode === "prs");
  if (mode === "sessions") {
    renderSessionsView(_lastSessions.active, _lastSessions.archived);
  }
  if (mode === "conversations") {
    fetchAndRenderConversations();
  }
  if (mode === "prs") {
    fetchAndRenderPRs();
  }
}

// ── conversations strip ───────────────────────────────────────────────────
function updateConversationsChip(conversations) {
  var chip = document.getElementById("conversations-chip");
  if (!chip) return;
  if (!conversations) {
    chip.textContent = "@ " + (t.strip_conversations || "Conversaciones");
    return;
  }
  var total = conversations.length;
  var openCount = conversations.filter(function(c) { return c.resolved_eff === 0; }).length;
  chip.textContent = "@ " + total + " · " + openCount + " " + (t.conv_open || "abierta");
}

function fetchAndRenderConversations() {
  var view = document.getElementById("conversations-view");
  if (!view) return;
  view.innerHTML = '<div class="dim" style="padding:8px 14px;font-size:12px">cargando…</div>';
  fetch("/api/conversations")
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data) return;
      _lastConversations = data.conversations || [];
      updateConversationsChip(_lastConversations);
      renderConversationsList(view, _lastConversations);
    })
    .catch(function() {
      if (view) view.innerHTML = '<div class="dim" style="padding:8px 14px">error</div>';
    });
}

function renderConversationsList(container, conversations) {
  var all = conversations || [];
  var filterRow = buildConversationsFilterRow(_convFilter);

  // Apply active filter
  var filtered;
  if (_convFilter === "open") {
    filtered = all.filter(function(c) { return c.resolved_eff === 0; });
  } else if (_convFilter === "resolved") {
    filtered = all.filter(function(c) { return c.resolved_eff === 1; });
  } else {
    filtered = all;
  }

  if (filtered.length === 0) {
    var emptyHtml = '<div class="dim" style="padding:8px 14px;font-size:12px">—</div>';
    if (_convFilter === "open" && all.some(function(c) { return c.resolved_eff === 1; })) {
      emptyHtml += '<div class="dim" style="padding:2px 14px;font-size:11px">' +
        esc(t.conv_all_resolved || "Todo respondido") + "</div>";
    }
    container.innerHTML = filterRow + emptyHtml;
    wireConversationsFilter(container, all);
    return;
  }

  // Sort: open first, then resolved; within each group by last_at DESC
  var sorted = filtered.slice().sort(function(a, b) {
    if (a.resolved_eff !== b.resolved_eff) return a.resolved_eff - b.resolved_eff;
    return (b.last_at || 0) - (a.last_at || 0);
  });

  container.innerHTML = filterRow + sorted.map(function(c) {
    var excerpt = esc((c.text || "").slice(0, 120));
    var age = c.last_at ? '<span class="dim">' + rel(c.last_at) + "</span>" : "";
    var proj = c.project_key
      ? '<span class="badge-sys">' + esc(c.project_key) + "</span>"
      : '<span class="dim">' + esc(t.conv_no_project || "sin proyecto") + "</span>";
    var statusBadge = c.resolved_eff === 0
      ? '<span class="amber" style="font-size:10px">' + esc(t.conv_open || "abierta") + "</span>"
      : '<span class="dim" style="font-size:10px">' + esc(t.conv_resolved || "respondida") + "</span>";
    var resolveBtn = c.resolved_eff === 0
      ? '<button class="sbtn-clear conv-resolve-btn" data-id="' + c.id + '" style="font-size:10px;padding:1px 6px">' + esc(t.conv_mark_resolved || "marcar respondida") + "</button>"
      : "";
    return '<div class="frow conv-row" style="align-items:flex-start;padding:6px 14px;gap:6px;border-bottom:1px solid var(--border,#21262d)">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">' +
          '<span class="amber" style="font-size:11px">' + esc(c.author || "") + "</span>" +
          proj + statusBadge + age +
        "</div>" +
        '<div class="muted" style="font-size:11px;overflow:hidden;text-overflow:ellipsis">' + excerpt + "</div>" +
      "</div>" +
      (resolveBtn ? '<div style="flex:none">' + resolveBtn + "</div>" : "") +
    "</div>";
  }).join("");

  // Wire filter chips
  wireConversationsFilter(container, all);

  // Wire resolve buttons
  container.querySelectorAll(".conv-resolve-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      var id = btn.dataset.id;
      btn.disabled = true;
      fetch("/api/mentions/" + id + "/resolve", { method: "POST" })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function() {
          fetchAndRenderConversations();
        })
        .catch(function() { btn.disabled = false; });
    });
  });
}

function wireConversationsFilter(container, allConversations) {
  container.querySelectorAll("[data-conv-filter]").forEach(function(chip) {
    chip.addEventListener("click", function() {
      _convFilter = chip.dataset.convFilter;
      renderConversationsList(container, _lastConversations || allConversations);
    });
  });
}

function openConversationsView() {
  switchToView("conversations");
}

// ── PRs strip ─────────────────────────────────────────────────────────────
var PR_BUCKET_LABELS = {
  needs_my_review:      function() { return t.pr_needs_my_review      || "To review"; },
  changes_requested:    function() { return t.pr_changes_requested    || "Changes requested"; },
  commented_unanswered: function() { return t.pr_commented_unanswered || "Commented, unanswered"; },
  mine_mergeable:       function() { return t.pr_mine_mergeable       || "Mine, mergeable"; },
  mine_blocked:         function() { return t.pr_mine_blocked         || "Mine, not mergeable"; },
  reviewed_by_me:       function() { return t.pr_reviewed_by_me       || "Reviewed"; },
};
var PR_BUCKET_ORDER = ["needs_my_review","changes_requested","mine_mergeable","mine_blocked","commented_unanswered","reviewed_by_me"];
var PR_ACTIONABLE = new Set(["needs_my_review","changes_requested","commented_unanswered"]);

var PR_BUCKET_COLORS = {
  needs_my_review:      "amber",
  changes_requested:    "red",
  commented_unanswered: "amber",
  mine_mergeable:       "green",
  mine_blocked:         "dim",
  reviewed_by_me:       "dim",
};

function updatePRsChip(prsData) {
  var chip = document.getElementById("prs-chip");
  if (!chip) return;
  if (!prsData) { chip.textContent = "⑃ " + (t.strip_prs || "PRs"); return; }
  var total = (prsData.prs || []).length;
  var actionable = (prsData.prs || []).filter(function(p) { return PR_ACTIONABLE.has(p.bucket); }).length;
  chip.textContent = "⑃ " + (t.strip_prs || "PRs") + " " + total + (actionable > 0 ? " · " + actionable + " !" : "");
}

function buildPRsFilterRow(activeFilter) {
  var segments = [
    { key: "actionable", label: t.pr_filter_actionable || "Pending" },
    { key: "all",        label: t.pr_filter_all        || "All"     },
  ].concat(PR_BUCKET_ORDER.map(function(b) {
    return { key: b, label: PR_BUCKET_LABELS[b]() };
  }));
  var chips = segments.map(function(seg) {
    return '<span class="ev-chip' + (activeFilter === seg.key ? " active" : "") +
      '" data-pr-filter="' + esc(seg.key) + '">' + esc(seg.label) + "</span>";
  }).join("");
  return '<div class="ev-filter-row" style="flex-wrap:wrap">' + chips + "</div>";
}

function renderPRsList(container, prsData, filter) {
  var all = (prsData && prsData.prs) ? prsData.prs : [];
  var filterRow = buildPRsFilterRow(filter);

  var filtered;
  if (filter === "actionable") {
    filtered = all.filter(function(p) { return PR_ACTIONABLE.has(p.bucket); });
  } else if (filter === "all") {
    filtered = all;
  } else {
    filtered = all.filter(function(p) { return p.bucket === filter; });
  }

  if (filtered.length === 0) {
    container.innerHTML = filterRow + '<div class="dim" style="padding:8px 14px;font-size:12px">—</div>';
    wirePRsFilter(container, prsData);
    return;
  }

  // Group by bucket in order
  var grouped = {};
  PR_BUCKET_ORDER.forEach(function(b) { grouped[b] = []; });
  filtered.forEach(function(p) { if (grouped[p.bucket]) grouped[p.bucket].push(p); });

  var rows = "";
  PR_BUCKET_ORDER.forEach(function(b) {
    var grp = grouped[b];
    if (!grp.length) return;
    var color = PR_BUCKET_COLORS[b] || "dim";
    rows += '<div style="padding:4px 14px 2px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em" class="' + esc(color) + '">' + esc(PR_BUCKET_LABELS[b]()) + '</div>';
    grp.forEach(function(pr) {
      var repoNum = '<span style="font-family:monospace;font-size:11px">' + esc((pr.repo || "").split("/").pop() + "#" + pr.number) + "</span>";
      var title = esc((pr.title || "").slice(0, 90));
      var author = pr.author ? '<span class="dim" style="font-size:10px">' + esc(pr.author) + "</span>" : "";
      var checksBadge = pr.checks === "success" ? '<span class="green" style="font-size:9px">✓ CI</span>'
        : pr.checks === "failing" ? '<span class="red" style="font-size:9px">✗ CI</span>'
        : pr.checks === "pending" ? '<span class="amber" style="font-size:9px">⏳ CI</span>' : "";
      var draftBadge = pr.is_draft ? '<span class="dim" style="font-size:9px">draft</span>' : "";
      var bucketChip = '<span class="' + esc(color) + '" style="font-size:9px;padding:1px 4px;border:1px solid currentColor;border-radius:3px">' + esc(PR_BUCKET_LABELS[b]()) + "</span>";
      var age = pr.updated_at ? '<span class="dim" style="font-size:10px">' + esc(rel(new Date(pr.updated_at).getTime())) + "</span>" : "";
      rows += '<div class="frow" style="align-items:flex-start;padding:5px 14px;gap:6px;border-bottom:1px solid var(--border,#21262d);cursor:pointer" data-url="' + esc(pr.url || "") + '">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px;flex-wrap:wrap">' +
            repoNum + ' <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + title + "</span>" +
          "</div>" +
          '<div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">' +
            author + bucketChip + draftBadge + checksBadge + age +
          "</div>" +
        "</div>" +
      "</div>";
    });
  });

  container.innerHTML = filterRow + rows;
  wirePRsFilter(container, prsData);

  // Wire click-through for PR rows
  container.querySelectorAll("[data-url]").forEach(function(el) {
    el.addEventListener("click", function() {
      var url = el.dataset.url;
      if (url) window.open(url, "_blank", "noopener");
    });
  });
}

function wirePRsFilter(container, prsData) {
  container.querySelectorAll("[data-pr-filter]").forEach(function(chip) {
    chip.addEventListener("click", function() {
      _prFilter = chip.dataset.prFilter;
      renderPRsList(container, prsData || _lastPRs, _prFilter);
    });
  });
}

function fetchAndRenderPRs() {
  var view = document.getElementById("prs-view");
  if (!view) return;
  view.innerHTML = '<div class="dim" style="padding:8px 14px;font-size:12px">cargando…</div>';
  fetch("/api/prs")
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data) return;
      _lastPRs = data;
      updatePRsChip(data);
      renderPRsList(view, data, _prFilter);
    })
    .catch(function() {
      if (view) view.innerHTML = '<div class="dim" style="padding:8px 14px">error</div>';
    });
}

function openPRsView() {
  switchToView("prs");
}

// ── detail panel ──────────────────────────────────────────────────────────
function buildSection(label, hint, bodyHtml, open) {
  return '<details class="dsec"' + (open ? " open" : "") + ">" +
    "<summary>" +
      '<span class="arr">▶</span>' +
      '<span class="lbl">' + esc(label) + "</span>" +
      '<span class="hint">' + esc(hint) + "</span>" +
    "</summary>" +
    '<div class="body">' + bodyHtml + "</div>" +
    "</details>";
}

function buildTasksBody(tasks) {
  if (!tasks || tasks.length === 0) return '<div class="dim">—</div>';
  return tasks.map(function(task, idx) {
    var cls = taskStatusClass(task.status);
    var label = t["task_" + task.status] || task.status;
    var age = task.opened_at ? rel(task.opened_at) : "";
    var rowHtml = '<div class="frow task-row" data-task-idx="' + idx + '" style="cursor:pointer">' +
      '<span class="' + esc(cls) + '">' + esc(label) + "</span>" +
      '<span style="flex:1;padding:0 8px;overflow:hidden;text-overflow:ellipsis">' +
        '<span class="task-caret dim" style="margin-right:4px;font-size:10px">▶</span>' +
        esc(task.title) +
      "</span>" +
      '<span class="dim">' + esc(t.opened_ago || "abierta") + " " + esc(age) + "</span>" +
      "</div>";
    var lines = [];
    if (task.context) lines.push('<span class="dim" style="font-style:italic">' + esc(task.context) + "</span>");
    if (task.blocked_on) {
      var blockLabel = task.status === "delegated" ? (t.task_delegated_to || "delegada a") : (t.task_blocked_by || "bloqueada por");
      lines.push('<span class="dim">' + esc(blockLabel) + ": </span><span>" + esc(task.blocked_on) + "</span>");
    }
    if (task.opened_at) lines.push('<span class="dim">' + esc(t.task_opened_at || "abierta") + ": " + esc(rel(task.opened_at)) + " (" + esc(fmtAbsDateTime(task.opened_at)) + ")</span>");
    if (task.closed_at && task.status === "done") lines.push('<span class="dim">' + esc(t.task_closed_at || "cerrada") + ": " + esc(rel(task.closed_at)) + " (" + esc(fmtAbsDateTime(task.closed_at)) + ")</span>");
    return rowHtml + '<div class="task-expanded" data-task-idx="' + idx + '" hidden style="padding:4px 8px 6px 32px;font-size:12px;line-height:1.8;border-bottom:1px solid #21262d">' +
      (lines.length ? lines.join("<br>") : '<span class="dim">—</span>') + "</div>";
  }).join("");
}

function openDetail(id) {
  if (!id) return;
  openId = id;
  var detail = document.getElementById("detail");
  detail.removeAttribute("hidden");
  fetch("/api/sessions/" + id)
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) { if (data) renderDetail(data); })
    .catch(function() {});
}

function renderDetail(data) {
  var session = data.session || {};
  var files = data.files || [];
  var events = data.events || [];
  var tasks = data.tasks || [];
  var links = data.links || [];
  var prLinks = links.filter(function(l) { return l.kind === "pr"; });
  var linearLinks = links.filter(function(l) { return l.kind === "linear"; });
  var artifactLinks = links.filter(function(l) { return l.kind === "artifact"; });

  var displayName = session.name || basename(session.cwd) || session.id;
  var titleEl = document.querySelector("#detail .d-title");
  if (titleEl) titleEl.textContent = displayName;

  var dur = session.started_at ? fmtDur(Date.now() - session.started_at) : "";
  var startedStr = fmtTime(session.started_at);
  var statusLine = "";
  if (session.status === "waiting_input") {
    statusLine = '<div class="amber">● ' + esc(t.waiting_you) + " · " + esc(dur) + " · " + esc(t.started) + " " + esc(startedStr) + "</div>";
  } else if (session.status === "running") {
    statusLine = '<div class="green">● ' + esc(t.running) + " · " + esc(dur) + " · " + esc(t.started) + " " + esc(startedStr) + "</div>";
  } else if (session.status === "idle") {
    statusLine = '<div class="muted">● ' + esc(t.idle) + " · " + esc(dur) + " · " + esc(t.started) + " " + esc(startedStr) + "</div>";
  } else {
    var endedStr = fmtTime(session.ended_at);
    var totalDur = session.ended_at && session.started_at ? fmtDur(session.ended_at - session.started_at) : "";
    statusLine = '<div class="dim">● ' + esc(t.ended) + " " + esc(endedStr) + " · " + esc(archiveReasonLabel(session.archived_reason)) + " · " + esc(totalDur) + "</div>";
  }

  var resumen = "";
  if (session.summary) {
    resumen = '<div class="muted" style="margin:10px 0;line-height:1.7">' + esc(session.summary) + "</div>";
    if (session.summary_next) resumen += '<div class="amber" style="margin:4px 0;line-height:1.7">→ ' + esc(session.summary_next) + "</div>";
  } else if (session.last_prompt) {
    var rdec = decodePrompt(session.last_prompt);
    resumen = '<div class="muted" style="margin:10px 0;line-height:1.7">' +
      (rdec.kind === "system" ? sysChip(rdec.label, rdec.text) : esc(session.last_prompt)) + "</div>";
  }
  if (!session.summary) {
    resumen += '<button class="sbtn-clear" id="d-gen-summary" data-id="' + esc(session.id) + '" style="margin:4px 0">' + esc(t.summary_generate || "generar resumen") + "</button>";
  }

  var metaLine = '<div class="detail-meta"><span class="badge-instance tag">' + esc(session.instance || "") + '</span> <span class="muted">' + esc(session.cwd || "") + "</span></div>";

  // Files (unified: files + local artifacts)
  var localArtifactLinks = artifactLinks.filter(function(l) { return !l.url; });
  var externalArtifactLinks = artifactLinks.filter(function(l) { return !!l.url; });
  var artifactPathSet = new Set(localArtifactLinks.map(function(l) { return l.ref; }));
  var filePathSet = new Set(files.map(function(f) { return f.path; }));
  var allLocalItems = files.map(function(f) { return { path: f.path, change_kind: f.change_kind, ts: f.ts, isArtifact: artifactPathSet.has(f.path) }; });
  localArtifactLinks.forEach(function(l) {
    if (!filePathSet.has(l.ref)) allLocalItems.push({ path: l.ref, change_kind: null, ts: null, isArtifact: true });
  });
  var totalItems = allLocalItems.length + externalArtifactLinks.length;
  var filesHint = totalItems ? totalItems + " " + t.files : "0";
  var session_cwd = session.cwd || "";
  var groups = new Map();
  allLocalItems.forEach(function(f) {
    var g = fileGroup(f.path, session_cwd);
    if (!groups.has(g.dir)) groups.set(g.dir, { label: g.label, files: [] });
    groups.get(g.dir).files.push(f);
  });
  var groupCount = groups.size + (externalArtifactLinks.length > 0 ? 1 : 0);
  var filesBody = "";
  if (totalItems === 0) {
    filesBody = '<div class="dim">—</div>';
  } else {
    groups.forEach(function(grp) {
      var openAttr = groupCount <= 3 ? " open" : "";
      filesBody += '<details class="fgroup"' + openAttr + '><summary class="fgroup-summary">' +
        '<span class="fgroup-dir">' + esc(grp.label) + '</span><span class="dim"> (' + grp.files.length + ')</span></summary>';
      grp.files.forEach(function(f) {
        var bn = basename(f.path);
        var artBadge = f.isArtifact ? ' <span class="badge-sys" title="' + esc(t.files_artifact_badge || "artifact") + '">★</span>' : "";
        var actionHtml = f.change_kind != null ? '<span class="badge-sys file-action">' + esc(f.change_kind) + "</span>" : "";
        var ageHtml = f.ts != null ? '<span class="dim">' + rel(f.ts) + "</span>" : "";
        filesBody += '<div class="frow file-row" data-path="' + esc(f.path) + '" data-sid="' + esc(session.id) + '" style="cursor:pointer">' +
          '<span class="file-bn">' + esc(bn) + "</span>" + artBadge + actionHtml + ageHtml +
          "</div>" +
          '<div class="file-preview" data-path="' + esc(f.path) + '" hidden title="' + esc(f.path) + '"></div>';
      });
      filesBody += "</details>";
    });
    if (externalArtifactLinks.length > 0) {
      var extOpenAttr = groupCount <= 3 ? " open" : "";
      filesBody += '<details class="fgroup"' + extOpenAttr + '><summary class="fgroup-summary"><span class="fgroup-dir">↗ ' + esc(t.files_artifact_badge || "artifact") + '</span><span class="dim"> (' + externalArtifactLinks.length + ')</span></summary>';
      externalArtifactLinks.forEach(function(link) {
        var label = esc(link.title && link.title !== "Artifact" ? link.title : (basename(link.url) || "Artifact"));
        filesBody += '<div class="frow"><a href="' + esc(link.url) + '" target="_blank" rel="noopener" style="flex:1;overflow:hidden;text-overflow:ellipsis">↗ ' + label + "</a>" +
          '<span class="badge-sys" title="' + esc(t.files_artifact_badge || "artifact") + '">★</span></div>';
      });
      filesBody += "</details>";
    }
  }

  // Events
  var lastEvent = events[0];
  var eventsHint = lastEvent ? fmtTime(lastEvent.ts) : "";
  var presentEvKinds = [];
  events.forEach(function(e) { if (presentEvKinds.indexOf(e.kind) === -1) presentEvKinds.push(e.kind); });
  var savedEvFilter = [];
  try { var storedEv = localStorage.getItem("cl-events-filter"); if (storedEv) savedEvFilter = JSON.parse(storedEv); } catch {}
  var activeEvKinds = new Set(Array.isArray(savedEvFilter) ? savedEvFilter : []);
  var eventsRows = events.length
    ? events.map(function(e) {
        var meta = eventMeta(e.kind), detailHtml;
        if (e.kind === "prompt" && e.detail) {
          var edec = decodePrompt(e.detail);
          detailHtml = edec.kind === "system"
            ? '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + sysChip(edec.label, edec.text) + "</span>"
            : '<span class="muted" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + esc(e.detail) + "</span>";
        } else {
          detailHtml = '<span class="muted" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">' + esc(e.detail || "") + "</span>";
        }
        return '<div class="frow" data-kind="' + esc(e.kind) + '">' +
          '<span class="dim">' + esc(fmtTime(e.ts)) + "</span>" +
          '<span class="ev-kind" style="color:' + meta.color + '">' + meta.icon + " " + esc(e.kind) + "</span>" +
          detailHtml + "</div>";
      }).join("")
    : "";
  var eventsBody = events.length
    ? buildEventsFilterRow(presentEvKinds, activeEvKinds) + eventsRows
    : '<div class="dim">—</div>';

  var tasksBody = buildTasksBody(tasks);
  var tasksHint = tasks.filter(function(task) { return task.status !== "done"; }).length + " " + (t.task_open || "open");

  // Slack linked mentions
  var slackMentions = data.mentions || [];
  var slackSection = "";
  if (slackMentions.length > 0) {
    var smBody = slackMentions.map(function(m) {
      var excerpt = esc((m.text || "").slice(0, 120));
      var parts = []; try { parts = JSON.parse(m.participants || "[]"); } catch {}
      var reask = m.ask_count > 1 ? ' <span class="badge-sys">×' + m.ask_count + "</span>" : "";
      var age = m.last_at ? ' <span class="dim">' + rel(m.last_at) + "</span>" : "";
      return '<div class="frow"><span class="amber">' + esc(m.author || "") + "</span>" +
        '<span style="flex:1;padding:0 6px;overflow:hidden;text-overflow:ellipsis">' + excerpt + "</span>" +
        reask + age + "</div>";
    }).join("");
    slackSection = buildSection("Slack ligado", slackMentions.length + "", smBody, true);
  }

  // PR links
  var prSection = "";
  if (prLinks.length) {
    var prBody = prLinks.map(function(link) {
      var rm = link.ref.match(/^(.+)#(\d+)$/);
      var prNum = rm ? rm[2] : "";
      var meta = {}; try { meta = JSON.parse(link.meta || "{}"); } catch {}
      var stateBadge = meta.state === "OPEN" ? '<span class="amber">' + esc(meta.state) + "</span> "
        : meta.state ? '<span class="dim">' + esc(meta.state) + "</span> " : "";
      var checksBadge = "";
      if (Array.isArray(meta.checks) && meta.checks.length > 0) {
        var hasFailure = meta.checks.some(function(c) { return c.conclusion === "FAILURE"; });
        checksBadge = hasFailure ? ' <span class="red">checks fail</span>' : ' <span class="green">checks ok</span>';
      }
      var label = esc(link.title || link.ref);
      var href = (meta.fullRepo && prNum) ? "https://github.com/" + esc(meta.fullRepo) + "/pull/" + esc(prNum) : null;
      return '<div class="frow">' + stateBadge + checksBadge +
        '<span style="flex:1;padding:0 6px;overflow:hidden;text-overflow:ellipsis">' +
        (href ? '<a href="' + href + '" target="_blank" rel="noopener">' + label + "</a>" : label) +
        "</span></div>";
    }).join("");
    prSection = buildSection(t.links_repos || "Repos & PRs", prLinks.length + "", prBody, false);
  }

  var linearSection = "";
  if (linearLinks.length) {
    var linBody = linearLinks.map(function(link) {
      var label = link.title ? esc(link.ref) + " — " + esc(link.title) : esc(link.ref);
      return '<div class="frow"><span style="flex:1;padding:0 6px;overflow:hidden;text-overflow:ellipsis">' +
        '<a href="https://linear.app/issue/' + esc(link.ref) + '" target="_blank" rel="noopener">' + label + "</a></span></div>";
    }).join("");
    linearSection = buildSection(t.links_linear || "Linear", linearLinks.length + "", linBody, false);
  }

  var body = document.getElementById("d-body");
  if (!body) return;
  body.innerHTML = statusLine + resumen + metaLine +
    (tasks.length ? buildSection(t.tasks_section || "Tareas", tasksHint, tasksBody, true) : "") +
    slackSection +
    (prLinks.length ? prSection : "") +
    (linearLinks.length ? linearSection : "") +
    buildSection(t.files, filesHint, filesBody, false) +
    buildSection(t.events, eventsHint, eventsBody, true);

  // Wire gen-summary button
  var genBtn = body.querySelector("#d-gen-summary");
  if (genBtn) {
    genBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      genBtn.disabled = true; genBtn.textContent = "…";
      fetch("/api/sessions/" + encodeURIComponent(genBtn.dataset.id) + "/summarize", { method: "POST" })
        .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function() { openDetail(genBtn.dataset.id); })
        .catch(function() { genBtn.disabled = false; genBtn.textContent = t.summary_generate || "generar resumen"; });
    });
  }

  // Wire file preview
  body.querySelectorAll(".file-row").forEach(function(row) {
    row.addEventListener("click", function(e) {
      e.stopPropagation();
      var path = row.dataset.path, sid = row.dataset.sid;
      var previewEl = row.nextElementSibling;
      if (!previewEl || !previewEl.classList.contains("file-preview")) return;
      if (!previewEl.hidden) { previewEl.hidden = true; return; }
      previewEl.textContent = "…"; previewEl.hidden = false;
      var url = "/api/sessions/" + encodeURIComponent(sid) + "/file?path=" + encodeURIComponent(path);
      fetch(url).then(function(r) {
        if (!r.ok) {
          return r.json().then(function(data) {
            var key = data.error === "too_large" ? "preview_too_large" : data.error === "missing" ? "preview_missing" : data.error === "binary" ? "preview_binary" : null;
            previewEl.innerHTML = '<span class="dim">' + esc(key ? (t[key] || data.error) : String(data.error || "")) + "</span>";
          });
        }
        var ct = r.headers.get("content-type") || "";
        if (ct.startsWith("image/")) {
          var img = document.createElement("img"); img.src = url; img.className = "file-img";
          previewEl.innerHTML = ""; previewEl.appendChild(img); return;
        }
        return r.text().then(function(text) {
          previewEl.innerHTML = "";
          if (path.toLowerCase().endsWith(".md")) {
            var div = document.createElement("div"); div.className = "md-preview";
            div.innerHTML = mdToSafeHtml(esc(text)); previewEl.appendChild(div);
          } else {
            var pre = document.createElement("pre"); pre.className = "file-pre";
            pre.textContent = text; previewEl.appendChild(pre);
          }
        });
      }).catch(function() { previewEl.innerHTML = '<span class="dim">' + esc(t.preview_error || "error") + "</span>"; });
    });
  });

  // Wire task accordion
  body.querySelectorAll(".task-row").forEach(function(taskRow) {
    taskRow.addEventListener("click", function(e) {
      e.stopPropagation();
      var idx = taskRow.dataset.taskIdx;
      var expanded = body.querySelector('.task-expanded[data-task-idx="' + idx + '"]');
      if (!expanded) return;
      expanded.hidden = !expanded.hidden;
      var caret = taskRow.querySelector(".task-caret");
      if (caret) caret.textContent = expanded.hidden ? "▶" : "▼";
    });
  });

  // Wire event filter
  (function() {
    var filterBar = body.querySelector(".ev-filter-row");
    if (!filterBar) return;
    function applyEvFilter() {
      var isAll = activeEvKinds.size === 0;
      body.querySelectorAll(".frow[data-kind]").forEach(function(r) {
        r.style.display = isAll || activeEvKinds.has(r.dataset.kind) ? "" : "none";
      });
      filterBar.querySelectorAll(".ev-chip").forEach(function(chip) {
        var k = chip.dataset.kind, on;
        if (k === "all") on = isAll;
        else if (k === "__solo_prompts__") on = activeEvKinds.size === 1 && activeEvKinds.has("prompt");
        else on = isAll || activeEvKinds.has(k);
        chip.classList.toggle("active", on);
      });
    }
    applyEvFilter();
    filterBar.querySelectorAll(".ev-chip").forEach(function(chip) {
      chip.addEventListener("click", function() {
        var k = chip.dataset.kind;
        if (k === "all") { activeEvKinds = new Set(); }
        else if (k === "__solo_prompts__") {
          activeEvKinds = (activeEvKinds.size === 1 && activeEvKinds.has("prompt")) ? new Set() : new Set(["prompt"]);
        } else {
          if (activeEvKinds.has(k)) { activeEvKinds.delete(k); }
          else {
            activeEvKinds.add(k);
            if (presentEvKinds.every(function(pk) { return activeEvKinds.has(pk); })) activeEvKinds = new Set();
          }
        }
        if (activeEvKinds.size === 0) localStorage.removeItem("cl-events-filter");
        else localStorage.setItem("cl-events-filter", JSON.stringify(Array.from(activeEvKinds)));
        applyEvFilter();
      });
    });
  })();
}

function closeDetail() {
  openId = null;
  var detail = document.getElementById("detail");
  if (detail) detail.setAttribute("hidden", "");
}

// ── daily slide-over ──────────────────────────────────────────────────────
function fmtDailyDate(dateStr) {
  var parts = (dateStr || "").split("-");
  if (parts.length !== 3) return dateStr || "";
  var months = {
    es: ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"],
    en: ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"],
    pt: ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"],
  };
  var month = parseInt(parts[1], 10) - 1, day = parseInt(parts[2], 10);
  var mnames = months[lang] || months.es;
  return day + " " + (mnames[month] || parts[1]);
}

function renderMdBullets(md) {
  if (!md || !md.trim()) return '<span class="muted">' + esc(t.daily_empty || "—") + "</span>";
  var items = md.split("\n").map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; })
    .map(function(l) { return "<li>" + esc(l.startsWith("- ") ? l.slice(2) : l) + "</li>"; });
  if (!items.length) return '<span class="muted">' + esc(t.daily_empty || "—") + "</span>";
  return '<ul class="daily-bullets">' + items.join("") + "</ul>";
}

function getDailyLang() {
  var stored = localStorage.getItem("cl-daily-lang");
  if (stored === "es" || stored === "en") return stored;
  return (lang === "es" || lang === "en") ? lang : "es";
}

function buildSlackMrkdwn(daily, dlang) {
  var t2 = I18N[dlang] || I18N.es;
  var sections = [
    { label: t2.daily_yesterday || "Ayer", md: dlang === "en" ? (daily.yesterday_md_en || daily.yesterday_md) : daily.yesterday_md },
    { label: t2.daily_today || "Hoy", md: dlang === "en" ? (daily.today_md_en || daily.today_md) : daily.today_md },
    { label: t2.daily_blockers || "Bloqueos", md: dlang === "en" ? (daily.blockers_md_en || daily.blockers_md) : daily.blockers_md },
  ];
  function fmtSlackDate(dateStr) {
    var parts = (dateStr || "").split("-"); if (parts.length !== 3) return dateStr || "";
    var month = parseInt(parts[1], 10) - 1, day = parseInt(parts[2], 10);
    if (isNaN(month) || month < 0 || month > 11) return dateStr || "";
    var enM = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var esM = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    var ptM = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
    if (dlang === "en") return (enM[month] || "") + " " + day;
    return day + " " + ((dlang === "pt" ? ptM : esM)[month] || "");
  }
  var parts = ["📋 Daily · " + fmtSlackDate(daily.date), ""], first = true;
  sections.forEach(function(sec) {
    var bullets = (sec.md || "").split("\n").map(function(l) { return l.trim(); }).filter(Boolean)
      .map(function(l) { return l.startsWith("- ") ? l.slice(2) : l; }).filter(Boolean);
    if (!bullets.length) return;
    if (!first) parts.push(""); first = false;
    parts.push(sec.label); bullets.forEach(function(b) { parts.push("• " + b); });
  });
  return parts.join("\n");
}

function renderDaily(daily) {
  _lastDailyData = daily;
  var card = document.getElementById("daily-card");
  if (!card) return;
  if (!daily || !daily.date) { return; }
  dailyLang = getDailyLang();

  function getField(esField, enField) {
    if (dailyLang === "en") { var v = daily[enField]; return (v !== null && v !== undefined && v !== "") ? v : daily[esField]; }
    return daily[esField];
  }

  var sections = [
    { color: "#3fb950", icon: "✓", label: t.daily_yesterday || "Ayer", desc: t.day_yesterday_desc || "lo que avancé", md: getField("yesterday_md", "yesterday_md_en") },
    { color: "#58a6ff", icon: "→", label: t.daily_today || "Hoy", desc: t.day_today_desc || "lo que sigue", md: getField("today_md", "today_md_en") },
    { color: "#d29922", icon: "⚠", label: t.daily_blockers || "Bloqueos", desc: t.day_blockers_desc || "lo que me traba", md: getField("blockers_md", "blockers_md_en") },
  ];

  var body2 = sections.map(function(sec) {
    return '<div class="daily-section" style="border-left-color:' + sec.color + ';padding-left:10px;margin:8px 0;">' +
      '<div class="daily-sublbl">' +
        '<span style="color:' + sec.color + '">' + sec.icon + "</span>" +
        '<span style="color:' + sec.color + ';font-size:10px;letter-spacing:.10em;text-transform:uppercase;">' + esc(sec.label) + "</span>" +
        '<span class="daily-lbl-desc">' + esc(sec.desc) + "</span>" +
      "</div>" + renderMdBullets(sec.md) + "</div>";
  }).join("");

  var fmtDate = fmtDailyDate(daily.date);
  card.innerHTML =
    '<div class="daily-head">' +
      '<strong style="color:#e6edf3">📋 DAILY</strong>' +
      '<span class="dim" style="font-size:11px"> · ' + esc(fmtDate) + "</span>" +
      '<span class="daily-lang-toggle">' +
        '<button class="daily-lang-btn' + (dailyLang === "es" ? " active-lang" : "") + '" data-lang="es">' + esc(t.daily_lang_es || "ES") + "</button>" +
        '<button class="daily-lang-btn' + (dailyLang === "en" ? " active-lang" : "") + '" data-lang="en">' + esc(t.daily_lang_en || "EN") + "</button>" +
      "</span>" +
      '<button class="daily-slack-copy" title="' + esc(t.daily_copy_slack || "copy for Slack") + '">📋 Slack</button>' +
      '<button class="daily-regen" title="' + esc(t.daily_regenerate || "Regenerar") + '">↻</button>' +
    "</div>" +
    body2;

  card.querySelectorAll(".daily-lang-btn").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      localStorage.setItem("cl-daily-lang", btn.getAttribute("data-lang"));
      dailyLang = btn.getAttribute("data-lang");
      renderDaily(daily);
    });
  });
  var copyBtn = card.querySelector(".daily-slack-copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      var mrkdwn = buildSlackMrkdwn(daily, dailyLang);
      navigator.clipboard.writeText(mrkdwn).then(function() { showToast(t.resume_copied || "copiado"); }).catch(function() { showToast(t.resume_failed || "error"); });
    });
  }
  var regenBtn = card.querySelector(".daily-regen");
  if (regenBtn) {
    regenBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      fetch("/api/daily/regenerate?force=1", { method: "POST" })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data2) { if (data2 && data2.date) renderDaily(data2); })
        .catch(function() {});
    });
  }
}

function openDailyOverlay() {
  var ov = document.getElementById("daily-overlay");
  if (ov) ov.removeAttribute("hidden");
  if (_lastDailyData) renderDaily(_lastDailyData);
}

function closeDailyOverlay() {
  var ov = document.getElementById("daily-overlay");
  if (ov) ov.setAttribute("hidden", "");
}

// ── settings ──────────────────────────────────────────────────────────────
function openSettings() {
  var panel = document.getElementById("settings-panel");
  var title = document.getElementById("settings-title");
  var body = document.getElementById("settings-body");
  if (title) title.textContent = t.settings_title || "Settings";
  if (body) body.innerHTML = '<div class="dim">…</div>';
  if (panel) panel.removeAttribute("hidden");

  fetch("/api/config")
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function(cfg) {
      window.__settingsConfig = cfg;
      var langOpts = ["es","en","pt"].map(function(l) {
        return '<option value="' + esc(l) + '"' + (cfg.language === l ? " selected" : "") + ">" + esc(l) + "</option>";
      }).join("");
      function chk(id, key, val) {
        return '<label class="scheck"><input type="checkbox" id="' + esc(id) + '"' + (val ? " checked" : "") + "><span>" + esc(t[key] || key) + "</span></label>";
      }
      var instHtml = "";
      if (cfg.detectedInstances && cfg.detectedInstances.length > 0) {
        var enabledDirs = new Set((cfg.instances || []).map(function(i) { return i.dir; }));
        instHtml = '<div class="sinst">' + cfg.detectedInstances.map(function(di) {
          return '<label class="scheck"><input type="checkbox" class="inst-chk" data-dir="' + esc(di.dir) + '" data-name="' + esc(di.name) + '"' + (enabledDirs.has(di.dir) ? " checked" : "") + '><span>' + esc(di.name) + ' <span class="dim">' + esc(di.dir) + "</span></span></label>";
        }).join("") + "</div>";
      }
      var tokPlaceholder = cfg.slackTokenSet ? (t.settings_slack_token_set || "set ····") + cfg.slackTokenLast4 : "";
      var linPlaceholder = cfg.linearTokenSet ? (t.settings_slack_token_set || "set ····") + (cfg.linearTokenLast4 || "") : "";
      body.innerHTML =
        '<div class="sfield"><label>' + esc(t.settings_language || "Language") + '</label><select id="s-lang">' + langOpts + '</select></div>' +
        chk("s-notify", "settings_notify", cfg.notifyWaiting) +
        chk("s-summaries", "settings_summaries_auto", cfg.summariesAuto) +
        chk("s-daily", "settings_daily_auto", cfg.dailyAuto) +
        chk("s-slack-auto", "settings_slack_auto", cfg.slackAuto) +
        '<div class="sfield"><label>' + esc(t.settings_alerts || "Alert channels") + '</label><input type="text" id="s-alerts" value="' + esc((cfg.slackChannelsAlerts || []).join(", ")) + '"></div>' +
        '<div class="sfield"><label>' + esc(t.settings_deploys || "Deploy channels") + '</label><input type="text" id="s-deploys" value="' + esc((cfg.slackChannelsDeploys || []).join(", ")) + '"></div>' +
        (instHtml ? '<div class="sfield"><label>' + esc(t.settings_instances || "Instances") + "</label>" + instHtml + "</div>" : "") +
        '<div class="sfield"><label>' + esc(t.settings_slack_token || "Slack token") + '</label><div class="stoken-row"><input type="password" id="s-token" placeholder="' + esc(tokPlaceholder) + '" value=""><button class="sbtn-clear" id="s-token-clear">' + esc(t.settings_clear || "Clear") + "</button></div></div>" +
        '<div class="sfield"><label>' + esc(t.settings_linear_token || "Linear token") + '</label><div class="stoken-row"><input type="password" id="s-lintoken" placeholder="' + esc(linPlaceholder) + '" value=""><button class="sbtn-clear" id="s-lintoken-clear">' + esc(t.settings_clear || "Clear") + "</button></div></div>" +
        '<div class="sfield"><label>' + esc(t.settings_mention_name || "Mention name") + '</label><input type="text" id="s-mention-name" value="' + esc(cfg.mentionName || "") + '"></div>' +
        '<div class="sfield"><label>' + esc(t.settings_llm_cap || "Daily LLM cap") + '</label><input type="number" id="s-llm-cap" min="1" max="10000" value="' + esc(String(cfg.llmDailyCap != null ? cfg.llmDailyCap : 100)) + '"></div>' +
        '<button class="sbtn-save" id="s-save">' + esc(t.settings_save || "Save") + "</button>";

      body.querySelector("#s-token-clear").addEventListener("click", function() {
        body.querySelector("#s-token").value = ""; body.querySelector("#s-token").placeholder = "";
        window.__settingsTokenCleared = true;
      });
      body.querySelector("#s-lintoken-clear").addEventListener("click", function() {
        body.querySelector("#s-lintoken").value = ""; body.querySelector("#s-lintoken").placeholder = "";
        window.__settingsLinTokenCleared = true;
      });
      body.querySelector("#s-save").addEventListener("click", saveSettings);
    })
    .catch(function() { if (body) body.innerHTML = '<div class="dim">error</div>'; });
}

function saveSettings() {
  var cfg = window.__settingsConfig || {}, payload = {};
  var langEl = document.getElementById("s-lang"); if (langEl) payload.language = langEl.value;
  var notifyEl = document.getElementById("s-notify"); if (notifyEl) payload.notifyWaiting = notifyEl.checked;
  var summEl = document.getElementById("s-summaries"); if (summEl) payload.summariesAuto = summEl.checked;
  var dailyEl = document.getElementById("s-daily"); if (dailyEl) payload.dailyAuto = dailyEl.checked;
  var slackAutoEl = document.getElementById("s-slack-auto"); if (slackAutoEl) payload.slackAuto = slackAutoEl.checked;
  var alertsEl = document.getElementById("s-alerts"); if (alertsEl) payload.slackChannelsAlerts = alertsEl.value.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
  var deploysEl = document.getElementById("s-deploys"); if (deploysEl) payload.slackChannelsDeploys = deploysEl.value.split(",").map(function(s) { return s.trim(); }).filter(Boolean);
  var instChecks = document.querySelectorAll(".inst-chk:checked");
  payload.instances = []; instChecks.forEach(function(cb) { payload.instances.push({ dir: cb.dataset.dir, name: cb.dataset.name }); });
  var tokenEl = document.getElementById("s-token");
  if (tokenEl) {
    var tokVal = tokenEl.value;
    var tokPlaceholder = cfg.slackTokenSet ? (t.settings_slack_token_set || "set ····") + (cfg.slackTokenLast4 || "") : "";
    if (window.__settingsTokenCleared) payload.slackToken = "";
    else if (tokVal && tokVal !== tokPlaceholder) payload.slackToken = tokVal;
  }
  var mentionNameEl = document.getElementById("s-mention-name"); if (mentionNameEl) payload.mentionName = mentionNameEl.value;
  var llmCapEl = document.getElementById("s-llm-cap");
  if (llmCapEl) { var capVal = parseInt(llmCapEl.value, 10); if (!isNaN(capVal) && capVal >= 1 && capVal <= 10000) payload.llmDailyCap = capVal; }
  var linEl = document.getElementById("s-lintoken");
  if (linEl) {
    var linVal = linEl.value;
    var linPlaceholder = cfg.linearTokenSet ? (t.settings_slack_token_set || "set ····") + (cfg.linearTokenLast4 || "") : "";
    if (window.__settingsLinTokenCleared) payload.linearToken = "";
    else if (linVal && linVal !== linPlaceholder) payload.linearToken = linVal;
  }
  fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
    .then(function(r) { return r.ok ? r.json() : Promise.reject(r.status); })
    .then(function() {
      closeSettings(); showToast(t.settings_saved || "saved");
      if (payload.language && payload.language !== lang) poll();
    })
    .catch(function(err) { showToast("error: " + err); });
}

function closeSettings() {
  var panel = document.getElementById("settings-panel");
  if (panel) panel.setAttribute("hidden", "");
  window.__settingsTokenCleared = false; window.__settingsLinTokenCleared = false;
}

// ── refresh ───────────────────────────────────────────────────────────────
function initRefreshBtn() {
  var btn = document.getElementById("refresh-btn");
  if (!btn) return;
  btn.addEventListener("click", function() {
    if (btn.disabled) return;
    btn.disabled = true;
    var origTitle = btn.title;
    btn.title = t.refresh_running || "refreshing…";
    fetch("/api/refresh", { method: "POST" })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        btn.disabled = false; btn.title = origTitle;
        if (!data) { showToast("refresh error"); return; }
        if (data.blocked) { showToast(data.blocked); }
        else {
          var parts = [];
          if (data.summaries) parts.push(String(data.summaries) + " resúmenes");
          if (data.slack_ok) parts.push("slack ✓");
          if (data.deadlines_checked) parts.push(String(data.deadlines_checked) + " deadlines");
          if (data.llm_calls_used != null) parts.push(String(data.llm_calls_used) + " llamadas");
          showToast(parts.length ? parts.join(" · ") : "ok");
        }
        pollUsage(); poll();
      })
      .catch(function() { btn.disabled = false; btn.title = origTitle; showToast("refresh error"); });
  });
}

// ── toast ─────────────────────────────────────────────────────────────────
function showToast(msg) {
  var toast = document.getElementById("s-toast");
  if (!toast) {
    toast = document.createElement("div"); toast.id = "s-toast"; toast.className = "stoast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg; toast.classList.add("show");
  setTimeout(function() { toast.classList.remove("show"); }, 2000);
}

// ── poll ──────────────────────────────────────────────────────────────────
async function poll() {
  try {
    var [projRes, sessRes, dailyRes, convRes, prsRes] = await Promise.all([
      fetch("/api/projects"),
      fetch("/api/sessions"),
      fetch("/api/daily"),
      fetch("/api/conversations"),
      fetch("/api/prs"),
    ]);
    if (projRes.ok) {
      var projData = await projRes.json();
      lang = projData.language || lang;  // projects response doesn't have language; sessions does
      t = I18N[lang] || I18N.es;
      _unlinkedMentionsOpen = projData.unlinked_mentions_open || 0;
      _unlinkedMentionsOpenItems = projData.unlinked_mentions_open_items || [];
      renderProjects(projData.projects || []);
      // Update conversations chip total if conversations data already fetched
      if (_lastConversations !== null) updateConversationsChip(_lastConversations);
    }
    if (sessRes.ok) {
      var sessData = await sessRes.json();
      lang = sessData.language || lang;
      t = I18N[lang] || I18N.es;
      _lastSessions = { active: sessData.active || [], archived: sessData.archived || [] };
      if (viewMode === "sessions") renderSessionsView(_lastSessions.active, _lastSessions.archived);
      // Update session detail if open
      if (openId) {
        document.querySelectorAll('.srow[data-id="' + openId + '"]').forEach(function(r) { r.classList.add("sel"); });
      }
    }
    if (dailyRes.ok) {
      var dailyData = await dailyRes.json();
      _lastDailyData = dailyData;
      // only re-render daily if overlay is open
      var ov = document.getElementById("daily-overlay");
      if (ov && !ov.hidden) renderDaily(dailyData);
    }
    if (convRes.ok) {
      var convData = await convRes.json();
      _lastConversations = convData.conversations || [];
      updateConversationsChip(_lastConversations);
      // Re-render if conversations view is open
      if (viewMode === "conversations") {
        var convView = document.getElementById("conversations-view");
        if (convView) renderConversationsList(convView, _lastConversations);
      }
    }
    if (prsRes.ok) {
      var prsData = await prsRes.json();
      _lastPRs = prsData;
      updatePRsChip(prsData);
      renderHero(_lastProjects);
      // Re-render if PRs view is open
      if (viewMode === "prs") {
        var prsViewEl = document.getElementById("prs-view");
        if (prsViewEl) renderPRsList(prsViewEl, prsData, _prFilter);
      }
    }
    // Invalidate project detail cache on each poll
    _projectDetailCache.clear();
  } catch (_) {}
}

// ── init ──────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function() {
  // Hero counter click
  var heroEl = document.getElementById("hero");
  if (heroEl) {
    heroEl.addEventListener("click", function() {
      toggleHeroDropdown(_lastProjects);
    });
  }

  // Close hero dropdown on outside click
  document.addEventListener("click", function(e) {
    if (!_heroDropdownOpen) return;
    var dd = document.getElementById("hero-dropdown");
    if (!dd) return;
    if (!heroEl.contains(e.target) && !dd.contains(e.target)) {
      dd.hidden = true; _heroDropdownOpen = false;
    }
  });

  // Usage chip click
  var usageChipEl = document.getElementById("usage-chip");
  if (usageChipEl) {
    usageChipEl.addEventListener("click", function() { openUsagePopover(); });
  }

  // Close usage popover on outside click
  document.addEventListener("click", function(e) {
    var pop = document.getElementById("usage-popover");
    if (!pop || pop.hidden) return;
    if (!usageChipEl.contains(e.target) && !pop.contains(e.target)) pop.hidden = true;
  });

  // Daily chip
  var dailyChipEl = document.getElementById("daily-chip");
  if (dailyChipEl) {
    dailyChipEl.addEventListener("click", function() { openDailyOverlay(); });
  }

  // Close daily overlay
  var dailyClose = document.getElementById("daily-close");
  if (dailyClose) dailyClose.addEventListener("click", closeDailyOverlay);
  var dailyBackdrop = document.getElementById("daily-backdrop");
  if (dailyBackdrop) dailyBackdrop.addEventListener("click", closeDailyOverlay);

  // Sessions chip
  var sessChipEl = document.getElementById("sessions-chip");
  if (sessChipEl) {
    sessChipEl.addEventListener("click", function() {
      if (viewMode === "sessions") switchToView("projects");
      else switchToView("sessions");
    });
  }

  // Conversations chip
  var convChipEl = document.getElementById("conversations-chip");
  if (convChipEl) {
    convChipEl.addEventListener("click", function() {
      if (viewMode === "conversations") switchToView("projects");
      else openConversationsView();
    });
  }

  // PRs chip
  var prsChipEl = document.getElementById("prs-chip");
  if (prsChipEl) {
    prsChipEl.addEventListener("click", function() {
      if (viewMode === "prs") switchToView("projects");
      else openPRsView();
    });
  }

  // Detail close
  var dClose = document.getElementById("d-close");
  if (dClose) dClose.addEventListener("click", closeDetail);

  // d-resume-copy
  var dResume = document.getElementById("d-resume-copy");
  if (dResume) {
    dResume.textContent = t.resume_copy || "Copiar prompt";
    dResume.addEventListener("click", function() {
      var sid = openId; if (!sid) return;
      var origText = dResume.textContent;
      dResume.textContent = "…"; dResume.disabled = true;
      fetch("/api/sessions/" + sid + "/resume-prompt")
        .then(function(r) { return r.ok ? r.text() : Promise.reject(r.status); })
        .then(function(text) {
          dResume.textContent = origText; dResume.disabled = false;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(function() {
              dResume.textContent = t.resume_copied || "copiado";
              setTimeout(function() { dResume.textContent = origText; }, 1500);
            });
          }
          var ta = document.getElementById("d-resume-textarea");
          if (!ta) { ta = document.createElement("textarea"); ta.id = "d-resume-textarea"; ta.style.cssText = "width:100%;height:120px;margin-top:8px;font-size:12px;"; var det = document.getElementById("detail"); if (det) det.appendChild(ta); }
          ta.value = text; ta.hidden = false; ta.select();
        })
        .catch(function() { dResume.textContent = t.resume_failed || "error"; dResume.disabled = false; });
    });
  }

  // d-copy-id
  var dCopyId = document.getElementById("d-copy-id");
  if (dCopyId) {
    dCopyId.textContent = t.resume_copy_id || "copiar id";
    dCopyId.addEventListener("click", function() {
      var sid = openId; if (!sid) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sid).then(function() {
          var orig = dCopyId.textContent; dCopyId.textContent = t.resume_copied || "copiado";
          setTimeout(function() { dCopyId.textContent = orig; }, 1500);
        }).catch(function() { var orig2 = dCopyId.textContent; dCopyId.textContent = t.resume_failed || "error"; setTimeout(function() { dCopyId.textContent = orig2; }, 1500); });
      }
    });
  }

  // Settings
  var settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) settingsBtn.addEventListener("click", openSettings);
  var settingsClose = document.getElementById("settings-close");
  if (settingsClose) settingsClose.addEventListener("click", closeSettings);
  var settingsOverlay = document.getElementById("settings-overlay");
  if (settingsOverlay) settingsOverlay.addEventListener("click", closeSettings);

  // Search
  var searchEl = document.getElementById("search");
  if (searchEl) {
    searchEl.placeholder = t.search_placeholder;
    searchEl.addEventListener("input", function() {
      var q = this.value;
      if (searchDebounce) clearTimeout(searchDebounce);
      if (q.length < 2) {
        if (inSearchMode) exitSearchMode();
        return;
      }
      searchDebounce = setTimeout(function() {
        searchDebounce = null;
        fetch("/api/search?q=" + encodeURIComponent(q))
          .then(function(r) { return r.ok ? r.json() : { results: [] }; })
          .then(function(data) { renderSearchResults(data.results || []); })
          .catch(function() {});
      }, 300);
    });
  }

  // Escape key
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") {
      var settingsPanel = document.getElementById("settings-panel");
      if (settingsPanel && !settingsPanel.hidden) { closeSettings(); return; }
      var dailyOv = document.getElementById("daily-overlay");
      if (dailyOv && !dailyOv.hidden) { closeDailyOverlay(); return; }
      var pop = document.getElementById("usage-popover");
      if (pop && !pop.hidden) { pop.hidden = true; return; }
      closeDetail();
    }
  });

  initRefreshBtn();
  poll();
  pollUsage();
  setInterval(poll, 5000);
  setInterval(pollUsage, 60000);

  // SSE hot reload
  if (typeof EventSource !== "undefined") {
    var evtSrc = new EventSource("/api/dev-events");
    evtSrc.addEventListener("reload", function() { location.reload(); });
  }
});
