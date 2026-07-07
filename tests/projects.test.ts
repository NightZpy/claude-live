import { test, expect, describe } from "bun:test";
import { openDb } from "../src/db";
import { projectKeyForSession, listProjects } from "../src/projects";
import { createServer } from "../src/server";

// ── helpers ────────────────────────────────────────────────────────────────

type SessionOpts = {
  id: string;
  instance?: string;
  status?: string;
  cwd?: string;
  git_repo?: string | null;
  git_branch?: string | null;
  kind?: string;
  last_activity?: number;
  waiting_since?: number | null;
  ended_at?: number | null;
  summary?: string | null;
};

function insertSession(db: any, opts: SessionOpts, now: number) {
  const {
    id, instance = "main", status = "running",
    cwd = "/home/user/work", git_repo = null, git_branch = null,
    kind = "session", last_activity = now, waiting_since = null,
    ended_at = null, summary = null,
  } = opts;

  db.run(
    `INSERT INTO sessions (id, instance, status, cwd, git_repo, git_branch, kind,
       started_at, last_activity, waiting_since, ended_at, summary)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, instance, status, cwd, git_repo, git_branch, kind,
     now - 10000, last_activity, waiting_since, ended_at, summary]
  );
}

// ── projectKeyForSession ───────────────────────────────────────────────────

describe("projectKeyForSession", () => {
  test("uses repo name from git_repo when present", () => {
    const session = { git_repo: "owner/myrepo", cwd: "/some/path" } as any;
    expect(projectKeyForSession(session)).toBe("myrepo");
  });

  test("uses cwd basename when git_repo is null", () => {
    const session = { git_repo: null, cwd: "/home/user/myproject" } as any;
    expect(projectKeyForSession(session)).toBe("myproject");
  });

  test("returns fallback when both git_repo and cwd are missing", () => {
    const session = { git_repo: null, cwd: null } as any;
    expect(projectKeyForSession(session)).toBe("(sin proyecto)");
  });

  test("returns fallback when cwd is empty string", () => {
    const session = { git_repo: null, cwd: "" } as any;
    expect(projectKeyForSession(session)).toBe("(sin proyecto)");
  });

  test("handles owner/repo.git — strips correctly", () => {
    const session = { git_repo: "org/backend", cwd: "/work/backend" } as any;
    expect(projectKeyForSession(session)).toBe("backend");
  });
});

// ── listProjects ───────────────────────────────────────────────────────────

describe("listProjects", () => {
  function makeDb() {
    return openDb(":memory:");
  }

  test("groups sessions by git_repo name vs cwd basename", () => {
    const db = makeDb();
    const now = Date.now();

    // Project A: two sessions with git_repo owner/alpha
    insertSession(db, { id: "a1", git_repo: "owner/alpha", cwd: "/w/alpha" }, now);
    insertSession(db, { id: "a2", git_repo: "owner/alpha", cwd: "/w/alpha" }, now);

    // Project B: one session with git_repo null — falls back to cwd basename "beta"
    insertSession(db, { id: "b1", git_repo: null, cwd: "/home/dev/beta" }, now);

    const projects = listProjects(db, now);
    const keys = projects.map(p => p.key);
    expect(keys).toContain("alpha");
    expect(keys).toContain("beta");

    const alpha = projects.find(p => p.key === "alpha")!;
    expect(alpha.sessions_active).toBe(2);

    const beta = projects.find(p => p.key === "beta")!;
    expect(beta.sessions_active).toBe(1);
  });

  test("excludes worker sessions from all counts", () => {
    const db = makeDb();
    const now = Date.now();

    insertSession(db, { id: "real1", git_repo: "org/proj", cwd: "/w/proj" }, now);
    insertSession(db, { id: "worker1", kind: "worker", git_repo: "org/proj", cwd: "/w/proj" }, now);

    const projects = listProjects(db, now);
    const proj = projects.find(p => p.key === "proj")!;
    expect(proj).toBeDefined();
    expect(proj.sessions_active).toBe(1); // worker not counted
  });

  test("counts waiting_input sessions separately", () => {
    const db = makeDb();
    const now = Date.now();
    const wt = now - 5000;

    insertSession(db, { id: "r1", git_repo: "org/gamma", status: "running", cwd: "/w/gamma" }, now);
    insertSession(db, { id: "w1", git_repo: "org/gamma", status: "waiting_input", cwd: "/w/gamma", waiting_since: wt }, now);
    insertSession(db, { id: "w2", git_repo: "org/gamma", status: "waiting_input", cwd: "/w/gamma", waiting_since: wt }, now);

    const projects = listProjects(db, now);
    const gamma = projects.find(p => p.key === "gamma")!;
    expect(gamma.sessions_active).toBe(1);       // running only
    expect(gamma.sessions_waiting).toBe(2);
  });

  test("counts sessions archived today", () => {
    const db = makeDb();
    const now = Date.now();
    const startOfDay = now - (now % 86400000);

    // Archived today (ended_at > startOfDay)
    insertSession(db, {
      id: "arch1", git_repo: "org/delta", status: "archived",
      ended_at: startOfDay + 1000, cwd: "/w/delta",
    }, now);

    // Archived yesterday — should NOT count
    insertSession(db, {
      id: "arch2", git_repo: "org/delta", status: "archived",
      ended_at: startOfDay - 1000, cwd: "/w/delta",
    }, now);

    // Active session so the project shows up
    insertSession(db, { id: "r1", git_repo: "org/delta", status: "running", cwd: "/w/delta" }, now);

    const projects = listProjects(db, now);
    const delta = projects.find(p => p.key === "delta")!;
    expect(delta.sessions_archived_today).toBe(1);
  });

  test("counts open and blocked tasks", () => {
    const db = makeDb();
    const now = Date.now();

    insertSession(db, { id: "s1", git_repo: "org/epsilon", cwd: "/w/epsilon" }, now);
    db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1','Task A','open',?)", [now]);
    db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1','Task B','in_progress',?)", [now]);
    db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1','Task C','blocked',?)", [now]);
    db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1','Task D','done',?)", [now]);

    const projects = listProjects(db, now);
    const eps = projects.find(p => p.key === "epsilon")!;
    expect(eps.open_tasks).toBe(2);    // open + in_progress
    expect(eps.blocked_tasks).toBe(1);
  });

  test("counts open mentions", () => {
    const db = makeDb();
    const now = Date.now();

    insertSession(db, { id: "s1", git_repo: "org/zeta", cwd: "/w/zeta" }, now);
    db.run(
      "INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, first_at, last_at) VALUES ('C1','1','alice','s1',0,?,?)",
      [now - 1000, now]
    );
    db.run(
      "INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, first_at, last_at) VALUES ('C1','2','bob','s1',1,?,?)",
      [now - 2000, now]   // resolved — should not count
    );

    const projects = listProjects(db, now);
    const zeta = projects.find(p => p.key === "zeta")!;
    expect(zeta.mentions_open).toBe(1);
  });

  test("counts distinct open PR links", () => {
    const db = makeDb();
    const now = Date.now();

    insertSession(db, { id: "s1", git_repo: "org/eta", cwd: "/w/eta" }, now);
    db.run("INSERT INTO links (session_id, kind, ref) VALUES ('s1','pr','eta#1')", []);
    db.run("INSERT INTO links (session_id, kind, ref) VALUES ('s1','pr','eta#2')", []);
    db.run("INSERT INTO links (session_id, kind, ref) VALUES ('s1','linear','ETA-10')", []); // not PR

    const projects = listProjects(db, now);
    const eta = projects.find(p => p.key === "eta")!;
    expect(eta.prs_open).toBe(2);
  });

  test("sorts: waiting_input projects first, then by last_activity DESC", () => {
    const db = makeDb();
    const now = Date.now();

    // Project "late" has only running sessions, later activity
    insertSession(db, { id: "l1", git_repo: "org/late", status: "running", cwd: "/w/late", last_activity: now }, now);

    // Project "early" has waiting session, earlier activity
    insertSession(db, {
      id: "e1", git_repo: "org/early", status: "waiting_input", cwd: "/w/early",
      last_activity: now - 100000, waiting_since: now - 50000,
    }, now);

    // Project "mid" — running, middle activity
    insertSession(db, { id: "m1", git_repo: "org/mid", status: "running", cwd: "/w/mid", last_activity: now - 1000 }, now);

    const projects = listProjects(db, now);
    const keys = projects.map(p => p.key);
    // "early" must be first (has waiting sessions)
    expect(keys[0]).toBe("early");
    // "late" must come before "mid" (higher last_activity)
    const lateIdx = keys.indexOf("late");
    const midIdx = keys.indexOf("mid");
    expect(lateIdx).toBeLessThan(midIdx);
  });

  test("latest_summary from most recent active session", () => {
    const db = makeDb();
    const now = Date.now();

    insertSession(db, {
      id: "s1", git_repo: "org/theta", status: "running",
      cwd: "/w/theta", last_activity: now - 5000, summary: "older summary",
    }, now);
    insertSession(db, {
      id: "s2", git_repo: "org/theta", status: "running",
      cwd: "/w/theta", last_activity: now, summary: "newer summary",
    }, now);

    const projects = listProjects(db, now);
    const theta = projects.find(p => p.key === "theta")!;
    expect(theta.latest_summary).toBe("newer summary");
  });

  test("null git_repo sessions group by cwd basename", () => {
    const db = makeDb();
    const now = Date.now();

    insertSession(db, { id: "n1", git_repo: null, cwd: "/dev/noproj" }, now);
    insertSession(db, { id: "n2", git_repo: null, cwd: "/other/noproj" }, now);

    const projects = listProjects(db, now);
    const proj = projects.find(p => p.key === "noproj")!;
    expect(proj).toBeDefined();
    expect(proj.sessions_active).toBe(2);
  });
});

// ── server endpoint ────────────────────────────────────────────────────────

describe("GET /api/projects", () => {
  test("returns projects array with correct shape", async () => {
    const db = openDb(":memory:");
    const now = Date.now();

    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, git_repo, kind, started_at, last_activity)
       VALUES ('s1','main','running','/w/proj','org/proj','session',?,?)`,
      [now - 5000, now]
    );

    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/projects`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.projects.length).toBeGreaterThan(0);

    const p = body.projects[0];
    expect(typeof p.key).toBe("string");
    expect(typeof p.name).toBe("string");
    expect(typeof p.sessions_active).toBe("number");
    expect(typeof p.sessions_waiting).toBe("number");
    expect(typeof p.sessions_archived_today).toBe("number");
    expect(typeof p.open_tasks).toBe("number");
    expect(typeof p.blocked_tasks).toBe("number");
    expect(typeof p.mentions_open).toBe("number");
    expect(typeof p.prs_open).toBe("number");
    srv.stop();
  });
});
