# claude-live

A local dashboard that tracks all your concurrent Claude Code sessions across one or more Claude installs ("instances"), in one place. Shows live status (running / waiting for you / idle / archived), topic, elapsed time, LLM summaries, extracted tasks, global search, an auto-generated bilingual (ES/EN) daily standup with Slack-ready copy, Slack mentions, PR/Linear/artifact links, a session-recovery prompt, and (WIP) a deadlines calendar and notifications. Runs fully local (localhost), no external services required; LLM analysis uses your Claude Code subscription via `claude -p` (no API key needed). Optional tokens enable direct Slack/Linear enrichment.

## Multi-instance support

Auto-detects every Claude install under your home directory:

- `~/.claude` → instance **"personal"**
- `~/.claude-work` → instance **"work"**
- `~/.claude-<anything>` → instance **"anything"** (the folder suffix becomes the instance name)

You pick which instances to track in Settings (⚙). Sessions from all tracked instances appear side by side in the dashboard, filterable by instance. Nothing is hardcoded to specific folder names — any suffix you use is auto-detected.

## Requirements

- macOS
- [Bun](https://bun.sh) ≥ 1.0
- [Claude Code](https://claude.ai/code)

## Install & first run

```bash
git clone <this-repo>
cd claude-live
bun run setup   # detects instances, installs hooks (idempotent + backup), asks language es/en/pt
bun run serve   # opens http://localhost:7777
```

**Safari tip:** File → Add to Dock for a standalone app window.

**Always-on via launchd (recommended):**

```bash
bun src/setup.ts --launchd
```

Note: the launchd copy is deployed to `~/.claude-live/app` (macOS TCC blocks launchd from reading `~/Documents`). Re-run `--launchd` after `git pull` to redeploy.

**Optional tokens** — paste in Settings (⚙) for direct enrichment (values are masked, never logged):

- Slack token: enriches Slack mentions
- Linear token: enriches Linear issues and deadlines

## How it works

1. Hooks in all tracked instances pipe JSON events to `src/hook.ts`, which writes to SQLite at `~/.claude-live/claude-live.db` (WAL).
2. A Bun server on `localhost:7777` (Host-header checked) serves a vanilla-JS dark UI and a JSON API.
3. A sweeper archives sessions whose PID has exited. On Stop, a detached job summarizes the session via `claude -p`.
4. Periodic jobs handle: FTS search index, daily standup generation, Slack/Linear/PR enrichment, deadline extraction.

## Uninstall

```bash
bun src/setup.ts --uninstall
launchctl bootout gui/$UID/dev.claude-live
launchctl bootout gui/$UID/dev.claude-live.daily
rm -rf ~/.claude-live
```

## Development

```bash
bun test                    # unit tests
bun scripts/cdp-verify.ts  # E2E (kill any stale process on ports 7999/9333 first)
```

Zero npm dependencies.

## License

MIT
