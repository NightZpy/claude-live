import { openDb } from "./db";
import { generateDaily } from "./daily";
import { defaultRunner } from "./summarizer";
import { loadConfig } from "./config";
import { llmAllowed } from "./llm-gate";

const db = openDb();
const cfg = loadConfig();
const now = Date.now();

const { allowed } = llmAllowed(db, cfg, now);
if (!allowed) process.exit(0);

await generateDaily(db, defaultRunner, cfg.language, now, cfg);
process.exit(0);
