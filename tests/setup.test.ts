import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectInstances, installHooks, uninstallHooks, hookCommand, isOurs, deployApp } from "../src/setup";

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "cl-setup-"));
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus" }));
  mkdirSync(join(home, ".claude-work", "projects"), { recursive: true });
  mkdirSync(join(home, ".claude-live"), { recursive: true }); // must be excluded
  mkdirSync(join(home, ".claude-empty"), { recursive: true }); // no settings/projects → excluded
  return home;
}

test("detectInstances finds real instances, derives names, excludes claude-live", () => {
  const home = fakeHome();
  const found = detectInstances(home).sort((a, b) => a.name.localeCompare(b.name));
  expect(found.map(i => i.name)).toEqual(["personal", "work"]);
});

test("installHooks is idempotent, backs up, preserves existing settings", () => {
  const home = fakeHome();
  const sp = join(home, ".claude", "settings.json");
  const r1 = installHooks(sp, "/repo/claude-live");
  expect(r1.installed).toHaveLength(6);
  expect(existsSync(sp + ".claude-live.bak")).toBe(true);
  const s = JSON.parse(readFileSync(sp, "utf8"));
  expect(s.model).toBe("opus"); // preserved
  expect(s.hooks.PostToolUse[0].matcher).toBeUndefined();
  expect(s.hooks.SessionStart[0].hooks[0].command).toBe(hookCommand("/repo/claude-live"));
  const r2 = installHooks(sp, "/repo/claude-live");
  expect(r2.installed).toHaveLength(0);
  expect(r2.skipped).toHaveLength(6);
  expect(JSON.parse(readFileSync(sp, "utf8")).hooks.SessionStart).toHaveLength(1);
});

test("installHooks creates settings.json when missing and respects foreign hooks", () => {
  const home = fakeHome();
  const sp = join(home, ".claude-work", "settings.json");
  writeFileSync(sp, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "other-tool" }] }] } }));
  installHooks(sp, "/repo/claude-live");
  const s = JSON.parse(readFileSync(sp, "utf8"));
  expect(s.hooks.Stop).toHaveLength(2); // foreign + ours
});

test("uninstallHooks removes only ours", () => {
  const home = fakeHome();
  const sp = join(home, ".claude", "settings.json");
  installHooks(sp, "/repo/claude-live");
  const n = uninstallHooks(sp);
  expect(n).toBe(6);
  const s = JSON.parse(readFileSync(sp, "utf8"));
  expect(s.hooks ?? {}).toEqual({});
  expect(s.model).toBe("opus");
});

test("installHooks treats empty settings.json as {}", () => {
  const dir = mkdtempSync(join(tmpdir(), "cl-empty-"));
  const sp = join(dir, "settings.json");
  writeFileSync(sp, "   "); // whitespace-only
  const result = installHooks(sp, "/repo/claude-live");
  expect(result.installed).toHaveLength(6);
  const s = JSON.parse(readFileSync(sp, "utf8"));
  expect(Object.keys(s.hooks)).toHaveLength(6);
});

test("installHooks skips event when hooks[event] is not an array, leaves value untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "cl-nonarray-"));
  const sp = join(dir, "settings.json");
  writeFileSync(sp, JSON.stringify({ hooks: { Stop: 42 } }));
  const result = installHooks(sp, "/repo/claude-live");
  // Stop should be skipped, other 5 installed
  expect(result.installed).toHaveLength(5);
  expect(result.skipped).toContain("Stop");
  const s = JSON.parse(readFileSync(sp, "utf8"));
  expect(s.hooks.Stop).toBe(42); // untouched
});

test("uninstallHooks works when repoRoot lacks 'claude-live' substring (isOurs via /src/hook.ts suffix)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cl-renamed-"));
  const sp = join(dir, "settings.json");
  // Inject a group whose command ends with /src/hook.ts but has no 'claude-live' in path
  const cmd = `${process.execPath} /tmp/xyz/src/hook.ts`;
  expect(isOurs(cmd)).toBe(true); // verify helper
  const settings = {
    model: "opus",
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: cmd, timeout: 10 }] }],
    },
  };
  writeFileSync(sp, JSON.stringify(settings, null, 2) + "\n");
  const n = uninstallHooks(sp);
  expect(n).toBe(1);
  const s = JSON.parse(readFileSync(sp, "utf8"));
  expect(s.hooks ?? {}).toEqual({});
  expect(s.model).toBe("opus");
});

test("second no-op install leaves file byte-identical", () => {
  const home = fakeHome();
  const sp = join(home, ".claude", "settings.json");
  installHooks(sp, "/repo/claude-live");
  const before = readFileSync(sp, "utf8");
  installHooks(sp, "/repo/claude-live"); // no-op
  const after = readFileSync(sp, "utf8");
  expect(after).toBe(before);
});

