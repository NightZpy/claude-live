import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homeDir, dbPath, configPath, loadConfig, saveConfig, DEFAULT_CONFIG } from "../src/config";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "claude-live-test-"));
  process.env.CLAUDE_LIVE_HOME = tmp;
});

test("homeDir honors CLAUDE_LIVE_HOME at call time", () => {
  expect(homeDir()).toBe(tmp);
  expect(dbPath()).toBe(join(tmp, "claude-live.db"));
  expect(configPath()).toBe(join(tmp, "config.json"));
});

test("loadConfig returns defaults when file missing", () => {
  expect(loadConfig()).toEqual(DEFAULT_CONFIG);
});

test("saveConfig/loadConfig roundtrip and merge over defaults", () => {
  saveConfig({ ...DEFAULT_CONFIG, language: "en", instances: [{ dir: "/x/.claude", name: "personal" }] });
  const c = loadConfig();
  expect(c.language).toBe("en");
  expect(c.port).toBe(7777);
  expect(c.instances).toHaveLength(1);
});

test("loadConfig survives corrupt json", async () => {
  await Bun.write(configPath(), "{not json");
  expect(loadConfig()).toEqual(DEFAULT_CONFIG);
});

test("new fields have correct defaults when file missing", () => {
  const c = loadConfig();
  expect(c.summariesAuto).toBe(false);
  expect(c.dailyAuto).toBe(false);
  expect(c.slackAuto).toBe(false);
  expect(c.slackToken).toBe("");
  expect(c.notifyWaiting).toBe(true);
  expect(c.slackChannelsAlerts).toEqual([]);
  expect(c.slackChannelsDeploys).toEqual([]);
});

test("saveConfig/loadConfig roundtrip for new fields", () => {
  saveConfig({ ...DEFAULT_CONFIG, summariesAuto: false, slackToken: "xoxp-abc-1234" });
  const c = loadConfig();
  expect(c.summariesAuto).toBe(false);
  expect(c.slackToken).toBe("xoxp-abc-1234");
  expect(c.dailyAuto).toBe(false);  // default is false (opt-in)
});

test("DEFAULT_CONFIG has all LLM jobs opted out by default", () => {
  expect(DEFAULT_CONFIG.summariesAuto).toBe(false);
  expect(DEFAULT_CONFIG.dailyAuto).toBe(false);
  expect(DEFAULT_CONFIG.slackAuto).toBe(false);
});
