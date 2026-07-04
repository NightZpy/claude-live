import { openDb } from "./db";
import { generateDaily } from "./daily";
import { defaultRunner } from "./summarizer";
import { loadConfig } from "./config";

const db = openDb();
const cfg = loadConfig();
await generateDaily(db, defaultRunner, cfg.language, Date.now());
process.exit(0);
