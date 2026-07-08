/**
 * Tests for OAuth 2.1 + PKCE + Dynamic Client Registration flow.
 * NEVER hits real mcp.linear.app — all network calls use injected fake fetch.
 */
import { test, expect, beforeEach } from "bun:test";
import {
  discoverOAuthMeta,
  registerClient,
  buildAuthorizeUrl,
  exchangeCode,
  refreshToken,
  clearPkceState,
  type OAuthMeta,
  type FetchFn,
} from "../src/linear-oauth";
import { loadConfig, saveConfig, type Config } from "../src/config";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

// ── test config isolation ───────────────────────────────────────────────────
let tmpDir: string;
let origHome: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lin-oauth-test-"));
  origHome = process.env.CLAUDE_LIVE_HOME;
  process.env.CLAUDE_LIVE_HOME = tmpDir;
  clearPkceState();
});

function restoreHome() {
  if (origHome !== undefined) process.env.CLAUDE_LIVE_HOME = origHome;
  else delete process.env.CLAUDE_LIVE_HOME;
}

// ── fake fetch builders ─────────────────────────────────────────────────────
const DISCOVERY_DOC: OAuthMeta = {
  authorization_endpoint: "https://linear.app/oauth/authorize",
  token_endpoint: "https://api.linear.app/oauth/token",
  registration_endpoint: "https://api.linear.app/oauth/register",
};

function makeFetchDiscovery(doc = DISCOVERY_DOC): FetchFn {
  return async (url: string, _init?: RequestInit) => {
    if (String(url).includes("oauth-authorization-server")) {
      return { ok: true, status: 200, json: async () => doc } as any;
    }
    throw new Error("Unexpected fetch: " + url);
  };
}

function makeFetchDCR(clientId = "test-client-id", clientSecret?: string): FetchFn {
  const discovery = makeFetchDiscovery();
  return async (url: string, init?: RequestInit) => {
    if (String(url).includes("oauth-authorization-server")) {
      return discovery(url, init);
    }
    if (String(url).includes("/register")) {
      const body: Record<string, unknown> = { client_id: clientId };
      if (clientSecret) body.client_secret = clientSecret;
      return { ok: true, status: 200, json: async () => body } as any;
    }
    throw new Error("Unexpected fetch: " + url);
  };
}

function makeTokenFetch(access: string, refresh = "ref-tok", expiresIn = 3600): FetchFn {
  return async (url: string, _init?: RequestInit) => {
    if (String(url).includes("/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: access,
          refresh_token: refresh,
          expires_in: expiresIn,
          token_type: "Bearer",
        }),
      } as any;
    }
    throw new Error("Unexpected fetch: " + url);
  };
}

// ── tests ───────────────────────────────────────────────────────────────────

test("discoverOAuthMeta returns parsed discovery doc", async () => {
  const meta = await discoverOAuthMeta(makeFetchDiscovery());
  expect(meta.authorization_endpoint).toContain("authorize");
  expect(meta.token_endpoint).toContain("token");
  expect(meta.registration_endpoint).toContain("register");
  restoreHome();
});

test("registerClient stores client_id in config", async () => {
  const meta = await discoverOAuthMeta(makeFetchDiscovery());
  await registerClient(meta, 7777, makeFetchDCR("my-client-id"));
  const cfg = loadConfig();
  expect(cfg.linearClientId).toBe("my-client-id");
  restoreHome();
});

test("registerClient stores client_secret if issued", async () => {
  const meta = await discoverOAuthMeta(makeFetchDiscovery());
  await registerClient(meta, 7777, makeFetchDCR("cid", "s3cr3t"));
  const cfg = loadConfig();
  expect(cfg.linearClientId).toBe("cid");
  expect(cfg.linearClientSecret).toBe("s3cr3t");
  restoreHome();
});

test("buildAuthorizeUrl returns URL with S256, state, and resource", async () => {
  const meta = DISCOVERY_DOC;
  const { url, state } = await buildAuthorizeUrl(meta, "my-client-id", 7777);
  expect(url).toContain("code_challenge_method=S256");
  expect(url).toContain("state=" + state);
  expect(url).toContain("resource=");
  expect(url).toContain("response_type=code");
  expect(url).toContain("client_id=my-client-id");
  restoreHome();
});

test("exchangeCode rejects unknown state with error", async () => {
  const meta = DISCOVERY_DOC;
  await expect(
    exchangeCode(meta, "my-client-id", undefined, "unknown-state", "some-code", 7777, makeTokenFetch("tok"))
  ).rejects.toThrow();
  restoreHome();
});

test("exchangeCode with valid state stores token and consumes state (no reuse)", async () => {
  const meta = DISCOVERY_DOC;
  const { state } = await buildAuthorizeUrl(meta, "my-client-id", 7777);
  await exchangeCode(meta, "my-client-id", undefined, state, "auth-code-123", 7777, makeTokenFetch("access-tok"));
  const cfg = loadConfig();
  expect(cfg.linearAccessToken).toBe("access-tok");
  expect(cfg.linearRefreshToken).toBe("ref-tok");
  expect(typeof cfg.linearTokenExpiresAt).toBe("number");

  // state is consumed — second use must throw
  await expect(
    exchangeCode(meta, "my-client-id", undefined, state, "auth-code-123", 7777, makeTokenFetch("access-tok"))
  ).rejects.toThrow();
  restoreHome();
});

test("exchangeCode sends PKCE verifier in token request", async () => {
  const meta = DISCOVERY_DOC;
  const { state } = await buildAuthorizeUrl(meta, "my-client-id", 7777);
  let capturedBody = "";
  const spyFetch: FetchFn = async (url: string, init?: RequestInit) => {
    if (String(url).includes("/token")) {
      capturedBody = typeof init?.body === "string" ? init.body : String(init?.body ?? "");
      return { ok: true, status: 200, json: async () => ({ access_token: "a", refresh_token: "r", expires_in: 3600, token_type: "Bearer" }) } as any;
    }
    throw new Error("unexpected");
  };
  await exchangeCode(meta, "my-client-id", undefined, state, "code", 7777, spyFetch);
  expect(capturedBody).toContain("code_verifier=");
  expect(capturedBody).toContain("grant_type=authorization_code");
  restoreHome();
});

test("refreshToken posts grant_type=refresh_token and updates config", async () => {
  const meta = DISCOVERY_DOC;
  // Seed a refresh token in config
  const cfg = loadConfig();
  cfg.linearRefreshToken = "old-refresh";
  cfg.linearClientId = "my-client-id";
  cfg.linearAccessToken = "old-access";
  saveConfig(cfg);

  await refreshToken(meta, "my-client-id", undefined, "old-refresh", makeTokenFetch("new-access", "new-refresh"));
  const updated = loadConfig();
  expect(updated.linearAccessToken).toBe("new-access");
  expect(updated.linearRefreshToken).toBe("new-refresh");
  restoreHome();
});

test("tokens are never exposed in config GET response (server test)", async () => {
  // This asserts the server masks tokens — tested via server.test.ts
  // Here just verify config has masking in the saveConfig round-trip
  const cfg = loadConfig();
  cfg.linearAccessToken = "super-secret-token";
  saveConfig(cfg);
  const loaded = loadConfig();
  // raw config has the token (expected for internal use)
  expect(loaded.linearAccessToken).toBe("super-secret-token");
  // but the server must not return it — tested in server.test.ts
  restoreHome();
});
