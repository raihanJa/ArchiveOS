import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
import type {
  ArchiveStats, Building, Client, Department, DocType, Employee, EventDetail,
  EventFilter, OrgState, Product, Project, Relationship, SearchResult,
  SimDocument, SimEvent, Technology,
} from "../shared/types";
import type { EngineSnapshot, WorldState } from "../sim/world";
import type { TickOutput } from "../sim/engine";

// Loaded at runtime so no bundler statically resolves the (very new) builtin.
// __filename exists in the CJS Electron bundle and in Vitest's module wrapper.
const nodeRequire = createRequire(__filename);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

/**
 * SQLite persistence. Entities are mirrored rows (updated in place); events
 * and documents are append-only archive tables with FTS5 search (with a LIKE
 * fallback if the bundled SQLite lacks FTS5).
 */
export class ArchiveDb {
  private db: DatabaseSyncT;
  fts = false;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.migrate();
  }

  close(): void {
    try { this.db.close(); } catch { /* already closed */ }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, gender TEXT, birth_year INTEGER,
        personality TEXT, traits TEXT, role TEXT, level INTEGER, dept_id INTEGER,
        salary INTEGER, skill INTEGER, stress INTEGER, happiness INTEGER,
        reputation INTEGER, ambitions TEXT, status TEXT, hired_day INTEGER,
        left_day INTEGER, achievements INTEGER, failures INTEGER
      );
      CREATE TABLE IF NOT EXISTS departments (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, fn TEXT, head_id INTEGER,
        budget INTEGER, morale INTEGER, created_day INTEGER, closed_day INTEGER
      );
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY, codename TEXT NOT NULL, kind TEXT, dept_id INTEGER,
        status TEXT, budget INTEGER, spent REAL, progress REAL, risk INTEGER,
        quality REAL, team_ids TEXT, lead_id INTEGER, start_day INTEGER,
        end_day INTEGER, expected_days INTEGER, description TEXT, tech_id INTEGER,
        product_id INTEGER, revived_from_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS technologies (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, invented_day INTEGER,
        inventor_id INTEGER, project_id INTEGER, potency INTEGER, status TEXT
      );
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, project_id INTEGER,
        launch_day INTEGER, status TEXT, quality INTEGER, annual_revenue INTEGER,
        discontinued_day INTEGER
      );
      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, industry TEXT,
        annual_value INTEGER, since_day INTEGER, status TEXT, lost_day INTEGER
      );
      CREATE TABLE IF NOT EXISTS buildings (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, opened_day INTEGER,
        closed_day INTEGER, capacity INTEGER
      );
      CREATE TABLE IF NOT EXISTS relationships (
        a_id INTEGER NOT NULL, b_id INTEGER NOT NULL, kind TEXT, strength INTEGER,
        since_day INTEGER, PRIMARY KEY (a_id, b_id)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, day INTEGER NOT NULL, type TEXT NOT NULL,
        headline TEXT NOT NULL, summary TEXT NOT NULL, importance INTEGER,
        dept_id INTEGER, project_id INTEGER, product_id INTEGER, client_id INTEGER,
        data TEXT
      );
      CREATE TABLE IF NOT EXISTS event_actors (
        event_id INTEGER NOT NULL, emp_id INTEGER NOT NULL,
        PRIMARY KEY (event_id, emp_id)
      );
      CREATE TABLE IF NOT EXISTS event_causes (
        event_id INTEGER NOT NULL, cause_id INTEGER NOT NULL,
        PRIMARY KEY (event_id, cause_id)
      );
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY, day INTEGER NOT NULL, type TEXT NOT NULL,
        title TEXT NOT NULL, author_id INTEGER, body TEXT NOT NULL, event_id INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_events_day ON events(day);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_importance ON events(importance);
      CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id) WHERE project_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_events_dept ON events(dept_id) WHERE dept_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_actors_emp ON event_actors(emp_id);
      CREATE INDEX IF NOT EXISTS idx_causes_cause ON event_causes(cause_id);
      CREATE INDEX IF NOT EXISTS idx_docs_day ON documents(day);
      CREATE INDEX IF NOT EXISTS idx_docs_type ON documents(type);
      CREATE INDEX IF NOT EXISTS idx_docs_event ON documents(event_id) WHERE event_id IS NOT NULL;
    `);
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(headline, summary, content='events', content_rowid='id');
        CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(title, body, content='documents', content_rowid='id');
      `);
      this.fts = true;
    } catch {
      this.fts = false; // LIKE fallback
    }
  }

  /** ---------- world persistence ---------- */

  hasWorld(): boolean {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'org'").get() as { value: string } | undefined;
    return !!row;
  }

  saveMeta(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, JSON.stringify(value));
  }

  getMeta<T>(key: string): T | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : null;
  }

  /** Write everything produced by the engine since the last flush, atomically. */
  flush(world: WorldState, out: TickOutput): void {
    this.db.exec("BEGIN");
    try {
      for (const ev of out.events) this.insertEvent(ev);
      for (const doc of out.documents) this.insertDocument(doc);
      for (const id of out.dirty.employees) { const e = world.employees.get(id); if (e) this.upsertEmployee(e); }
      for (const id of out.dirty.departments) { const d = world.departments.get(id); if (d) this.upsertDepartment(d); }
      for (const id of out.dirty.projects) { const p = world.projects.get(id); if (p) this.upsertProject(p); }
      for (const id of out.dirty.technologies) { const t = world.technologies.get(id); if (t) this.upsertTechnology(t); }
      for (const id of out.dirty.products) { const p = world.products.get(id); if (p) this.upsertProduct(p); }
      for (const id of out.dirty.clients) { const c = world.clients.get(id); if (c) this.upsertClient(c); }
      for (const id of out.dirty.buildings) { const b = world.buildings.get(id); if (b) this.upsertBuilding(b); }
      for (const key of out.dirty.relationships) { const r = world.relationships.get(key); if (r) this.upsertRelationship(r); }
      this.saveMeta("org", world.org);
      this.saveMeta("snapshot", {
        pressures: world.pressures, scheduled: world.scheduled, nextId: world.nextId,
        rngState: world.rngState, usedCodenames: world.usedCodenames,
      } satisfies EngineSnapshot);
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  loadWorld(): WorldState | null {
    const org = this.getMeta<OrgState>("org");
    const snap = this.getMeta<EngineSnapshot>("snapshot");
    if (!org || !snap) return null;
    const world: WorldState = {
      org,
      employees: new Map(), departments: new Map(), projects: new Map(),
      technologies: new Map(), products: new Map(), clients: new Map(),
      buildings: new Map(), relationships: new Map(),
      pressures: snap.pressures, scheduled: snap.scheduled, nextId: snap.nextId,
      rngState: snap.rngState, usedCodenames: snap.usedCodenames,
    };
    // Load ordered by id so the in-memory Map iteration order (which the engine
    // relies on for deterministic RNG-driven selection) matches insertion order.
    for (const r of this.db.prepare("SELECT * FROM employees ORDER BY id").all() as Record<string, unknown>[]) {
      const e = rowToEmployee(r); world.employees.set(e.id, e);
    }
    for (const r of this.db.prepare("SELECT * FROM departments ORDER BY id").all() as Record<string, unknown>[]) {
      const d = rowToDepartment(r); world.departments.set(d.id, d);
    }
    for (const r of this.db.prepare("SELECT * FROM projects ORDER BY id").all() as Record<string, unknown>[]) {
      const p = rowToProject(r); world.projects.set(p.id, p);
    }
    for (const r of this.db.prepare("SELECT * FROM technologies ORDER BY id").all() as Record<string, unknown>[]) {
      const t = rowToTechnology(r); world.technologies.set(t.id, t);
    }
    for (const r of this.db.prepare("SELECT * FROM products ORDER BY id").all() as Record<string, unknown>[]) {
      const p = rowToProduct(r); world.products.set(p.id, p);
    }
    for (const r of this.db.prepare("SELECT * FROM clients ORDER BY id").all() as Record<string, unknown>[]) {
      const c = rowToClient(r); world.clients.set(c.id, c);
    }
    for (const r of this.db.prepare("SELECT * FROM buildings ORDER BY id").all() as Record<string, unknown>[]) {
      const b = rowToBuilding(r); world.buildings.set(b.id, b);
    }
    for (const r of this.db.prepare("SELECT * FROM relationships ORDER BY since_day, a_id, b_id").all() as Record<string, unknown>[]) {
      const rel = rowToRelationship(r);
      world.relationships.set(`${rel.aId}|${rel.bId}`, rel);
    }
    return world;
  }

  /** Destroy all data (used by "reset archive"). */
  wipe(): void {
    const tables = ["meta", "employees", "departments", "projects", "technologies", "products", "clients", "buildings", "relationships", "events", "event_actors", "event_causes", "documents"];
    this.db.exec("BEGIN");
    for (const t of tables) this.db.exec(`DELETE FROM ${t}`);
    if (this.fts) this.db.exec("DELETE FROM events_fts; DELETE FROM docs_fts;");
    this.db.exec("COMMIT");
  }

  /** ---------- inserts / upserts ---------- */

  private insertEvent(ev: SimEvent): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO events(id, day, type, headline, summary, importance, dept_id, project_id, product_id, client_id, data) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ).run(ev.id, ev.day, ev.type, ev.headline, ev.summary, ev.importance, ev.deptId, ev.projectId, ev.productId, ev.clientId, JSON.stringify(ev.data));
    const ia = this.db.prepare("INSERT OR IGNORE INTO event_actors(event_id, emp_id) VALUES(?,?)");
    for (const a of ev.actorIds) ia.run(ev.id, a);
    const ic = this.db.prepare("INSERT OR IGNORE INTO event_causes(event_id, cause_id) VALUES(?,?)");
    for (const c of ev.causeIds) ic.run(ev.id, c);
    if (this.fts) {
      this.db.prepare("INSERT INTO events_fts(rowid, headline, summary) VALUES(?,?,?)").run(ev.id, ev.headline, ev.summary);
    }
  }

  private insertDocument(d: SimDocument): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO documents(id, day, type, title, author_id, body, event_id) VALUES(?,?,?,?,?,?,?)"
    ).run(d.id, d.day, d.type, d.title, d.authorId, d.body, d.eventId);
    if (this.fts) {
      this.db.prepare("INSERT INTO docs_fts(rowid, title, body) VALUES(?,?,?)").run(d.id, d.title, d.body);
    }
  }

  private upsertEmployee(e: Employee): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO employees(id, name, gender, birth_year, personality, traits, role, level, dept_id, salary, skill, stress, happiness, reputation, ambitions, status, hired_day, left_day, achievements, failures)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(e.id, e.name, e.gender, e.birthYear, JSON.stringify(e.personality), JSON.stringify(e.traits), e.role, e.level, e.deptId, e.salary, Math.round(e.skill), Math.round(e.stress), Math.round(e.happiness), Math.round(e.reputation), e.ambitionsText, e.status, e.hiredDay, e.leftDay, e.achievements, e.failures);
  }

  private upsertDepartment(d: Department): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO departments(id, name, fn, head_id, budget, morale, created_day, closed_day) VALUES(?,?,?,?,?,?,?,?)"
    ).run(d.id, d.name, d.fn, d.headId, d.budget, Math.round(d.morale), d.createdDay, d.closedDay);
  }

  private upsertProject(p: Project): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO projects(id, codename, kind, dept_id, status, budget, spent, progress, risk, quality, team_ids, lead_id, start_day, end_day, expected_days, description, tech_id, product_id, revived_from_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(p.id, p.codename, p.kind, p.deptId, p.status, p.budget, p.spent, p.progress, p.risk, p.quality, JSON.stringify(p.teamIds), p.leadId, p.startDay, p.endDay, p.expectedDays, p.description, p.techId, p.productId, p.revivedFromId);
  }

  private upsertTechnology(t: Technology): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO technologies(id, name, invented_day, inventor_id, project_id, potency, status) VALUES(?,?,?,?,?,?,?)"
    ).run(t.id, t.name, t.inventedDay, t.inventorId, t.projectId, t.potency, t.status);
  }

  private upsertProduct(p: Product): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO products(id, name, project_id, launch_day, status, quality, annual_revenue, discontinued_day) VALUES(?,?,?,?,?,?,?,?)"
    ).run(p.id, p.name, p.projectId, p.launchDay, p.status, Math.round(p.quality), p.annualRevenue, p.discontinuedDay);
  }

  private upsertClient(c: Client): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO clients(id, name, industry, annual_value, since_day, status, lost_day) VALUES(?,?,?,?,?,?,?)"
    ).run(c.id, c.name, c.industry, c.annualValue, c.sinceDay, c.status, c.lostDay);
  }

  private upsertBuilding(b: Building): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO buildings(id, name, city, opened_day, closed_day, capacity) VALUES(?,?,?,?,?,?)"
    ).run(b.id, b.name, b.city, b.openedDay, b.closedDay, b.capacity);
  }

  private upsertRelationship(r: Relationship): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO relationships(a_id, b_id, kind, strength, since_day) VALUES(?,?,?,?,?)"
    ).run(r.aId, r.bId, r.kind, Math.round(r.strength), r.sinceDay);
  }

  /** ---------- queries ---------- */

  listEvents(f: EventFilter): { total: number; rows: SimEvent[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (f.types && f.types.length > 0) {
      where.push(`type IN (${f.types.map(() => "?").join(",")})`);
      params.push(...f.types);
    }
    if (f.minImportance) { where.push("importance >= ?"); params.push(f.minImportance); }
    if (f.projectId) { where.push("project_id = ?"); params.push(f.projectId); }
    if (f.deptId) { where.push("dept_id = ?"); params.push(f.deptId); }
    if (f.productId) { where.push("product_id = ?"); params.push(f.productId); }
    if (f.clientId) { where.push("client_id = ?"); params.push(f.clientId); }
    if (f.actorId) { where.push("id IN (SELECT event_id FROM event_actors WHERE emp_id = ?)"); params.push(f.actorId); }
    if (f.text && f.text.trim()) {
      if (this.fts) {
        where.push("id IN (SELECT rowid FROM events_fts WHERE events_fts MATCH ?)");
        params.push(ftsQuery(f.text));
      } else {
        where.push("(headline LIKE ? OR summary LIKE ?)");
        params.push(`%${f.text}%`, `%${f.text}%`);
      }
    }
    const w = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM events ${w}`).get(...(params as never[])) as { n: number }).n;
    const order = f.order === "asc" ? "ASC" : "DESC";
    const rows = (this.db.prepare(
      `SELECT * FROM events ${w} ORDER BY day ${order}, id ${order} LIMIT ? OFFSET ?`
    ).all(...(params as never[]), f.limit ?? 50, f.offset ?? 0) as Record<string, unknown>[]).map(rowToEvent);
    this.attachActors(rows);
    return { total, rows };
  }

  private attachActors(rows: SimEvent[]): void {
    const stmt = this.db.prepare("SELECT emp_id FROM event_actors WHERE event_id = ?");
    const cstmt = this.db.prepare("SELECT cause_id FROM event_causes WHERE event_id = ?");
    for (const ev of rows) {
      ev.actorIds = (stmt.all(ev.id) as { emp_id: number }[]).map((r) => r.emp_id);
      ev.causeIds = (cstmt.all(ev.id) as { cause_id: number }[]).map((r) => r.cause_id);
    }
  }

  getEvent(id: number): SimEvent | null {
    const r = this.db.prepare("SELECT * FROM events WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    const ev = rowToEvent(r);
    this.attachActors([ev]);
    return ev;
  }

  getEventDetail(id: number): EventDetail | null {
    const ev = this.getEvent(id);
    if (!ev) return null;
    const actors = ev.actorIds
      .map((aid) => this.db.prepare("SELECT id, name, role FROM employees WHERE id = ?").get(aid) as { id: number; name: string; role: string } | undefined)
      .filter((x): x is { id: number; name: string; role: string } => !!x);
    const causes = ev.causeIds.map((cid) => this.getEvent(cid)).filter((x): x is SimEvent => !!x);
    const consRows = this.db.prepare("SELECT event_id FROM event_causes WHERE cause_id = ?").all(id) as { event_id: number }[];
    const consequences = consRows.map((r) => this.getEvent(r.event_id)).filter((x): x is SimEvent => !!x);
    const documents = (this.db.prepare("SELECT id, type, title FROM documents WHERE event_id = ?").all(id) as { id: number; type: DocType; title: string }[]);
    return { event: ev, actors, causes, consequences, documents };
  }

  listDocuments(opts: { offset?: number; limit?: number; type?: string; text?: string; authorId?: number }): { total: number; rows: Omit<SimDocument, "body">[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.type) { where.push("type = ?"); params.push(opts.type); }
    if (opts.authorId) { where.push("author_id = ?"); params.push(opts.authorId); }
    if (opts.text && opts.text.trim()) {
      if (this.fts) {
        where.push("id IN (SELECT rowid FROM docs_fts WHERE docs_fts MATCH ?)");
        params.push(ftsQuery(opts.text));
      } else {
        where.push("(title LIKE ? OR body LIKE ?)");
        params.push(`%${opts.text}%`, `%${opts.text}%`);
      }
    }
    const w = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM documents ${w}`).get(...(params as never[])) as { n: number }).n;
    const rows = (this.db.prepare(
      `SELECT id, day, type, title, author_id, event_id FROM documents ${w} ORDER BY day DESC, id DESC LIMIT ? OFFSET ?`
    ).all(...(params as never[]), opts.limit ?? 50, opts.offset ?? 0) as Record<string, unknown>[]).map((r) => ({
      id: r.id as number, day: r.day as number, type: r.type as DocType,
      title: r.title as string, authorId: r.author_id as number | null, eventId: r.event_id as number | null,
    }));
    return { total, rows };
  }

  getDocument(id: number): SimDocument | null {
    const r = this.db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: r.id as number, day: r.day as number, type: r.type as DocType, title: r.title as string,
      authorId: r.author_id as number | null, body: r.body as string, eventId: r.event_id as number | null,
    };
  }

  stats(): ArchiveStats {
    const n = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      employeesActive: n("SELECT COUNT(*) AS n FROM employees WHERE status = 'active'"),
      employeesTotal: n("SELECT COUNT(*) AS n FROM employees"),
      departments: n("SELECT COUNT(*) AS n FROM departments WHERE closed_day IS NULL"),
      projectsActive: n("SELECT COUNT(*) AS n FROM projects WHERE status = 'active'"),
      projectsTotal: n("SELECT COUNT(*) AS n FROM projects"),
      products: n("SELECT COUNT(*) AS n FROM products"),
      clients: n("SELECT COUNT(*) AS n FROM clients"),
      events: n("SELECT COUNT(*) AS n FROM events"),
      documents: n("SELECT COUNT(*) AS n FROM documents"),
      technologies: n("SELECT COUNT(*) AS n FROM technologies"),
      buildings: n("SELECT COUNT(*) AS n FROM buildings"),
    };
  }

  search(query: string, limit = 40): SearchResult[] {
    const out: SearchResult[] = [];
    const q = `%${query}%`;
    const push = (kind: SearchResult["kind"], id: number, title: string, subtitle: string, day: number | null, snippet?: string) =>
      out.push({ kind, id, title, subtitle, day, snippet });

    for (const r of this.db.prepare("SELECT id, name, role, status FROM employees WHERE name LIKE ? LIMIT 8").all(q) as Record<string, unknown>[]) {
      push("employee", r.id as number, r.name as string, `${r.role} — ${r.status}`, null);
    }
    for (const r of this.db.prepare("SELECT id, codename, status, start_day FROM projects WHERE codename LIKE ? LIMIT 8").all(q) as Record<string, unknown>[]) {
      push("project", r.id as number, r.codename as string, `project — ${r.status}`, r.start_day as number);
    }
    for (const r of this.db.prepare("SELECT id, name, status, launch_day FROM products WHERE name LIKE ? LIMIT 6").all(q) as Record<string, unknown>[]) {
      push("product", r.id as number, r.name as string, `product — ${r.status}`, r.launch_day as number);
    }
    for (const r of this.db.prepare("SELECT id, name, created_day FROM departments WHERE name LIKE ? LIMIT 4").all(q) as Record<string, unknown>[]) {
      push("department", r.id as number, r.name as string, "department", r.created_day as number);
    }
    for (const r of this.db.prepare("SELECT id, name, industry, since_day FROM clients WHERE name LIKE ? LIMIT 4").all(q) as Record<string, unknown>[]) {
      push("client", r.id as number, r.name as string, `client — ${r.industry}`, r.since_day as number);
    }
    for (const r of this.db.prepare("SELECT id, name, invented_day, status FROM technologies WHERE name LIKE ? LIMIT 4").all(q) as Record<string, unknown>[]) {
      push("technology", r.id as number, r.name as string, `technology — ${r.status}`, r.invented_day as number);
    }
    const evLimit = Math.max(4, limit - out.length - 8);
    if (this.fts) {
      try {
        for (const r of this.db.prepare(
          "SELECT e.id, e.headline, e.type, e.day, snippet(events_fts, 1, '«', '»', '…', 12) AS snip FROM events_fts JOIN events e ON e.id = events_fts.rowid WHERE events_fts MATCH ? ORDER BY rank LIMIT ?"
        ).all(ftsQuery(query), evLimit) as Record<string, unknown>[]) {
          push("event", r.id as number, r.headline as string, `event — ${r.type}`, r.day as number, r.snip as string);
        }
        for (const r of this.db.prepare(
          "SELECT d.id, d.title, d.type, d.day, snippet(docs_fts, 1, '«', '»', '…', 12) AS snip FROM docs_fts JOIN documents d ON d.id = docs_fts.rowid WHERE docs_fts MATCH ? ORDER BY rank LIMIT 8"
        ).all(ftsQuery(query), 8) as Record<string, unknown>[]) {
          push("document", r.id as number, r.title as string, `document — ${r.type}`, r.day as number, r.snip as string);
        }
      } catch { /* malformed fts query: fall through to LIKE */ }
    }
    if (!this.fts || out.length === 0) {
      for (const r of this.db.prepare("SELECT id, headline, type, day FROM events WHERE headline LIKE ? OR summary LIKE ? ORDER BY day DESC LIMIT ?").all(q, q, evLimit) as Record<string, unknown>[]) {
        push("event", r.id as number, r.headline as string, `event — ${r.type}`, r.day as number);
      }
      for (const r of this.db.prepare("SELECT id, title, type, day FROM documents WHERE title LIKE ? OR body LIKE ? ORDER BY day DESC LIMIT 8").all(q, q) as Record<string, unknown>[]) {
        push("document", r.id as number, r.title as string, `document — ${r.type}`, r.day as number);
      }
    }
    return out.slice(0, limit);
  }

  /** Events touching an employee, project etc. — used by entity detail views & the investigator. */
  eventsForEntity(kind: "employee" | "project" | "department" | "product" | "client", id: number, limit = 200): SimEvent[] {
    let sql: string;
    switch (kind) {
      case "employee": sql = "SELECT * FROM events WHERE id IN (SELECT event_id FROM event_actors WHERE emp_id = ?) ORDER BY day ASC LIMIT ?"; break;
      case "project": sql = "SELECT * FROM events WHERE project_id = ? ORDER BY day ASC LIMIT ?"; break;
      case "department": sql = "SELECT * FROM events WHERE dept_id = ? ORDER BY day ASC LIMIT ?"; break;
      case "product": sql = "SELECT * FROM events WHERE product_id = ? ORDER BY day ASC LIMIT ?"; break;
      case "client": sql = "SELECT * FROM events WHERE client_id = ? ORDER BY day ASC LIMIT ?"; break;
    }
    const rows = (this.db.prepare(sql).all(id, limit) as Record<string, unknown>[]).map(rowToEvent);
    this.attachActors(rows);
    return rows;
  }

  /** Walk the cause DAG upward (why did X happen?) breadth-first. */
  causalChain(eventId: number, depth = 6): SimEvent[] {
    const seen = new Set<number>([eventId]);
    const chain: SimEvent[] = [];
    let frontier = [eventId];
    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const id of frontier) {
        const causes = this.db.prepare("SELECT cause_id FROM event_causes WHERE event_id = ?").all(id) as { cause_id: number }[];
        for (const { cause_id } of causes) {
          if (seen.has(cause_id)) continue;
          seen.add(cause_id);
          const ev = this.getEvent(cause_id);
          if (ev) { chain.push(ev); next.push(cause_id); }
        }
      }
      frontier = next;
    }
    return chain.sort((a, b) => a.day - b.day);
  }

  /** Walk consequences downward (what did X lead to?). */
  consequenceChain(eventId: number, depth = 6): SimEvent[] {
    const seen = new Set<number>([eventId]);
    const chain: SimEvent[] = [];
    let frontier = [eventId];
    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: number[] = [];
      for (const id of frontier) {
        const cons = this.db.prepare("SELECT event_id FROM event_causes WHERE cause_id = ?").all(id) as { event_id: number }[];
        for (const { event_id } of cons) {
          if (seen.has(event_id)) continue;
          seen.add(event_id);
          const ev = this.getEvent(event_id);
          if (ev) { chain.push(ev); next.push(event_id); }
        }
      }
      frontier = next;
    }
    return chain.sort((a, b) => a.day - b.day);
  }

  listEmployees(opts: { text?: string; status?: string; deptId?: number; offset?: number; limit?: number }): { total: number; rows: Employee[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.text) { where.push("name LIKE ?"); params.push(`%${opts.text}%`); }
    if (opts.status && opts.status !== "all") { where.push("status = ?"); params.push(opts.status); }
    if (opts.deptId) { where.push("dept_id = ?"); params.push(opts.deptId); }
    const w = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM employees ${w}`).get(...(params as never[])) as { n: number }).n;
    const rows = (this.db.prepare(`SELECT * FROM employees ${w} ORDER BY status = 'active' DESC, level DESC, name ASC LIMIT ? OFFSET ?`)
      .all(...(params as never[]), opts.limit ?? 50, opts.offset ?? 0) as Record<string, unknown>[]).map(rowToEmployee);
    return { total, rows };
  }

  getEmployee(id: number): Employee | null {
    const r = this.db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? rowToEmployee(r) : null;
  }

  relationshipsFor(empId: number): (Relationship & { otherName: string; otherId: number })[] {
    const rows = this.db.prepare("SELECT * FROM relationships WHERE a_id = ? OR b_id = ?").all(empId, empId) as Record<string, unknown>[];
    return rows.map((r) => {
      const rel = rowToRelationship(r);
      const otherId = rel.aId === empId ? rel.bId : rel.aId;
      const other = this.getEmployee(otherId);
      return { ...rel, otherId, otherName: other?.name ?? `#${otherId}` };
    }).sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength));
  }

  listProjects(opts: { text?: string; status?: string; offset?: number; limit?: number }): { total: number; rows: Project[] } {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.text) { where.push("codename LIKE ?"); params.push(`%${opts.text}%`); }
    if (opts.status && opts.status !== "all") { where.push("status = ?"); params.push(opts.status); }
    const w = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM projects ${w}`).get(...(params as never[])) as { n: number }).n;
    const rows = (this.db.prepare(`SELECT * FROM projects ${w} ORDER BY status = 'active' DESC, start_day DESC LIMIT ? OFFSET ?`)
      .all(...(params as never[]), opts.limit ?? 50, opts.offset ?? 0) as Record<string, unknown>[]).map(rowToProject);
    return { total, rows };
  }

  getProject(id: number): Project | null {
    const r = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return r ? rowToProject(r) : null;
  }

  listDepartments(): Department[] {
    return (this.db.prepare("SELECT * FROM departments ORDER BY closed_day IS NULL DESC, created_day ASC").all() as Record<string, unknown>[]).map(rowToDepartment);
  }

  listProducts(): Product[] {
    return (this.db.prepare("SELECT * FROM products ORDER BY launch_day DESC").all() as Record<string, unknown>[]).map(rowToProduct);
  }

  listClients(): Client[] {
    return (this.db.prepare("SELECT * FROM clients ORDER BY status = 'active' DESC, annual_value DESC").all() as Record<string, unknown>[]).map(rowToClient);
  }

  listTechnologies(): Technology[] {
    return (this.db.prepare("SELECT * FROM technologies ORDER BY invented_day DESC").all() as Record<string, unknown>[]).map(rowToTechnology);
  }

  listBuildings(): Building[] {
    return (this.db.prepare("SELECT * FROM buildings ORDER BY opened_day ASC").all() as Record<string, unknown>[]).map(rowToBuilding);
  }

  deptTurnover(): { deptId: number; name: string; departures: number; headcount: number }[] {
    const rows = this.db.prepare(`
      SELECT d.id AS deptId, d.name AS name,
        (SELECT COUNT(*) FROM employees e WHERE e.dept_id = d.id AND e.status != 'active') AS departures,
        (SELECT COUNT(*) FROM employees e WHERE e.dept_id = d.id AND e.status = 'active') AS headcount
      FROM departments d ORDER BY departures DESC
    `).all() as { deptId: number; name: string; departures: number; headcount: number }[];
    return rows;
  }
}

/** Sanitize free text into a safe FTS5 query (quoted prefix terms, OR'd). */
function ftsQuery(text: string): string {
  const terms = text.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((t) => t.length > 1).slice(0, 8);
  if (terms.length === 0) return '""';
  return terms.map((t) => `"${t}"*`).join(" ");
}

/** ---------- row mappers ---------- */

function rowToEvent(r: Record<string, unknown>): SimEvent {
  return {
    id: r.id as number, day: r.day as number, type: r.type as string,
    headline: r.headline as string, summary: r.summary as string,
    importance: r.importance as number,
    actorIds: [], causeIds: [],
    deptId: r.dept_id as number | null, projectId: r.project_id as number | null,
    productId: r.product_id as number | null, clientId: r.client_id as number | null,
    data: r.data ? JSON.parse(r.data as string) : {},
  };
}

function rowToEmployee(r: Record<string, unknown>): Employee {
  return {
    id: r.id as number, name: r.name as string, gender: r.gender as Employee["gender"],
    birthYear: r.birth_year as number,
    personality: JSON.parse(r.personality as string),
    traits: JSON.parse(r.traits as string),
    role: r.role as string, level: r.level as number, deptId: r.dept_id as number | null,
    salary: r.salary as number, skill: r.skill as number, stress: r.stress as number,
    happiness: r.happiness as number, reputation: r.reputation as number,
    ambitionsText: r.ambitions as string, status: r.status as Employee["status"],
    hiredDay: r.hired_day as number, leftDay: r.left_day as number | null,
    achievements: r.achievements as number, failures: r.failures as number,
  };
}

function rowToDepartment(r: Record<string, unknown>): Department {
  return {
    id: r.id as number, name: r.name as string, fn: r.fn as Department["fn"],
    headId: r.head_id as number | null, budget: r.budget as number,
    morale: r.morale as number, createdDay: r.created_day as number,
    closedDay: r.closed_day as number | null,
  };
}

function rowToProject(r: Record<string, unknown>): Project {
  return {
    id: r.id as number, codename: r.codename as string, kind: r.kind as Project["kind"],
    deptId: r.dept_id as number, status: r.status as Project["status"],
    budget: r.budget as number, spent: r.spent as number, progress: r.progress as number,
    risk: r.risk as number, quality: r.quality as number,
    teamIds: JSON.parse(r.team_ids as string), leadId: r.lead_id as number | null,
    startDay: r.start_day as number, endDay: r.end_day as number | null,
    expectedDays: (r.expected_days as number) ?? 300,
    description: r.description as string, techId: r.tech_id as number | null,
    productId: r.product_id as number | null, revivedFromId: r.revived_from_id as number | null,
  };
}

function rowToTechnology(r: Record<string, unknown>): Technology {
  return {
    id: r.id as number, name: r.name as string, inventedDay: r.invented_day as number,
    inventorId: r.inventor_id as number | null, projectId: r.project_id as number | null,
    potency: r.potency as number, status: r.status as Technology["status"],
  };
}

function rowToProduct(r: Record<string, unknown>): Product {
  return {
    id: r.id as number, name: r.name as string, projectId: r.project_id as number,
    launchDay: r.launch_day as number, status: r.status as Product["status"],
    quality: r.quality as number, annualRevenue: r.annual_revenue as number,
    discontinuedDay: r.discontinued_day as number | null,
  };
}

function rowToClient(r: Record<string, unknown>): Client {
  return {
    id: r.id as number, name: r.name as string, industry: r.industry as string,
    annualValue: r.annual_value as number, sinceDay: r.since_day as number,
    status: r.status as Client["status"], lostDay: r.lost_day as number | null,
  };
}

function rowToBuilding(r: Record<string, unknown>): Building {
  return {
    id: r.id as number, name: r.name as string, city: r.city as string,
    openedDay: r.opened_day as number, closedDay: r.closed_day as number | null,
    capacity: r.capacity as number,
  };
}

function rowToRelationship(r: Record<string, unknown>): Relationship {
  return {
    aId: r.a_id as number, bId: r.b_id as number, kind: r.kind as Relationship["kind"],
    strength: r.strength as number, sinceDay: r.since_day as number,
  };
}
