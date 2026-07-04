import { test, expect } from "bun:test";
import { readGit, type GitRunner } from "../src/git";

test("readGit: parses git@ URL", async () => {
  const fakeRun: GitRunner = async (args) => {
    if (args.includes("rev-parse")) return "main";
    if (args.includes("get-url")) return "git@github.com:owner/my-repo.git";
    return "";
  };
  const result = await readGit("/some/cwd", fakeRun);
  expect(result.repo).toBe("owner/my-repo");
  expect(result.branch).toBe("main");
});

test("readGit: parses https URL with .git", async () => {
  const fakeRun: GitRunner = async (args) => {
    if (args.includes("rev-parse")) return "main";
    if (args.includes("get-url")) return "https://github.com/owner/my-repo.git";
    return "";
  };
  const result = await readGit("/some/cwd", fakeRun);
  expect(result.repo).toBe("owner/my-repo");
});

test("readGit: parses https URL without .git", async () => {
  const fakeRun: GitRunner = async (args) => {
    if (args.includes("rev-parse")) return "main";
    if (args.includes("get-url")) return "https://github.com/owner/my-repo";
    return "";
  };
  const result = await readGit("/some/cwd", fakeRun);
  expect(result.repo).toBe("owner/my-repo");
});

test("readGit: returns both branch and repo", async () => {
  const fakeRun: GitRunner = async (args) => {
    if (args.includes("rev-parse")) return "develop";
    if (args.includes("get-url")) return "https://github.com/acme/widget.git";
    return "";
  };
  const result = await readGit("/some/cwd", fakeRun);
  expect(result.repo).toBe("acme/widget");
  expect(result.branch).toBe("develop");
});

test("readGit: returns nulls on runner throwing", async () => {
  const fakeRun: GitRunner = async () => { throw new Error("not a git repo"); };
  const result = await readGit("/some/cwd", fakeRun);
  expect(result.repo).toBeNull();
  expect(result.branch).toBeNull();
});

test("readGit: returns nulls on empty/invalid URL", async () => {
  const fakeRun: GitRunner = async (args) => {
    if (args.includes("rev-parse")) return "main";
    if (args.includes("get-url")) return "not-a-url-at-all";
    return "";
  };
  const result = await readGit("/some/cwd", fakeRun);
  expect(result.repo).toBeNull();
  expect(result.branch).toBeNull();
});

test("readGit: args passed as array, not shell-interpolated", async () => {
  const cwd = "/my cwd/with spaces";
  const captured: string[][] = [];
  const fakeRun: GitRunner = async (args) => {
    captured.push([...args]);
    return "main";
  };
  await readGit(cwd, fakeRun);
  const revParseCall = captured.find(a => a.includes("rev-parse"))!;
  expect(revParseCall[0]).toBe("-C");
  expect(revParseCall[1]).toBe(cwd);
});

test("readGit: partial failure — any error returns null/null", async () => {
  let callCount = 0;
  const fakeRun: GitRunner = async (args) => {
    callCount++;
    if (args.includes("rev-parse")) throw new Error("rev-parse failed");
    return "git@github.com:owner/repo.git";
  };
  const result = await readGit("/some/cwd", fakeRun);
  expect(result.repo).toBeNull();
  expect(result.branch).toBeNull();
  // Should not attempt get-url after rev-parse throws
  expect(callCount).toBe(1);
});
