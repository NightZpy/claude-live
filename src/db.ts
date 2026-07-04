import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dbPath, homeDir } from "./config";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  instance TEXT NOT NULL,
  name TEXT,
  cwd TEXT,
  transcript_path TEXT,
  pid INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  kind TEXT DEFAULT 'session',
  started_at INTEGER,
  last_activity INTEGER,
  waiting_since INTEGER,
  ended_at INTEGER,
  archived_reason TEXT,
  last_prompt TEXT,
  summary TEXT,
  summary_next TEXT,
  summary_at INTEGER
);
CREATE TABLE IF NOT EXISTS session_files (
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  change_kind TEXT,
  ts INTEGER,
  PRIMARY KEY (session_id, path)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  opened_at INTEGER,
  closed_at INTEGER,
  UNIQUE(session_id, title)
);
CREATE TABLE IF NOT EXISTS _fts_session_rows (
  session_id TEXT PRIMARY KEY,
  fts_rowid INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS daily (
  date TEXT PRIMARY KEY,
  yesterday_md TEXT,
  today_md TEXT,
  blockers_md TEXT,
  generated_at INTEGER
);
CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  channel_name TEXT,
  thread_ts TEXT NOT NULL,
  author TEXT NOT NULL,
  author_id TEXT,
  participants TEXT,
  text TEXT,
  ts TEXT,
  ask_count INTEGER NOT NULL DEFAULT 1,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_manual INTEGER,
  session_id TEXT,
  first_at INTEGER,
  last_at INTEGER,
  UNIQUE(channel_id, thread_ts, author)
);
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  text TEXT,
  ts TEXT NOT NULL,
  status TEXT,
  session_id TEXT,
  created_at INTEGER,
  UNIQUE(channel, ts)
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT,
  url TEXT,
  meta TEXT,
  UNIQUE(session_id, kind, ref)
);
CREATE TABLE IF NOT EXISTS deadlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT,
  due_at INTEGER,
  estimate_hours REAL,
  instance TEXT,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  confidence REAL DEFAULT 1.0,
  url TEXT,
  manual_override INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER,
  UNIQUE(source, ref)
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status, last_activity);
CREATE INDEX IF NOT EXISTS idx_mentions_resolved ON mentions(resolved, last_at);
CREATE INDEX IF NOT EXISTS idx_links_session ON links(session_id);
CREATE INDEX IF NOT EXISTS idx_deadlines_due ON deadlines(status, due_at);
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(session_id UNINDEXED, kind UNINDEXED, content);
`;

const TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS fts_sessions_ai AFTER INSERT ON sessions BEGIN
    INSERT INTO search_fts(session_id, kind, content) VALUES (
      NEW.id, 'session',
      COALESCE(NEW.name,'') || ' ' || COALESCE(NEW.cwd,'') || ' ' ||
      COALESCE(NEW.last_prompt,'') || ' ' || COALESCE(NEW.summary,'')
    );
    INSERT INTO _fts_session_rows(session_id, fts_rowid) VALUES (NEW.id, last_insert_rowid())
    ON CONFLICT(session_id) DO UPDATE SET fts_rowid = excluded.fts_rowid;
  END`,
  `CREATE TRIGGER IF NOT EXISTS fts_sessions_au AFTER UPDATE ON sessions BEGIN
    DELETE FROM search_fts WHERE rowid = (SELECT fts_rowid FROM _fts_session_rows WHERE session_id = OLD.id);
    INSERT INTO search_fts(session_id, kind, content) VALUES (
      NEW.id, 'session',
      COALESCE(NEW.name,'') || ' ' || COALESCE(NEW.cwd,'') || ' ' ||
      COALESCE(NEW.last_prompt,'') || ' ' || COALESCE(NEW.summary,'')
    );
    INSERT INTO _fts_session_rows(session_id, fts_rowid) VALUES (NEW.id, last_insert_rowid())
    ON CONFLICT(session_id) DO UPDATE SET fts_rowid = excluded.fts_rowid;
  END`,
  `CREATE TRIGGER IF NOT EXISTS fts_files_ai AFTER INSERT ON session_files BEGIN
    INSERT INTO search_fts(session_id, kind, content) VALUES (NEW.session_id, 'file', NEW.path);
  END`,
  `CREATE TRIGGER IF NOT EXISTS fts_events_ai AFTER INSERT ON events BEGIN
    INSERT INTO search_fts(session_id, kind, content) VALUES (NEW.session_id, 'event', COALESCE(NEW.detail,''));
  END`,
];

export function openDb(path: string = dbPath()): Database {
  if (path !== ":memory:") mkdirSync(homeDir(), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 3000;");
  db.exec(SCHEMA);
  for (const t of TRIGGERS) db.exec(t);
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN kind TEXT DEFAULT 'session'");
  } catch {}
  try {
    db.exec("ALTER TABLE sessions ADD COLUMN summary_at INTEGER");
  } catch {}
  const guardedCols: [string, string][] = [
    ["mentions", "ask_count INTEGER NOT NULL DEFAULT 1"],
    ["mentions", "resolved INTEGER NOT NULL DEFAULT 0"],
    ["mentions", "resolved_manual INTEGER"],
    ["mentions", "session_id TEXT"],
    ["mentions", "participants TEXT"],
    ["mentions", "first_at INTEGER"],
    ["mentions", "last_at INTEGER"],
    ["signals", "session_id TEXT"],
    ["links", "title TEXT"],
    ["links", "url TEXT"],
    ["links", "meta TEXT"],
    ["sessions", "git_repo TEXT"],
    ["sessions", "git_branch TEXT"],
    ["tasks", "blocked_on TEXT"],
    ["tasks", "context TEXT"],
    ["daily", "yesterday_md_en TEXT"],
    ["daily", "today_md_en TEXT"],
    ["daily", "blockers_md_en TEXT"],
  ];
  for (const [table, colDef] of guardedCols) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`); } catch {}
  }
  return db;
}

export function addEvent(db: Database, sessionId: string, ts: number, kind: string, detail: string): void {
  db.run("INSERT INTO events (session_id, ts, kind, detail) VALUES (?,?,?,?)", [sessionId, ts, kind, detail]);
}
