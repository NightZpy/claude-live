import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate the whole test suite from the developer's real ~/.claude-live config/db.
// Without this, tests that call loadConfig() (e.g. analyze-session, the refresh handler)
// read machine state — a paused LLM flag or a filled daily cap — and fail non-deterministically.
// Tests that need their own home still override CLAUDE_LIVE_HOME per-case; this only sets a safe default.
if (!process.env.CLAUDE_LIVE_HOME) {
  process.env.CLAUDE_LIVE_HOME = mkdtempSync(join(tmpdir(), "claude-live-test-"));
}
