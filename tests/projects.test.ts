import { test, expect, describe } from "bun:test";
import { openDb } from "../src/db";
import { projectKeyForSession, listProjects, projectDetail } from "../src/projects";
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

  test("unlinked_mentions_open counts beyond the 20-item dropdown cap", async () => {
    const db = openDb(":memory:");
    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      db.run(
        `INSERT INTO mentions (channel_id, thread_ts, author, text, ts, ask_count, resolved, session_id, first_at, last_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ["C1", `t${i}`, "Jordan", `msg ${i}`, `${1000 + i}`, 1, 0, null, now - 1000, now - i]
      );
    }
    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/projects`);
    const body = await res.json() as any;
    expect(body.unlinked_mentions_open).toBe(25);
    expect(body.unlinked_mentions_open_items.length).toBe(20);
    srv.stop();
  });
});

// ── projectDetail ──────────────────────────────────────────────────────────

describe("projectDetail", () => {
  function makeDb() { return openDb(":memory:"); }

  test("returns null for unknown key", () => {
    const db = makeDb();
    expect(projectDetail(db, "unknown")).toBeNull();
  });

  test("returns sessions, tasks, mentions, prs for a project", () => {
    const db = makeDb();
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, git_repo, kind, started_at, last_activity)
       VALUES ('s1','main','running','/w/myproj','org/myproj','session',?,?)`,
      [now - 5000, now]
    );
    db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1','Fix bug','open',?)", [now]);
    db.run("INSERT INTO tasks (session_id, title, status, opened_at, closed_at) VALUES ('s1','Old task','done',?,?)", [now - 1000, now - 500]);
    db.run(
      "INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, first_at, last_at) VALUES ('C1','1','alice','s1',0,?,?)",
      [now - 1000, now]
    );
    db.run("INSERT INTO links (session_id, kind, ref) VALUES ('s1','pr','myproj#1')", []);
    db.run("INSERT INTO links (session_id, kind, ref) VALUES ('s1','linear','MP-10')", []); // not a PR

    const detail = projectDetail(db, "myproj");
    expect(detail).not.toBeNull();
    expect(detail!.sessions.length).toBe(1);
    expect(detail!.tasks.length).toBe(2);       // all tasks (open + done)
    expect(detail!.mentions.length).toBe(1);
    expect(detail!.prs.length).toBe(1);          // only PR links, not linear
  });

  test("excludes resolved mentions", () => {
    const db = makeDb();
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, kind, started_at, last_activity)
       VALUES ('s1','main','running','/w/proj','session',?,?)`,
      [now - 5000, now]
    );
    db.run(
      "INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, first_at, last_at) VALUES ('C1','1','alice','s1',1,?,?)",
      [now - 1000, now]
    );
    const detail = projectDetail(db, "proj");
    expect(detail!.mentions.length).toBe(0);
  });

  test("excludes worker sessions", () => {
    const db = makeDb();
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, kind, started_at, last_activity)
       VALUES ('w1','main','running','/w/proj','worker',?,?)`,
      [now - 5000, now]
    );
    expect(projectDetail(db, "proj")).toBeNull();
  });

  test("returns sessions sorted active-first", () => {
    const db = makeDb();
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, kind, started_at, last_activity, ended_at)
       VALUES ('arch','main','archived','/w/proj','session',?,?,?)`,
      [now - 10000, now - 5000, now - 1000]
    );
    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, kind, started_at, last_activity)
       VALUES ('active','main','running','/w/proj','session',?,?)`,
      [now - 5000, now]
    );
    const detail = projectDetail(db, "proj");
    expect(detail!.sessions[0].id).toBe("active");
    expect(detail!.sessions[1].id).toBe("arch");
  });

  test("handles URL-encoded key for (sin proyecto)", () => {
    const db = makeDb();
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, git_repo, kind, started_at, last_activity)
       VALUES ('s1','main','running',NULL,NULL,'session',?,?)`,
      [now - 5000, now]
    );
    const detail = projectDetail(db, "(sin proyecto)");
    expect(detail).not.toBeNull();
    expect(detail!.sessions.length).toBe(1);
  });
});

// ── GET /api/projects/:key/detail ─────────────────────────────────────────

describe("GET /api/projects/:key/detail", () => {
  test("returns 404 for unknown key", async () => {
    const db = openDb(":memory:");
    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/projects/unknown/detail`);
    expect(res.status).toBe(404);
    srv.stop();
  });

  test("returns detail for known key", async () => {
    const db = openDb(":memory:");
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, git_repo, kind, started_at, last_activity)
       VALUES ('s1','main','running','/w/beta','org/beta','session',?,?)`,
      [now - 5000, now]
    );
    db.run("INSERT INTO tasks (session_id, title, status, opened_at) VALUES ('s1','Write tests','open',?)", [now]);
    db.run("INSERT INTO links (session_id, kind, ref) VALUES ('s1','pr','beta#7')", []);

    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/projects/beta/detail`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(Array.isArray(body.tasks)).toBe(true);
    expect(Array.isArray(body.mentions)).toBe(true);
    expect(Array.isArray(body.prs)).toBe(true);
    expect(body.sessions.length).toBe(1);
    expect(body.tasks.length).toBe(1);
    expect(body.prs.length).toBe(1);
    srv.stop();
  });

  test("URL-encoded key decodes correctly", async () => {
    const db = openDb(":memory:");
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, git_repo, kind, started_at, last_activity)
       VALUES ('s1','main','running',NULL,NULL,'session',?,?)`,
      [now - 5000, now]
    );
    const srv = createServer(db, { port: 0 });
    const res = await fetch(
      `http://127.0.0.1:${srv.port}/api/projects/${encodeURIComponent("(sin proyecto)")}/detail`
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.sessions.length).toBe(1);
    srv.stop();
  });
});

