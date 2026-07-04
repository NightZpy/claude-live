import { readdirSync, existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import type { Instance } from "./config";
import { saveConfig, loadConfig, homeDir } from "./config";

export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PostToolUse",
  "Stop",
  "Notification",
  "SessionEnd",
] as const;

type HookEvent = (typeof HOOK_EVENTS)[number];
type HookEntry = { type: "command"; command: string; timeout: number };
type HookGroup = { matcher?: string; hooks: HookEntry[] };
type HooksMap = Partial<Record<HookEvent, HookGroup[]>>;
type Settings = { hooks?: HooksMap; [key: string]: unknown };

export function detectInstances(home: string): Instance[] {
  const entries = readdirSync(home, { withFileTypes: true });
  const instances: Instance[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const n = entry.name;
    if (n !== ".claude" && !n.startsWith(".claude-")) continue;
    if (n === ".claude-live") continue;
    const dir = join(home, n);
    const hasSettings = existsSync(join(dir, "settings.json"));
    const hasProjects = existsSync(join(dir, "projects"));
    if (!hasSettings && !hasProjects) continue;
    const suffix = n === ".claude" ? "" : n.slice(".claude-".length);
    instances.push({ dir, name: suffix === "" ? "personal" : suffix });
  }
  return instances;
}

export function hookCommand(repoRoot: string): string {
  return `"${process.execPath}" "${repoRoot}/src/hook.ts"`;
}

export function isOurs(command: string): boolean {
  return (
    command.includes("claude-live") ||
    command.endsWith("/src/hook.ts") ||
    command.endsWith('/src/hook.ts"')
  );
}

function hasOurHook(groups: HookGroup[]): boolean {
  return groups.some(g => g.hooks?.some(h => typeof h.command === "string" && isOurs(h.command)));
}

function parseSettings(settingsPath: string): Settings {
  const raw = readFileSync(settingsPath, "utf8");
  if (raw.trim() === "") return {};
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `${settingsPath}: settings.json must be a JSON object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
    );
  }
  return parsed as Settings;
}

export function installHooks(
  settingsPath: string,
  repoRoot: string,
): { installed: string[]; skipped: string[] } {
  let settings: Settings = {};
  if (existsSync(settingsPath)) {
    settings = parseSettings(settingsPath);
    const bakPath = settingsPath + ".claude-live.bak";
    if (!existsSync(bakPath)) {
      writeFileSync(bakPath, readFileSync(settingsPath));
    }
  }

  if (!settings.hooks) settings.hooks = {};

  const cmd = hookCommand(repoRoot);
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const event of HOOK_EVENTS) {
    const rawGroups = settings.hooks[event];
    if (rawGroups !== undefined && !Array.isArray(rawGroups)) {
      skipped.push(event);
      continue;
    }
    const groups = rawGroups ?? [];
    if (hasOurHook(groups)) {
      skipped.push(event);
      continue;
    }
    const group: HookGroup = { hooks: [{ type: "command", command: cmd, timeout: 10 }] };
    settings.hooks[event] = [...groups, group];
    installed.push(event);
  }

  if (installed.length > 0) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
  return { installed, skipped };
}

export function uninstallHooks(settingsPath: string): number {
  if (!existsSync(settingsPath)) return 0;
  const settings: Settings = parseSettings(settingsPath);
  if (!settings.hooks) return 0;

  let count = 0;
  const hooksMap = settings.hooks;

  for (const event of HOOK_EVENTS) {
    const groups = hooksMap[event];
    if (!Array.isArray(groups)) continue;
    const kept = groups.filter(
      g => !g.hooks?.some(h => typeof h.command === "string" && isOurs(h.command)),
    );
    count += groups.length - kept.length;
    if (kept.length === 0) {
      delete hooksMap[event];
    } else {
      hooksMap[event] = kept;
    }
  }

  if (Object.keys(hooksMap).length === 0) {
    delete settings.hooks;
  }

  if (count > 0) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
  return count;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function launchdPlistPath(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, "Library", "LaunchAgents", "dev.claude-live.plist");
}

export function deployApp(repoRoot: string): string {
  const appDir = join(homeDir(), "app");
  mkdirSync(appDir, { recursive: true });
  cpSync(join(repoRoot, "src"), join(appDir, "src"), { recursive: true, force: true });
  cpSync(join(repoRoot, "ui"), join(appDir, "ui"), { recursive: true, force: true });
  cpSync(join(repoRoot, "package.json"), join(appDir, "package.json"), { force: true });
  return appDir;
}

export function plistContent(_repoRoot: string): string {
  const config = loadConfig();
  const appDir = join(homeDir(), "app");
  const serverPath = join(appDir, "src", "server.ts");
  const logPath = join(homeDir(), "server.log");

  const hasPath = !!config.claudePath;
  const hasConfigDir = !!config.claudeConfigDir;
  const envBlock = (hasPath || hasConfigDir)
    ? `\n  <key>EnvironmentVariables</key>\n  <dict>${
        hasPath ? `\n    <key>PATH</key>\n    <string>${xmlEscape(config.claudePath!)}</string>` : ""
      }${
        hasConfigDir ? `\n    <key>CLAUDE_CONFIG_DIR</key>\n    <string>${xmlEscape(config.claudeConfigDir!)}</string>` : ""
      }\n  </dict>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.claude-live</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(serverPath)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>${envBlock}
</dict>
</plist>`;
}

export function launchdDailyPlistPath(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, "Library", "LaunchAgents", "dev.claude-live.daily.plist");
}

export function plistContentDaily(appDir: string): string {
  const dailyRunPath = join(appDir, "src", "daily-run.ts");
  const logPath = join(homeDir(), "daily.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.claude-live.daily</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(process.execPath)}</string>
    <string>${xmlEscape(dailyRunPath)}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${xmlEscape(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(logPath)}</string>
</dict>
</plist>`;
}

