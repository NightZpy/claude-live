import { test, expect } from "bun:test";
import { notify } from "../src/notify";

test("notify calls runner with -e arg containing title and body", () => {
  const calls: string[][] = [];
  const runner = (args: string[]) => { calls.push(args); };
  notify("My Session", "waiting for input", runner);
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("-e");
  expect(calls[0][1]).toContain("My Session");
  expect(calls[0][1]).toContain("waiting for input");
  expect(calls[0][1]).toContain("display notification");
});

test("notify escapes special chars in title and body", () => {
  const calls: string[][] = [];
  notify('Title "with quotes"', "Body with 'apostrophe'", (args) => { calls.push(args); });
  // JSON.stringify handles escaping; the arg should not contain raw unescaped quotes
  const expr = calls[0][1];
  expect(expr).toContain("display notification");
  // JSON.stringify wraps in double-quotes and escapes internal quotes
  expect(expr).not.toMatch(/display notification [^"]/); // body arg must start with a quote
});
