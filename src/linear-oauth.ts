/**
 * OAuth 2.1 + PKCE + Dynamic Client Registration for Linear MCP.
 * Implements the same flow as Claude Code's Linear integration:
 * no workspace admin, no PAT — pure OAuth 2.1 + PKCE public client.
 *
 * SECURITY RULES:
 * - NEVER log tokens, secrets, or PKCE verifiers.
 * - NEVER send raw token values to the browser.
 * - All state (PKCE, tokens) is stored server-side only.
 */

import { loadConfig, saveConfig } from "./config";

export type FetchFn = typeof fetch;

export type OAuthMeta = {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
};

// ── In-memory PKCE state (keyed by state UUID, TTL 10 minutes) ────────────
type PkceEntry = { verifier: string; expiresAt: number };
const _pkceMap = new Map<string, PkceEntry>();
const PKCE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function clearPkceState(): void {
  _pkceMap.clear();
}

function _cleanExpired(): void {
  const now = Date.now();
  for (const [k, v] of _pkceMap) {
    if (now > v.expiresAt) _pkceMap.delete(k);
  }
}

// ── PKCE helpers ──────────────────────────────────────────────────────────

// B1 fix: Buffer.from().toString("base64url") is correct for all input lengths.
// The hand-rolled implementation dropped the final char for 2-byte trailing groups
// (SHA-256 is 32 bytes; 32%3 == 2), producing 42-char challenges instead of 43.
function base64url(buf: Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

async function generateVerifier(): Promise<string> {
  // 43-128 chars base64url (RFC 7636). Use 64 bytes → 86-char base64url.
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function computeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64url(new Uint8Array(digest));
}

// ── OAuth endpoint host validation (S2) ───────────────────────────────────

function isLinearHost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.protocol === "https:" && (u.hostname === "linear.app" || u.hostname.endsWith(".linear.app"));
  } catch {
    return false;
  }
}

// ── Discovery ─────────────────────────────────────────────────────────────

const MCP_ENDPOINT = "https://mcp.linear.app/mcp";
const DISCOVERY_PRIMARY = "https://mcp.linear.app/.well-known/oauth-authorization-server";
const DISCOVERY_RESOURCE = "https://mcp.linear.app/.well-known/oauth-protected-resource";

export async function discoverOAuthMeta(fetchFn: FetchFn = fetch): Promise<OAuthMeta> {
  // Try primary discovery first
  try {
    const res = await fetchFn(DISCOVERY_PRIMARY);
    if (res.ok) {
      const doc = await res.json() as any;
      const meta = extractMeta(doc);
      if (meta) return meta;
    }
  } catch {}

  // Fall back: protected-resource → follow authorization_servers[]
  const rres = await fetchFn(DISCOVERY_RESOURCE);
  if (!rres.ok) throw new Error("OAuth discovery failed");
  const rdoc = await rres.json() as any;
  const servers: string[] = Array.isArray(rdoc.authorization_servers) ? rdoc.authorization_servers : [];
  for (const srv of servers) {
    // S2: reject any authorization_server entry that is not a linear.app HTTPS URL
    if (!isLinearHost(srv)) continue;
    try {
      const sres = await fetchFn(srv + "/.well-known/oauth-authorization-server");
      if (sres.ok) {
        const sdoc = await sres.json() as any;
        const meta = extractMeta(sdoc);
        if (meta) return meta;
      }
    } catch {}
  }
  throw new Error("Could not locate OAuth authorization server");
}

function extractMeta(doc: any): OAuthMeta | null {
  if (
    typeof doc?.authorization_endpoint === "string" &&
    typeof doc?.token_endpoint === "string" &&
    typeof doc?.registration_endpoint === "string"
  ) {
    const ae = doc.authorization_endpoint as string;
    const te = doc.token_endpoint as string;
    const re = doc.registration_endpoint as string;
    // S2: reject any discovery doc whose endpoints are not on linear.app
    if (!isLinearHost(ae) || !isLinearHost(te) || !isLinearHost(re)) return null;
    return { authorization_endpoint: ae, token_endpoint: te, registration_endpoint: re };
  }
  return null;
}

// ── Dynamic Client Registration ──────────────────────────────────────────

