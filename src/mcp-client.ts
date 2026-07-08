/**
 * Minimal MCP client (Streamable HTTP / JSON-RPC 2.0).
 * Speaks to https://mcp.linear.app/mcp with Bearer token.
 * DETERMINISTIC — zero LLM calls.
 *
 * Response format: server may reply as application/json OR text/event-stream.
 * Both are handled by parseBody().
 */

export type FetchFn = typeof fetch;

export type McpSession = {
  sessionId: string | null;
  endpoint: string;
  token: string;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type ToolCallResult = {
  content: Array<{ type: string; text: string }>;
};

export type IssueRow = {
  identifier: string;
  title: string;
  url: string;
  state_name: string;
  state_type: string;
  team_key: string;
  priority: number;
  updated_at: string;
};

let _jsonrpcId = 1;
function nextId(): number {
  return _jsonrpcId++;
}

// ── Response body parser (JSON + SSE) ────────────────────────────────────

async function parseBody(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (ct.includes("text/event-stream")) {
    return parseSse(text);
  }
  // application/json or anything else — try JSON parse
  try {
    return JSON.parse(text);
  } catch {
    // Try SSE parse as fallback
    return parseSse(text);
  }
}

function parseSse(text: string): any {
  // Find the last valid data: line that is a JSON object
  const lines = text.split("\n");
  let last: any = null;
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice("data:".length).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      last = JSON.parse(raw);
    } catch {}
  }
  return last;
}

// ── Build headers ─────────────────────────────────────────────────────────

function buildHeaders(token: string, sessionId: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    "Authorization": `Bearer ${token}`,
  };
  if (sessionId) {
    h["mcp-session-id"] = sessionId;
  }
  return h;
}

// ── initialize ────────────────────────────────────────────────────────────

export async function mcpInitialize(
  endpoint: string,
  token: string,
  fetchFn: FetchFn = fetch
): Promise<McpSession> {
  const id = nextId();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-live", version: "1" },
    },
  });

  const res = await fetchFn(endpoint, {
    method: "POST",
    headers: buildHeaders(token, null),
    body,
  });
  if (!res.ok) throw new Error(`MCP initialize failed: ${res.status}`);

  const sessionId = res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id") ?? null;

  // Parse body to verify OK, but we don't strictly need the result
  await parseBody(res).catch(() => null);

  const session: McpSession = { sessionId, endpoint, token };

  // Send notifications/initialized (fire and forget — no response expected)
  const notifBody = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  });
  await fetchFn(endpoint, {
    method: "POST",
    headers: buildHeaders(token, sessionId),
    body: notifBody,
  }).catch(() => null);

  return session;
}

// ── tools/list ────────────────────────────────────────────────────────────

export async function mcpToolsList(
  session: McpSession,
  fetchFn: FetchFn = fetch
): Promise<McpTool[]> {
  const id = nextId();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/list",
    params: {},
  });
  const res = await fetchFn(session.endpoint, {
    method: "POST",
    headers: buildHeaders(session.token, session.sessionId),
    body,
  });
  if (!res.ok) throw new Error(`tools/list failed: ${res.status}`);
  const msg = await parseBody(res);
  const tools = msg?.result?.tools;
  return Array.isArray(tools) ? tools : [];
}

// ── tools/call ────────────────────────────────────────────────────────────

export async function mcpToolsCall(
  session: McpSession,
  toolName: string,
  args: Record<string, unknown>,
  fetchFn: FetchFn = fetch
): Promise<ToolCallResult> {
  const id = nextId();
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  const res = await fetchFn(session.endpoint, {
    method: "POST",
    headers: buildHeaders(session.token, session.sessionId),
    body,
  });
  if (!res.ok) throw new Error(`tools/call failed: ${res.status}`);
  const msg = await parseBody(res);
  const content = msg?.result?.content;
  return { content: Array.isArray(content) ? content : [] };
}

// ── Parse tool result into IssueRow[] ────────────────────────────────────

export function parseToolRows(result: any): IssueRow[] {
  try {
    if (!result) return [];
    const content = result.content ?? result?.result?.content;
    if (!Array.isArray(content) || content.length === 0) return [];
    // Find first text content item
    const textItem = content.find((c: any) => c?.type === "text" && typeof c?.text === "string");
    if (!textItem) return [];
    const parsed = JSON.parse(textItem.text);
    // Linear MCP may return { issues: [...] } or { nodes: [...] } or a flat array
    const raw: any[] =
      Array.isArray(parsed) ? parsed :
      Array.isArray(parsed?.issues) ? parsed.issues :
      Array.isArray(parsed?.nodes) ? parsed.nodes :
      [];
    return raw.map(toIssueRow).filter((r): r is IssueRow => r !== null);
  } catch {
    return [];
  }
}

function toIssueRow(issue: any): IssueRow | null {
  try {
    const identifier = typeof issue?.identifier === "string" ? issue.identifier : "";
    const title = typeof issue?.title === "string" ? issue.title : "";
    if (!identifier) return null;
    return {
      identifier,
      title,
      url: typeof issue?.url === "string" ? issue.url : `https://linear.app/issue/${identifier}`,
      state_name: typeof issue?.state?.name === "string" ? issue.state.name : "",
      state_type: typeof issue?.state?.type === "string" ? issue.state.type : "",
      team_key: typeof issue?.team?.key === "string" ? issue.team.key : "",
      priority: typeof issue?.priority === "number" ? issue.priority : 0,
      updated_at: typeof issue?.updatedAt === "string" ? issue.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ── Find best tool for listing assigned issues ────────────────────────────

// S1: Tools whose name contains any of these verbs are mutating and must never be selected.
const MUTATING_RE = /(create|update|delete|archive|remove|move|assign)/i;

// S1: Normalized (lowercase, underscores stripped) patterns for read-only issue tools.
// Covers both camelCase (linear_myIssues → linearmyissues) and snake_case variants.
const SAFE_PATTERNS = ["listmyissues", "myissues", "searchissues", "listissues", "getissues"];

function _normalizeName(name: string): string {
  return name.toLowerCase().replace(/_/g, "");
}

/**
 * Discovers the correct tool name for listing current user's open issues.
 * Only selects tools on the read-only allowlist; never falls back to an
 * arbitrary "issue" tool that could be a mutating operation.
 *
 * The tool name for the real Linear MCP is `linear_myIssues`.
 */
export function findMyIssuesTool(tools: McpTool[]): McpTool | null {
  const safe = tools.filter(t => !MUTATING_RE.test(t.name));
  for (const pattern of SAFE_PATTERNS) {
    const match = safe.find(t => _normalizeName(t.name).includes(pattern));
    if (match) return match;
  }
  return null;
}

/**
 * Build the arguments for the issues tool.
 * For `linear_myIssues` the tool lists assigned-to-me open issues with no args.
 * For `linear_searchIssues` we'd pass a filter, but we prefer myIssues first.
 */
export function buildIssueArgs(tool: McpTool): Record<string, unknown> {
  const name = tool.name.toLowerCase();
  if (name.includes("search") || name.includes("list")) {
    // search-style tool: filter by assignee=me and open state
    return { filter: { assignee: { isMe: { eq: true } }, state: { type: { neq: "completed" } } } };
  }
  // myIssues tool: no args needed
  return {};
}
