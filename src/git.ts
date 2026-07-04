export type GitRunner = (args: string[]) => Promise<string>;

export const defaultGitRun: GitRunner = async (args: string[]) => {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.trim();
};

function parseRemoteUrl(url: string): string | null {
  if (!url) return null;

  // git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // https://github.com/owner/repo[.git]
  const httpsMatch = url.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

export async function readGit(
  cwd: string,
  run: GitRunner = defaultGitRun
): Promise<{ repo: string | null; branch: string | null }> {
  try {
    const branch = await run(["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
    const remoteUrl = await run(["-C", cwd, "remote", "get-url", "origin"]);
    const repo = parseRemoteUrl(remoteUrl);
    if (!repo) return { repo: null, branch: null };
    return { repo, branch: branch || null };
  } catch {
    return { repo: null, branch: null };
  }
}