export async function registerClient(
  meta: OAuthMeta,
  port: number,
  fetchFn: FetchFn = fetch
): Promise<void> {
  const body = JSON.stringify({
    client_name: "claude-live",
    redirect_uris: [`http://localhost:${port}/api/linear/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: "read",
  });

  const res = await fetchFn(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`DCR failed: ${res.status}`);
  const reg = await res.json() as any;

  if (typeof reg.client_id !== "string") throw new Error("DCR: no client_id returned");

  const cfg = loadConfig();
  cfg.linearClientId = reg.client_id;
  // Only store secret if issued (prefer no-secret public client)
  if (typeof reg.client_secret === "string" && reg.client_secret.length > 0) {
    cfg.linearClientSecret = reg.client_secret;
  } else {
    delete cfg.linearClientSecret;
  }
  // Store the discovery meta for caching
  cfg.linearOAuthMeta = {
    authorization_endpoint: meta.authorization_endpoint,
    token_endpoint: meta.token_endpoint,
    registration_endpoint: meta.registration_endpoint,
  };
  saveConfig(cfg);
}

// ── Authorize URL ─────────────────────────────────────────────────────────

export async function buildAuthorizeUrl(
  meta: OAuthMeta,
  clientId: string,
  port: number
): Promise<{ url: string; state: string }> {
  _cleanExpired();
  const verifier = await generateVerifier();
  const challenge = await computeChallenge(verifier);
  const state = crypto.randomUUID();

  _pkceMap.set(state, { verifier, expiresAt: Date.now() + PKCE_TTL_MS });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: `http://localhost:${port}/api/linear/callback`,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "read",
    resource: MCP_ENDPOINT,
  });

  return { url: `${meta.authorization_endpoint}?${params.toString()}`, state };
}

// ── Token Exchange ────────────────────────────────────────────────────────

export async function exchangeCode(
  meta: OAuthMeta,
  clientId: string,
  clientSecret: string | undefined,
  state: string,
  code: string,
  port: number,
  fetchFn: FetchFn = fetch
): Promise<void> {
  _cleanExpired();
  const entry = _pkceMap.get(state);
  if (!entry || Date.now() > entry.expiresAt) {
    throw new Error("Invalid or expired OAuth state");
  }
  // Consume the state immediately (no reuse)
  _pkceMap.delete(state);

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `http://localhost:${port}/api/linear/callback`,
    client_id: clientId,
    code_verifier: entry.verifier,
  });
  if (clientSecret) params.set("client_secret", clientSecret);

  const res = await fetchFn(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status.toString());
    throw new Error(`Token exchange failed: ${err}`);
  }
  const tok = await res.json() as any;
  if (typeof tok.access_token !== "string") throw new Error("Token exchange: no access_token");

  _storeTokens(tok);
}

// ── Token Refresh ─────────────────────────────────────────────────────────

export async function refreshToken(
  meta: OAuthMeta,
  clientId: string,
  clientSecret: string | undefined,
  existingRefreshToken: string,
  fetchFn: FetchFn = fetch
): Promise<void> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: existingRefreshToken,
    client_id: clientId,
  });
  if (clientSecret) params.set("client_secret", clientSecret);

  const res = await fetchFn(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    // Refresh failed → clear tokens so user must re-authorize
    const cfg = loadConfig();
    delete cfg.linearAccessToken;
    delete cfg.linearRefreshToken;
    delete cfg.linearTokenExpiresAt;
    saveConfig(cfg);
    throw new Error("Token refresh failed");
  }
  const tok = await res.json() as any;
  _storeTokens(tok);
}

function _storeTokens(tok: any): void {
  const cfg = loadConfig();
  cfg.linearAccessToken = tok.access_token;
  if (typeof tok.refresh_token === "string") cfg.linearRefreshToken = tok.refresh_token;
  if (typeof tok.expires_in === "number") {
    cfg.linearTokenExpiresAt = Date.now() + tok.expires_in * 1000;
  }
  saveConfig(cfg);
}

// ── Refresh-if-needed helper ──────────────────────────────────────────────

export async function refreshIfNeeded(fetchFn: FetchFn = fetch): Promise<string | null> {
  const cfg = loadConfig();
  const token = cfg.linearAccessToken;
  if (!token) return null;

  const expiresAt = cfg.linearTokenExpiresAt;
  const needsRefresh = expiresAt != null && Date.now() > expiresAt - 60_000; // 1-min buffer

  if (needsRefresh && cfg.linearRefreshToken && cfg.linearClientId) {
    const meta = cfg.linearOAuthMeta;
    if (!meta) return null;
    try {
      await refreshToken(meta, cfg.linearClientId, cfg.linearClientSecret, cfg.linearRefreshToken, fetchFn);
      return loadConfig().linearAccessToken ?? null;
    } catch {
      return null; // refresh failed, user must re-authorize
    }
  }

  return token;
}

// ── Disconnect ────────────────────────────────────────────────────────────

export function clearLinearTokens(): void {
  const cfg = loadConfig();
  delete cfg.linearClientId;
  delete cfg.linearClientSecret;
  delete cfg.linearAccessToken;
  delete cfg.linearRefreshToken;
  delete cfg.linearTokenExpiresAt;
  delete cfg.linearOAuthMeta;
  saveConfig(cfg);
}