test("plistContent embeds homeDir app path, not repoRoot", async () => {
  const tmpHome = mkdtempSync(join(tmpdir(), "cl-plist-"));
  const origHome = process.env.CLAUDE_LIVE_HOME;
  process.env.CLAUDE_LIVE_HOME = tmpHome;
  try {
    const { plistContent } = await import("../src/setup");
    const p = plistContent("/repo/claude-live");
    expect(p).toContain("<string>dev.claude-live</string>");
    expect(p).toContain(join(tmpHome, "app", "src", "server.ts"));
    expect(p).not.toContain("/repo/claude-live/src/server.ts");
    expect(p).toContain(process.execPath);
    expect(p).toContain("server.log");
    expect(p).toContain("<key>KeepAlive</key>");
  } finally {
    if (origHome === undefined) delete process.env.CLAUDE_LIVE_HOME;
    else process.env.CLAUDE_LIVE_HOME = origHome;
  }
});

test("plistContent escapes & in homeDir path to &amp;", async () => {
  const origHome = process.env.CLAUDE_LIVE_HOME;
  process.env.CLAUDE_LIVE_HOME = "/tmp/a&b";
  try {
    const { plistContent } = await import("../src/setup");
    const p = plistContent("/repo/whatever");
    expect(p).toContain("a&amp;b");
    expect(p).not.toContain("a&b/");
  } finally {
    if (origHome === undefined) delete process.env.CLAUDE_LIVE_HOME;
    else process.env.CLAUDE_LIVE_HOME = origHome;
  }
});

test("launchdPlistPath ends with Library/LaunchAgents/dev.claude-live.plist", async () => {
  const { launchdPlistPath } = await import("../src/setup");
  const p = launchdPlistPath();
  expect(p).toMatch(/Library\/LaunchAgents\/dev\.claude-live\.plist$/);
});

test("plistContentDaily embeds Hour 9, Minute 0, daily-run.ts path, and label", async () => {
  const { plistContentDaily } = await import("../src/setup");
  const appDir = "/tmp/fake-app";
  const p = plistContentDaily(appDir);
  expect(p).toContain("dev.claude-live.daily");
  expect(p).toContain("StartCalendarInterval");
  expect(p).toContain("<integer>9</integer>");
  expect(p).toContain("<integer>0</integer>");
  expect(p).toContain(join(appDir, "src", "daily-run.ts"));
  expect(p).toContain(process.execPath);
});

test("plistContentDaily uses the provided appDir", async () => {
  const { plistContentDaily } = await import("../src/setup");
  const p1 = plistContentDaily("/app/dir/one");
  const p2 = plistContentDaily("/app/dir/two");
  expect(p1).toContain("/app/dir/one");
  expect(p2).toContain("/app/dir/two");
  expect(p1).not.toContain("/app/dir/two");
});

test("launchdDailyPlistPath ends with Library/LaunchAgents/dev.claude-live.daily.plist", async () => {
  const { launchdDailyPlistPath } = await import("../src/setup");
  const p = launchdDailyPlistPath();
  expect(p).toMatch(/Library\/LaunchAgents\/dev\.claude-live\.daily\.plist$/);
});

test("hookCommand with space in repoRoot produces double-quoted parts and isOurs recognizes it", () => {
  const repoRoot = "/path/with spaces/my repo";
  const cmd = hookCommand(repoRoot);
  // Both execPath and repoRoot part must be double-quoted
  expect(cmd).toMatch(/^".*" ".*\/src\/hook\.ts"$/);
  // isOurs must recognize the quoted form
  expect(isOurs(cmd)).toBe(true);
});

test("deployApp copies src, ui, package.json into homeDir/app and returns appDir", () => {
  const fakeRepo = mkdtempSync(join(tmpdir(), "cl-repo-"));
  mkdirSync(join(fakeRepo, "src"), { recursive: true });
  writeFileSync(join(fakeRepo, "src", "server.ts"), "// fake");
  mkdirSync(join(fakeRepo, "ui"), { recursive: true });
  writeFileSync(join(fakeRepo, "ui", "index.html"), "<html/>");
  writeFileSync(join(fakeRepo, "package.json"), '{"name":"test"}');

  const tmpHome = mkdtempSync(join(tmpdir(), "cl-app-"));
  const origHome = process.env.CLAUDE_LIVE_HOME;
  process.env.CLAUDE_LIVE_HOME = tmpHome;
  try {
    const appDir = deployApp(fakeRepo);
    expect(appDir).toBe(join(tmpHome, "app"));
    expect(existsSync(join(appDir, "src", "server.ts"))).toBe(true);
    expect(existsSync(join(appDir, "ui", "index.html"))).toBe(true);
    expect(existsSync(join(appDir, "package.json"))).toBe(true);
  } finally {
    if (origHome === undefined) delete process.env.CLAUDE_LIVE_HOME;
    else process.env.CLAUDE_LIVE_HOME = origHome;
  }
});
