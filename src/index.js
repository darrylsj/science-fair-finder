// Science Fair Finder - Cloudflare Worker
//
// Two jobs:
//   1. Serve the website files in /public (Cloudflare does this automatically).
//   2. Answer /api/... requests by passing them to the FairRoom database object below.

import { DurableObject } from "cloudflare:workers";

// Codes used ONLY while the real secrets are not set (test mode, fake data).
const DEMO_JUDGE_CODE = "judge-demo";
const DEMO_ADMIN_CODE = "admin-demo";

const MAX_STUDENTS_PER_EVENT = 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const room = env.FAIR.get(env.FAIR.idFromName("gsp"));
      return room.fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function clean(value, maxLength) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

// Compare two strings without leaking how many characters matched.
function sameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class FairRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        name TEXT NOT NULL,
        grade TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        section TEXT NOT NULL DEFAULT '',
        table_id TEXT,
        checked_in_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS students_event ON students (event);
    `);
    // Added later: who did the check-in (several people can run the desk at once).
    try {
      this.sql.exec("ALTER TABLE students ADD COLUMN checked_in_by TEXT");
    } catch {
      // column already exists
    }
    // Added later: the project number printed on the judging sheet.
    try {
      this.sql.exec("ALTER TABLE students ADD COLUMN project_no TEXT NOT NULL DEFAULT ''");
    } catch {
      // column already exists
    }
    // Which judges have judged which entries. A "judge" here is one phone or tablet
    // (each device gets a random id), so nobody has to create an account.
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS judged (
        student_id INTEGER NOT NULL,
        device TEXT NOT NULL,
        at INTEGER NOT NULL,
        PRIMARY KEY (student_id, device)
      );
    `);
    this.failedLogins = new Map(); // visitor address -> times of recent wrong codes
    // Lets phones keep their live connection open without waking the database.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---------- access codes ----------

  get demoMode() {
    return !(this.env.ADMIN_CODE && this.env.JUDGE_CODE);
  }

  roleFor(code) {
    if (!code) return null;
    const adminCode = this.demoMode ? DEMO_ADMIN_CODE : this.env.ADMIN_CODE;
    const judgeCode = this.demoMode ? DEMO_JUDGE_CODE : this.env.JUDGE_CODE;
    if (sameText(code, adminCode)) return "admin";
    if (sameText(code.toLowerCase(), judgeCode.toLowerCase())) return "judge";
    return null;
  }

  // Slow down anyone guessing codes: 20 wrong tries in a minute from one
  // address locks that address out briefly (everyone else is unaffected).
  recentFailures(address) {
    const cutoff = Date.now() - 60_000;
    const recent = (this.failedLogins.get(address) || []).filter((t) => t > cutoff);
    this.failedLogins.set(address, recent);
    if (this.failedLogins.size > 5000) this.failedLogins.clear();
    return recent;
  }

  // ---------- helpers ----------

  // The roster for one fair. Visitors (the public view) get names, projects and tables only.
  // Judges and the desk also get the "judged" dots: how many judges have marked each entry,
  // and whether this device is one of them.
  listStudents(event, role, device) {
    if (role === "visitor") {
      return this.sql
        .exec(
          `SELECT id, project_no AS number, name, grade, category, title, section, table_id AS "table"
           FROM students WHERE event = ? ORDER BY name COLLATE NOCASE`,
          event
        )
        .toArray();
    }
    return this.sql
      .exec(
        `SELECT s.id, s.project_no AS number, s.name, s.grade, s.category, s.title, s.section,
                s.table_id AS "table", s.checked_in_at AS checkedInAt, s.checked_in_by AS "by",
                (SELECT COUNT(*) FROM judged j WHERE j.student_id = s.id) AS judged,
                EXISTS (SELECT 1 FROM judged j WHERE j.student_id = s.id AND j.device = ?) AS mine
         FROM students s WHERE s.event = ? ORDER BY s.name COLLATE NOCASE`,
        device,
        event
      )
      .toArray();
  }

  // Forget "judged" marks that point at scholars who are no longer on any roster.
  tidyJudged() {
    this.sql.exec("DELETE FROM judged WHERE student_id NOT IN (SELECT id FROM students)");
  }

  // Tell every open phone "something changed" - they then re-download the list.
  // (No names travel over this channel.)
  broadcast(event) {
    const message = JSON.stringify({ type: "changed", event });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // phone went away; nothing to do
      }
    }
  }

  async readAsset(path) {
    const response = await this.env.ASSETS.fetch(new Request("https://assets.local" + path));
    if (!response.ok) return null;
    return response.json();
  }

  insertStudent(event, row) {
    const name = clean(row.name, 80);
    if (!name) return false;
    const table = clean(row.table, 12) || null;
    this.sql.exec(
      `INSERT INTO students (event, project_no, name, grade, category, title, section, table_id, checked_in_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event,
      clean(row.number, 16),
      name,
      clean(row.grade, 12),
      clean(row.category, 40),
      clean(row.title, 160),
      clean(row.section, 40),
      table,
      table ? Date.now() : null
    );
    return true;
  }

  // ---------- request router ----------

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Live updates channel.
    if (path === "/api/ws") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "Expected a WebSocket" }, 426);
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Public info: is this the test site? (No scholar data here.)
    if (path === "/api/config" && method === "GET") {
      return json(
        this.demoMode
          ? { demo: true, demoJudgeCode: DEMO_JUDGE_CODE, demoAdminCode: DEMO_ADMIN_CODE }
          : { demo: false }
      );
    }

    const address = request.headers.get("cf-connecting-ip") || "unknown";
    const failures = this.recentFailures(address);
    if (failures.length >= 20) return json({ error: "Too many wrong codes. Wait a minute and try again." }, 429);
    const code = request.headers.get("x-access-code") || "";
    const device = clean(request.headers.get("x-device-id"), 40);
    // No code at all = the public view (a visitor). A wrong code is still an error.
    const role = code ? this.roleFor(code) : "visitor";
    if (!role) {
      failures.push(Date.now());
      return json({ error: "That access code is not right." }, 401);
    }

    if (path === "/api/login" && method === "POST") {
      if (role === "visitor") return json({ error: "Enter your access code." }, 401);
      return json({ role, demo: this.demoMode });
    }

    const match = path.match(/^\/api\/events\/([a-z0-9-]{1,20})\/([a-z]+)(?:\/(\d+))?$/);
    if (!match) return json({ error: "Not found" }, 404);
    const [, event, action, idText] = match;

    // Anyone can read the list (the public view needs no password).
    if (action === "students" && method === "GET") {
      return json({ students: this.listStudents(event, role, device), role });
    }

    // ----- judges and the desk -----
    if (role === "visitor") return json({ error: "This needs an access code." }, 401);
    let body = {};
    if (method === "POST") {
      try {
        body = await request.json();
      } catch {
        body = {};
      }
    }

    // A judge marks an entry as judged (done: true) or takes the mark back (done: false).
    if (action === "judged" && method === "POST") {
      if (!device) return json({ error: "Missing device id." }, 400);
      const id = Number(body.id);
      const existing = this.sql.exec("SELECT id FROM students WHERE id = ? AND event = ?", id, event).toArray();
      if (existing.length === 0) return json({ error: "Scholar not found." }, 404);
      if (body.done) this.sql.exec("INSERT OR IGNORE INTO judged (student_id, device, at) VALUES (?, ?, ?)", id, device, Date.now());
      else this.sql.exec("DELETE FROM judged WHERE student_id = ? AND device = ?", id, device);
      this.broadcast(event);
      return json({ ok: true });
    }

    // ----- admin only below this line -----
    if (role !== "admin") return json({ error: "This needs the admin code." }, 403);
    if (method !== "POST" && method !== "DELETE") return json({ error: "Not found" }, 404);

    // Check a scholar in at a table (or send table: null to undo).
    if (action === "checkin" && method === "POST") {
      const id = Number(body.id);
      const table = clean(body.table, 12) || null;
      const existing = this.sql.exec("SELECT id FROM students WHERE id = ? AND event = ?", id, event).toArray();
      if (existing.length === 0) return json({ error: "Scholar not found." }, 404);
      this.sql.exec(
        "UPDATE students SET table_id = ?, checked_in_at = ?, checked_in_by = ? WHERE id = ?",
        table,
        table ? Date.now() : null,
        table ? clean(body.by, 30) || null : null,
        id
      );
      this.broadcast(event);
      return json({ ok: true });
    }

    // Add one scholar by hand (walk-ins, late registrations).
    if (action === "students" && method === "POST") {
      const count = this.sql.exec("SELECT COUNT(*) AS n FROM students WHERE event = ?", event).one().n;
      if (count >= MAX_STUDENTS_PER_EVENT) return json({ error: "Roster is full." }, 400);
      if (!this.insertStudent(event, body)) return json({ error: "A name is required." }, 400);
      this.broadcast(event);
      return json({ ok: true });
    }

    if (action === "students" && method === "DELETE" && idText) {
      this.sql.exec("DELETE FROM students WHERE id = ? AND event = ?", Number(idText), event);
      this.tidyJudged();
      this.broadcast(event);
      return json({ ok: true });
    }

    // Upload a real roster. Blocked in test mode so real names never sit behind public demo codes.
    if (action === "import" && method === "POST") {
      if (this.demoMode) {
        return json({ error: "Roster upload is off in test mode. Set JUDGE_CODE and ADMIN_CODE in Cloudflare first." }, 403);
      }
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, MAX_STUDENTS_PER_EVENT) : [];
      if (rows.length === 0) return json({ error: "No rows found in that file." }, 400);
      if (body.replace) this.sql.exec("DELETE FROM students WHERE event = ?", event);
      let added = 0;
      for (const row of rows) if (this.insertStudent(event, row)) added++;
      this.tidyJudged();
      this.broadcast(event);
      return json({ ok: true, added });
    }

    // Load the fake roster that ships with the app. simulate: true also seats everyone.
    if (action === "seed" && method === "POST") {
      const roster = await this.readAsset(`/testdata/roster-${event}.json`);
      const layout = await this.readAsset(`/layouts/${event}.json`);
      if (!roster || !layout) return json({ error: "No test data for this event." }, 404);
      this.sql.exec("DELETE FROM students WHERE event = ?", event);
      const seats = {}; // table id -> seats used
      for (const row of roster) {
        let table = null;
        if (body.simulate) {
          const open = layout.tables.find((t) => t.section === row.section && (seats[t.id] || 0) < t.capacity);
          if (open) {
            seats[open.id] = (seats[open.id] || 0) + 1;
            table = open.id;
          }
        }
        this.insertStudent(event, { ...row, table });
      }
      this.tidyJudged();
      this.broadcast(event);
      return json({ ok: true, added: roster.length });
    }

    // Clear every check-in but keep the roster.
    if (action === "reset" && method === "POST") {
      this.sql.exec("UPDATE students SET table_id = NULL, checked_in_at = NULL, checked_in_by = NULL WHERE event = ?", event);
      this.broadcast(event);
      return json({ ok: true });
    }

    // Remove the whole roster for this event.
    if (action === "clear" && method === "POST") {
      this.sql.exec("DELETE FROM students WHERE event = ?", event);
      this.tidyJudged();
      this.broadcast(event);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  }

  // ---------- live connection housekeeping ----------

  webSocketMessage() {
    // Phones only listen; nothing to handle.
  }

  webSocketClose(socket) {
    try {
      socket.close(1000, "bye");
    } catch {
      // already closed
    }
  }
}