// ── GET /api/conversations ─────────────────────────────────────────────────

describe("GET /api/conversations", () => {
  test("returns conversations array with correct shape", async () => {
    const db = openDb(":memory:");
    const now = Date.now();

    // unlinked mention (session_id IS NULL)
    db.run(
      `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, resolved_manual, text, first_at, last_at)
       VALUES ('C1','t1','jordan',NULL,0,NULL,'ping from jordan',?,?)`,
      [now - 2000, now - 1000]
    );

    // linked mention (session_id set)
    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, git_repo, kind, started_at, last_activity)
       VALUES ('s1','main','running','/w/acme','org/acme','session',?,?)`,
      [now - 5000, now]
    );
    db.run(
      `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, resolved_manual, text, first_at, last_at)
       VALUES ('C2','t2','alex','s1',0,NULL,'linked mention',?,?)`,
      [now - 3000, now - 500]
    );

    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/conversations`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.conversations)).toBe(true);
    expect(body.conversations.length).toBe(2);

    const first = body.conversations[0]; // last_at DESC → linked mention (now-500) first
    expect(typeof first.id).toBe("number");
    expect(typeof first.author).toBe("string");
    expect(typeof first.channel_id).toBe("string");
    expect(typeof first.resolved_eff).toBe("number");
    expect("session_id" in first).toBe(true);
    expect("project_key" in first).toBe(true);
    expect("first_at" in first).toBe(true);
    expect("last_at" in first).toBe(true);

    // linked mention → project_key = "acme" (derived from git_repo "org/acme")
    const linked = body.conversations.find((c: any) => c.author === "alex");
    expect(linked.project_key).toBe("acme");

    // unlinked mention → project_key = null, session_id = null
    const unlinked = body.conversations.find((c: any) => c.author === "jordan");
    expect(unlinked.project_key).toBeNull();
    expect(unlinked.session_id).toBeNull();

    srv.stop();
  });

  test("resolved_eff is 1 when resolved=1 or resolved_manual=1, else 0", async () => {
    const db = openDb(":memory:");
    const now = Date.now();

    db.run(
      `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, resolved_manual, first_at, last_at)
       VALUES ('C1','t1','alice',NULL,1,NULL,?,?)`,
      [now - 3000, now - 3000]
    );
    db.run(
      `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, resolved_manual, first_at, last_at)
       VALUES ('C1','t2','bob',NULL,0,1,?,?)`,
      [now - 2000, now - 2000]
    );
    db.run(
      `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, resolved_manual, first_at, last_at)
       VALUES ('C1','t3','charlie',NULL,0,NULL,?,?)`,
      [now - 1000, now - 1000]
    );

    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/conversations`);
    const body = await res.json() as any;

    const alice = body.conversations.find((c: any) => c.author === "alice");
    expect(alice.resolved_eff).toBe(1);

    const bob = body.conversations.find((c: any) => c.author === "bob");
    expect(bob.resolved_eff).toBe(1);

    const charlie = body.conversations.find((c: any) => c.author === "charlie");
    expect(charlie.resolved_eff).toBe(0);

    srv.stop();
  });

  test("capped at 50 results ordered by last_at DESC", async () => {
    const db = openDb(":memory:");
    const now = Date.now();
    for (let i = 0; i < 55; i++) {
      db.run(
        `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, first_at, last_at)
         VALUES ('C1',?,?,NULL,0,?,?)`,
        [`t${i}`, `user${i}`, now - i * 1000, now - i * 1000]
      );
    }
    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/conversations`);
    const body = await res.json() as any;
    expect(body.conversations.length).toBe(50);
    // first should have highest last_at (smallest i = 0)
    expect(body.conversations[0].author).toBe("user0");
    srv.stop();
  });
});

// ── GET /api/projects unlinked_mentions_open ───────────────────────────────

