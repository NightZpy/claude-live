import { test, expect } from "bun:test";
import { join } from "node:path";
import { readDigest } from "../src/transcript";

const FIXTURE = join(import.meta.dir, "fixtures/transcript/sample.jsonl");

test("returns empty string for missing file", () => {
  expect(readDigest("/nonexistent/path/to/file.jsonl")).toBe("");
});

test("tolerates malformed lines without throwing", () => {
  expect(() => readDigest(FIXTURE)).not.toThrow();
});

test("skips <task-notification> user messages", () => {
  const digest = readDigest(FIXTURE);
  expect(digest).not.toContain("<task-notification>");
  expect(digest).not.toContain("Some scheduled task fired");
});

test("includes regular user messages as U: prefix", () => {
  const digest = readDigest(FIXTURE);
  expect(digest).toContain("U: Please refactor the auth module");
  expect(digest).toContain("U: Also update the tests");
  expect(digest).toContain("U: Looks good, can you also run the tests?");
});

test("includes assistant text as A: prefix truncated at 200 chars", () => {
  const digest = readDigest(FIXTURE);
  expect(digest).toContain("A: I'll start by examining the current auth module structure");
  expect(digest).toContain("A: Let me edit the auth file and then update the tests.");
});

test("includes tool_use as T: name /path", () => {
  const digest = readDigest(FIXTURE);
  expect(digest).toContain("T: Edit /src/auth.ts");
  expect(digest).toContain("T: Bash");
});

test("output is in chronological order", () => {
  const digest = readDigest(FIXTURE);
  const uRefactor = digest.indexOf("U: Please refactor");
  const aExamine = digest.indexOf("A: I'll start");
  const uTests = digest.indexOf("U: Also update");
  expect(uRefactor).toBeLessThan(aExamine);
  expect(aExamine).toBeLessThan(uTests);
});

test("tail-biased: small capChars returns only tail entries", () => {
  // Only allow ~50 chars — should get only the last entry
  const digest = readDigest(FIXTURE, 50);
  // Should NOT contain the early entries
  expect(digest).not.toContain("U: Please refactor the auth module");
  // Should contain something from the tail
  expect(digest.length).toBeGreaterThan(0);
});

test("returns empty string for empty file", () => {
  const { writeFileSync, unlinkSync } = require("node:fs");
  const tmpPath = "/tmp/empty-transcript-test.jsonl";
  writeFileSync(tmpPath, "");
  expect(readDigest(tmpPath)).toBe("");
  unlinkSync(tmpPath);
});

test("handles user message with plain string content", () => {
  const { writeFileSync, unlinkSync } = require("node:fs");
  const tmpPath = "/tmp/plain-string-transcript-test.jsonl";
  writeFileSync(tmpPath, JSON.stringify({
    type: "user",
    message: { content: "plain string prompt" }
  }) + "\n");
  const digest = readDigest(tmpPath);
  expect(digest).toBe("U: plain string prompt");
  unlinkSync(tmpPath);
});

test("truncates long assistant text to 200 chars", () => {
  const { writeFileSync, unlinkSync } = require("node:fs");
  const tmpPath = "/tmp/long-assistant-transcript-test.jsonl";
  const longText = "x".repeat(300);
  writeFileSync(tmpPath, JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: longText }] }
  }) + "\n");
  const digest = readDigest(tmpPath);
  expect(digest).toBe("A: " + "x".repeat(200));
  unlinkSync(tmpPath);
});
