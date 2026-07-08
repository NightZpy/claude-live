/**
 * Tests for the minimal MCP client (Streamable HTTP / JSON-RPC 2.0).
 * NEVER hits real mcp.linear.app — all calls use injected fake fetch.
 */
import { test, expect } from "bun:test";
import {
  mcpInitialize,
  mcpToolsList,
  mcpToolsCall,
  parseToolRows,
  findMyIssuesTool,
  type McpSession,
  type McpTool,
  type FetchFn,
} from "../src/mcp-client";

// ── fake response builders ─────────────────────────────────────────────────

function jsonResponse(body: unknown, sessionId = "sess-123"): Response {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (k: string) => k.toLowerCase() === "content-type" ? "application/json"
        : k.toLowerCase() === "mcp-session-id" ? sessionId
        : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as any;
}

function sseResponse(body: unknown, sessionId = "sess-456"): Response {
  const data = "data: " + JSON.stringify(body) + "\n\n";
  return {
    ok: true,
    status: 200,
    headers: {
      get: (k: string) => k.toLowerCase() === "content-type" ? "text/event-stream"
        : k.toLowerCase() === "mcp-session-id" ? sessionId
        : null,
    },
    text: async () => data,
    json: async () => { throw new Error("not json"); },
  } as any;
}

// ── test: initialize handshake sends protocolVersion, captures session id ──

test("mcpInitialize sends protocolVersion and captures Mcp-Session-Id", async () => {
  let firstInit: RequestInit | undefined;
  let callCount = 0;
  const fakeFetch: FetchFn = async (_url, init) => {
    callCount++;
    if (callCount === 1) firstInit = init;  // capture only the initialize call
    return jsonResponse({
      jsonrpc: "2.0", id: 1,
      result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "linear", version: "1" } },
    }, "session-abc");
  };

  const session = await mcpInitialize("https://mcp.linear.app/mcp", "fake-token", fakeFetch);
  expect(session.sessionId).toBe("session-abc");
  const body = JSON.parse(firstInit?.body as string);
  expect(body.method).toBe("initialize");
  expect(body.params.protocolVersion).toBe("2025-06-18");
  expect(body.params.clientInfo.name).toBe("claude-live");
});

test("mcpInitialize works with SSE-format response", async () => {
  const fakeInit = {
    jsonrpc: "2.0", id: 1,
    result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "linear", version: "1" } },
  };
  let callCount = 0;
  const fakeFetch: FetchFn = async () => {
    callCount++;
    return sseResponse(fakeInit, "sess-sse");
  };
  const session = await mcpInitialize("https://mcp.linear.app/mcp", "fake-token", fakeFetch);
  expect(session.sessionId).toBe("sess-sse");
  expect(callCount).toBeGreaterThanOrEqual(1); // initialize + notifications/initialized
});

// ── test: tools/list ────────────────────────────────────────────────────────

const TOOLS_LIST_RESPONSE = {
  jsonrpc: "2.0", id: 2,
  result: {
    tools: [
      { name: "linear_myIssues", description: "List issues assigned to the current user", inputSchema: { type: "object", properties: {} } },
      { name: "linear_getIssue", description: "Get a specific issue", inputSchema: { type: "object", properties: { id: { type: "string" } } } },
    ],
  },
};

test("mcpToolsList returns tool list from JSON response", async () => {
  const fakeFetch: FetchFn = async () => jsonResponse(TOOLS_LIST_RESPONSE);
  const session: McpSession = { sessionId: "s1", endpoint: "https://mcp.linear.app/mcp", token: "tok" };
  const tools = await mcpToolsList(session, fakeFetch);
  expect(tools.length).toBeGreaterThanOrEqual(2);
  expect(tools[0].name).toBe("linear_myIssues");
});

test("mcpToolsList returns tool list from SSE response", async () => {
  const fakeFetch: FetchFn = async () => sseResponse(TOOLS_LIST_RESPONSE);
  const session: McpSession = { sessionId: "s1", endpoint: "https://mcp.linear.app/mcp", token: "tok" };
  const tools = await mcpToolsList(session, fakeFetch);
  expect(tools.some(t => t.name === "linear_myIssues")).toBe(true);
});

// ── test: tools/call ────────────────────────────────────────────────────────

