import { readFileSync } from "node:fs";

const HARNESS_XML = /^<(task-notification|system-reminder|command-name|command-result)[^>]*>/;

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (part && typeof part === "object" && (part as any).type === "text") {
      const t = (part as any).text;
      if (typeof t === "string") parts.push(t);
    }
  }
  return parts.join(" ");
}

function formatEntry(obj: unknown): string[] {
  if (!obj || typeof obj !== "object") return [];
  const entry = obj as any;
  const result: string[] = [];

  if (entry.type === "user") {
    const text = extractText(entry.message?.content).trim();
    if (!text || HARNESS_XML.test(text)) return [];
    result.push(`U: ${text}`);
  } else if (entry.type === "assistant") {
    const content = entry.message?.content;
    if (!Array.isArray(content)) return [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if ((part as any).type === "text") {
        const t = String((part as any).text ?? "").slice(0, 200);
        if (t) result.push(`A: ${t}`);
      } else if ((part as any).type === "tool_use") {
        const name = (part as any).name ?? "unknown";
        const filePath = (part as any).input?.file_path ?? (part as any).input?.path ?? "";
        result.push(`T: ${name}${filePath ? " " + filePath : ""}`);
      }
    }
  }

  return result;
}

export function readToolUses(
  path: string,
  cap = 200
): { name: string; input: Record<string, unknown> }[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }

  const all: { name: string; input: Record<string, unknown> }[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const entry = obj as any;
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      if ((part as any).type !== "tool_use") continue;
      const name = (part as any).name;
      if (typeof name !== "string") continue;
      const inp = (part as any).input;
      all.push({
        name,
        input:
          inp && typeof inp === "object" && !Array.isArray(inp)
            ? (inp as Record<string, unknown>)
            : {},
      });
    }
  }

  return all.slice(-cap);
}

export function readDigest(path: string, capChars = 8000): string {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return "";
  }

  const formatted: string[][] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const entry = formatEntry(obj);
    if (entry.length > 0) formatted.push(entry);
  }

  // Tail-biased: collect from end backwards until capChars
  const selected: string[][] = [];
  let total = 0;
  for (let i = formatted.length - 1; i >= 0; i--) {
    const entryChars = formatted[i].reduce((s, l) => s + l.length + 1, 0);
    total += entryChars;
    selected.push(formatted[i]);
    if (total >= capChars) break;
  }

  return selected.reverse().flatMap(e => e).join("\n");
}