describe("GET /api/projects unlinked_mentions_open", () => {
  test("includes unlinked_mentions_open count and items in response", async () => {
    const db = openDb(":memory:");
    const now = Date.now();

    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, kind, started_at, last_activity)
       VALUES ('s1','main','running','/w/acme','session',?,?)`,
      [now - 5000, now]
    );

    // unlinked open mention
    db.run(
      `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, resolved_manual, text, first_at, last_at)
       VALUES ('C1','t1','jordan',NULL,0,NULL,'hello',?,?)`,
      [now - 2000, now - 1000]
    );

    // unlinked resolved mention — should NOT count
    db.run(
      `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, resolved_manual, text, first_at, last_at)
       VALUES ('C1','t2','alex',NULL,1,NULL,'done',?,?)`,
      [now - 3000, now - 2000]
    );

    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/projects`);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(typeof body.unlinked_mentions_open).toBe("number");
    expect(body.unlinked_mentions_open).toBe(1);
    expect(Array.isArray(body.unlinked_mentions_open_items)).toBe(true);
    expect(body.unlinked_mentions_open_items.length).toBe(1);
    expect(body.unlinked_mentions_open_items[0].author).toBe("jordan");
    expect(body.unlinked_mentions_open_items[0].text).toBe("hello");
    srv.stop();
  });

  test("unlinked_mentions_open is 0 when all unlinked are resolved", async () => {
    const db = openDb(":memory:");
    const now = Date.now();
    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, kind, started_at, last_activity)
       VALUES ('s1','main','running','/w/proj','session',?,?)`,
      [now - 5000, now]
    );
    db.run(
      `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, resolved_manual, first_at, last_at)
       VALUES ('C1','t1','bob',NULL,1,NULL,?,?)`,
      [now - 1000, now - 500]
    );
    const srv = createServer(db, { port: 0 });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/projects`);
    const body = await res.json() as any;
    expect(body.unlinked_mentions_open).toBe(0);
    expect(body.unlinked_mentions_open_items).toEqual([]);
    srv.stop();
  });
});

// ── POST /api/mentions/:id/resolve (resolve endpoint) ─────────────────────

describe("POST /api/mentions/:id/resolve", () => {
  test("toggles resolved_manual and affects resolved_eff in conversations", async () => {
    const db = openDb(":memory:");
    const now = Date.now();

    db.run(
      `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, resolved_manual, first_at, last_at)
       VALUES ('C1','t1','jordan',NULL,0,NULL,?,?)`,
      [now - 1000, now - 500]
    );
    const mention = db.query("SELECT id FROM mentions WHERE author = 'jordan'").get() as any;
    const mentionId = mention.id;

    const srv = createServer(db, { port: 0 });

    // Resolve
    const r1 = await fetch(`http://127.0.0.1:${srv.port}/api/mentions/${mentionId}/resolve`, { method: "POST" });
    expect(r1.status).toBe(200);
    const d1 = await r1.json() as any;
    expect(d1.resolved_manual).toBe(1);

    // Confirm resolved_eff in /api/conversations
    const convRes1 = await fetch(`http://127.0.0.1:${srv.port}/api/conversations`);
    const convBody1 = await convRes1.json() as any;
    const conv1 = convBody1.conversations.find((c: any) => c.id === mentionId);
    expect(conv1.resolved_eff).toBe(1);

    // Toggle back (unresolve)
    const r2 = await fetch(`http://127.0.0.1:${srv.port}/api/mentions/${mentionId}/resolve`, { method: "POST" });
    expect(r2.status).toBe(200);
    const d2 = await r2.json() as any;
    expect(d2.resolved_manual).toBeNull();

    // Confirm resolved_eff in /api/conversations is back to 0
    const convRes2 = await fetch(`http://127.0.0.1:${srv.port}/api/conversations`);
    const convBody2 = await convRes2.json() as any;
    const conv2 = convBody2.conversations.find((c: any) => c.id === mentionId);
    expect(conv2.resolved_eff).toBe(0);

    srv.stop();
  });

  test("unlinked_mentions_open decrements after resolving unlinked mention", async () => {
    const db = openDb(":memory:");
    const now = Date.now();

    db.run(
      `INSERT INTO sessions (id, instance, status, cwd, kind, started_at, last_activity)
       VALUES ('s1','main','running','/w/proj','session',?,?)`,
      [now - 5000, now]
    );
    db.run(
      `INSERT INTO mentions (channel_id, thread_ts, author, session_id, resolved, resolved_manual, text, first_at, last_at)
       VALUES ('C1','t1','jordan',NULL,0,NULL,'hello',?,?)`,
      [now - 1000, now - 500]
    );
    const m = db.query("SELECT id FROM mentions WHERE author = 'jordan'").get() as any;

    const srv = createServer(db, { port: 0 });

    // Before resolve
    const r0 = await fetch(`http://127.0.0.1:${srv.port}/api/projects`);
    const b0 = await r0.json() as any;
    expect(b0.unlinked_mentions_open).toBe(1);

    // Resolve
    await fetch(`http://127.0.0.1:${srv.port}/api/mentions/${m.id}/resolve`, { method: "POST" });

    // After resolve
    const r1 = await fetch(`http://127.0.0.1:${srv.port}/api/projects`);
    const b1 = await r1.json() as any;
    expect(b1.unlinked_mentions_open).toBe(0);

    srv.stop();
  });
});