const ISSUES_CALL_RESPONSE = {
  jsonrpc: "2.0", id: 3,
  result: {
    content: [{
      type: "text",
      text: JSON.stringify({
        issues: [
          {
            identifier: "ENG-123",
            title: "Fix the auth bug",
            url: "https://linear.app/acme/issue/ENG-123",
            state: { name: "In Progress", type: "started" },
            team: { key: "ENG" },
            priority: 2,
            updatedAt: "2026-07-01T10:00:00Z",
          },
          {
            identifier: "ENG-124",
            title: "Write tests",
            url: "https://linear.app/acme/issue/ENG-124",
            state: { name: "Todo", type: "unstarted" },
            team: { key: "ENG" },
            priority: 1,
            updatedAt: "2026-07-02T08:00:00Z",
          },
        ],
      }),
    }],
  },
};

test("mcpToolsCall returns parsed content from tool result", async () => {
  const fakeFetch: FetchFn = async () => jsonResponse(ISSUES_CALL_RESPONSE);
  const session: McpSession = { sessionId: "s1", endpoint: "https://mcp.linear.app/mcp", token: "tok" };
  const result = await mcpToolsCall(session, "linear_myIssues", {}, fakeFetch);
  expect(result.content.length).toBeGreaterThan(0);
  expect(result.content[0].type).toBe("text");
});

test("parseToolRows extracts identifier/title/state/priority from tool result text", () => {
  const rows = parseToolRows(ISSUES_CALL_RESPONSE.result);
  expect(rows.length).toBe(2);
  expect(rows[0].identifier).toBe("ENG-123");
  expect(rows[0].title).toBe("Fix the auth bug");
  expect(rows[0].state_name).toBe("In Progress");
  expect(rows[0].state_type).toBe("started");
  expect(rows[0].team_key).toBe("ENG");
  expect(rows[0].priority).toBe(2);
  expect(rows[1].identifier).toBe("ENG-124");
});

test("parseToolRows returns [] on malformed content", () => {
  expect(parseToolRows({ content: [{ type: "text", text: "not json" }] })).toEqual([]);
  expect(parseToolRows({})).toEqual([]);
  expect(parseToolRows(null)).toEqual([]);
  expect(parseToolRows({ content: [] })).toEqual([]);
});

test("mcpToolsCall Mcp-Session-Id header is sent on subsequent calls", async () => {
  let capturedHeaders: Record<string, string> = {};
  const fakeFetch: FetchFn = async (_url, init) => {
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    return jsonResponse(ISSUES_CALL_RESPONSE);
  };
  const session: McpSession = { sessionId: "my-session-id", endpoint: "https://mcp.linear.app/mcp", token: "tok" };
  await mcpToolsCall(session, "linear_myIssues", {}, fakeFetch);
  expect(capturedHeaders["mcp-session-id"] ?? capturedHeaders["Mcp-Session-Id"]).toBe("my-session-id");
});

// ── S1: findMyIssuesTool read-only allowlist ─────────────────────────────────

function makeTool(name: string): McpTool {
  return { name, description: `Tool ${name}` };
}

test("findMyIssuesTool returns null when list contains only mutating tools", () => {
  const tools = [
    makeTool("create_issue"),
    makeTool("update_issue"),
    makeTool("delete_issue"),
    makeTool("archive_issue"),
  ];
  expect(findMyIssuesTool(tools)).toBeNull();
});

test("findMyIssuesTool picks list_my_issues over mutators", () => {
  const tools = [
    makeTool("create_issue"),
    makeTool("list_my_issues"),
    makeTool("update_issue"),
  ];
  const result = findMyIssuesTool(tools);
  expect(result?.name).toBe("list_my_issues");
});

test("findMyIssuesTool picks search_issues (snake_case)", () => {
  const tools = [makeTool("search_issues"), makeTool("create_issue")];
  const result = findMyIssuesTool(tools);
  expect(result?.name).toBe("search_issues");
});

test("findMyIssuesTool picks linear_myIssues (camelCase prefix)", () => {
  const tools = [makeTool("linear_myIssues"), makeTool("create_issue")];
  const result = findMyIssuesTool(tools);
  expect(result?.name).toBe("linear_myIssues");
});

test("findMyIssuesTool does NOT fall through to arbitrary issue tool", () => {
  // Tools that have "issue" in name but are NOT on the safe allowlist
  const tools = [makeTool("issue_tracker"), makeTool("some_issue_helper")];
  expect(findMyIssuesTool(tools)).toBeNull();
});
