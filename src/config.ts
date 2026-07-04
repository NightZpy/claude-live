import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

export type Instance = { dir: string; name: string };
export type Config = {
  language: "es" | "en" | "pt";
  port: number;
  instances: Instance[];
  slackChannelsAlerts?: string[];
  slackChannelsDeploys?: string[];
  notifyWaiting?: boolean;
  summariesAuto?: boolean;
  dailyAuto?: boolean;
  slackToken?: string;
  linearToken?: string;
};

export const DEFAULT_CONFIG: Config = {
  language: "es",
  port: 7777,
  instances: [],
  notifyWaiting: true,
  slackChannelsAlerts: [],
  slackChannelsDeploys: [],
  summariesAuto: true,
  dailyAuto: true,
  slackToken: "",
};

export function homeDir(): string {
  return process.env.CLAUDE_LIVE_HOME ?? join(process.env.HOME ?? "", ".claude-live");
}
export function dbPath(): string {
  return join(homeDir(), "claude-live.db");
}
export function configPath(): string {
  return join(homeDir(), "config.json");
}

export function loadConfig(): Config {
  try {
    const raw = readFileSync(configPath(), "utf8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(c: Config): void {
  mkdirSync(homeDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(c, null, 2) + "\n");
}