export function installDailyCron(repoRoot: string): string {
  const appDir = deployApp(repoRoot);
  const plistPath = launchdDailyPlistPath();
  const content = plistContentDaily(appDir);
  writeFileSync(plistPath, content);

  const uid = process.getuid?.();
  try {
    if (uid !== undefined) {
      execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
    } else {
      execFileSync("launchctl", ["load", "-w", plistPath]);
    }
  } catch {
    execFileSync("launchctl", ["load", "-w", plistPath]);
  }

  return plistPath;
}

export function installLaunchd(repoRoot: string): string {
  deployApp(repoRoot);
  const plistPath = launchdPlistPath();
  const content = plistContent(repoRoot);
  writeFileSync(plistPath, content);

  const uid = process.getuid?.();
  try {
    if (uid !== undefined) {
      execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath]);
    } else {
      execFileSync("launchctl", ["load", "-w", plistPath]);
    }
  } catch {
    execFileSync("launchctl", ["load", "-w", plistPath]);
  }

  return plistPath;
}

function defaultWhich(cmd: string): string | null {
  try {
    const result = Bun.spawnSync(["which", cmd], { stdout: "pipe" });
    if (result.exitCode !== 0) return null;
    const out = new TextDecoder().decode(result.stdout).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function resolveClaudeBin(
  whichRunner: (cmd: string) => string | null = defaultWhich
): string {
  const found = whichRunner("claude");
  if (found) return found;
  const home = process.env.HOME ?? "";
  const candidates = [
    `${home}/.local/bin/claude`,
    `${home}/.claude/local/claude`,
    `/opt/homebrew/bin/claude`,
    `/usr/local/bin/claude`,
  ];
  for (const p of candidates) {
    try { statSync(p); return p; } catch { /* not found */ }
  }
  return "claude";
}

export function buildAugmentedPath(claudeBin: string): string {
  const HOME = process.env.HOME ?? "";
  const segments: string[] = [
    dirname(claudeBin),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    `${HOME}/.local/bin`,
    `${HOME}/.bun/bin`,
  ];

  try {
    const result = Bun.spawnSync(["which", "node"], { stdout: "pipe" });
    if (result.exitCode === 0) {
      const nodeDir = dirname(new TextDecoder().decode(result.stdout).trim());
      if (nodeDir) segments.push(nodeDir);
    }
  } catch {
    // silently skip
  }

  if (process.env.PATH) segments.push(process.env.PATH);

  // Dedupe: first occurrence wins
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const seg of segments) {
    // split on : in case PATH itself contains multiple entries
    for (const part of seg.split(":")) {
      if (part && !seen.has(part)) {
        seen.add(part);
        deduped.push(part);
      }
    }
  }
  return deduped.join(":");
}

export type SpawnRunner = (
  cmd: string[],
  env: Record<string, string>
) => { stdout: string; stderr: string };

export function resolveClaudeConfigDir(
  claudeBin: string,
  instances: Instance[],
  augmentedPath: string,
  runner?: SpawnRunner
): string {
  // Build candidates list (deduped, first occurrence wins)
  const seen = new Set<string>();
  const candidates: string[] = [];
  const tryAdd = (dir: string) => {
    if (dir && !seen.has(dir)) { seen.add(dir); candidates.push(dir); }
  };

  if (process.env.CLAUDE_CONFIG_DIR) tryAdd(process.env.CLAUDE_CONFIG_DIR);
  for (const inst of instances) tryAdd(inst.dir);
  tryAdd(`${process.env.HOME ?? ""}/.claude`);

  const defaultRun: SpawnRunner = (cmd, envVars) => {
    const result = Bun.spawnSync(cmd, {
      env: envVars,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    });
    return {
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  };

  const run = runner ?? defaultRun;

  for (const candidate of candidates) {
    const result = run(
      [claudeBin, "-p", "--model", "claude-haiku-4-5-20251001", "--max-turns", "1", "ok"],
      {
        ...(process.env as Record<string, string>),
        CLAUDE_CONFIG_DIR: candidate,
        CLAUDE_LIVE_IGNORE: "1",
        PATH: augmentedPath,
      }
    );
    const combined = result.stdout + result.stderr;
    const lower = combined.toLowerCase();
    if (!lower.includes("not logged in") && !combined.includes("Please run /login")) {
      return candidate;
    }
  }

  return process.env.CLAUDE_CONFIG_DIR ?? `${process.env.HOME ?? ""}/.claude`;
}

// CLI wizard — only runs when executed directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const flagIdx = (f: string) => args.indexOf(f);
  const langArg = flagIdx("--lang") >= 0 ? args[flagIdx("--lang") + 1] : undefined;
  const yes = args.includes("--yes");
  const uninstall = args.includes("--uninstall");
  const launchd = args.includes("--launchd");

  const home = process.env.HOME ?? "";
  const instances = detectInstances(home);

  if (uninstall) {
    let total = 0;
    for (const inst of instances) {
      const sp = join(inst.dir, "settings.json");
      total += uninstallHooks(sp);
    }
    console.log(`Removed ${total} hook group(s).`);
    process.exit(0);
  }

  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let confirmed: Instance[] = [];
  if (yes) {
    confirmed = instances;
  } else {
    console.log("Detected Claude instances:");
    instances.forEach((i, idx) => console.log(`  ${idx + 1}. ${i.name} (${i.dir})`));
    const ans = await rl.question("Install hooks in all of the above? [Y/n] ");
    const a1 = ans.trim().toLowerCase();
    let doInstall: boolean;
    if (a1 === "" || a1 === "y" || a1 === "yes") {
      doInstall = true;
    } else if (a1 === "n" || a1 === "no") {
      doInstall = false;
    } else {
      const ans2 = await rl.question("Please enter y or n: ");
      const a2 = ans2.trim().toLowerCase();
      doInstall = a2 === "" || a2 === "y" || a2 === "yes";
    }
    confirmed = doInstall ? instances : [];
  }

  let lang: "es" | "en" | "pt" = "es";
  if (langArg === "en" || langArg === "pt") lang = langArg;
  else if (langArg === "es") lang = "es";
  else if (!yes) {
    const pick = await rl.question("Language [es/en/pt] (default: es): ");
    const t = pick.trim().toLowerCase();
    if (t === "en" || t === "pt" || t === "es") lang = t;
  }

  rl.close();

  for (const inst of confirmed) {
    const sp = join(inst.dir, "settings.json");
    try {
      const result = installHooks(sp, join(import.meta.dir, ".."));
      console.log(`${inst.name}: installed ${result.installed.length}, skipped ${result.skipped.length}`);
    } catch (err) {
      console.log(`${inst.dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const cfg = loadConfig();
  cfg.language = lang;
  cfg.instances = confirmed;
  cfg.claudeBin = resolveClaudeBin();
  const augPath = buildAugmentedPath(cfg.claudeBin);
  cfg.claudePath = augPath;
  cfg.claudeConfigDir = resolveClaudeConfigDir(cfg.claudeBin, cfg.instances, augPath);
  saveConfig(cfg);

  if (launchd) {
    const plistPath = installLaunchd(join(import.meta.dir, ".."));
    const dailyPlistPath = installDailyCron(join(import.meta.dir, ".."));
    const appDir = join(homeDir(), "app");
    console.log(`\nLaunchd agent installed: ${plistPath}`);
    console.log(`Daily cron installed:    ${dailyPlistPath}`);
    console.log(`Runtime deployed to:     ${appDir}`);
    console.log(`Re-run setup --launchd to refresh the deployed copy.`);
  }

  console.log("\nNext steps:");
  console.log("  Start server: bun run src/server.ts");
  console.log("  Open:        http://localhost:7777");
  console.log("  Add to Dock: open http://localhost:7777 in Safari → File → Add to Dock");
}
