import { app, BrowserWindow, ipcMain } from "electron";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchiveDb } from "./db";
import { Investigator } from "./investigator";
import { RelationshipExplainer } from "./explain";
import { Engine } from "../sim/engine";
import type { WorldState } from "../sim/world";
import {
  SPEEDS, formatSimDate, type AppSettings, type EventFilter, type OrgKind,
  type Speed, type TickPush,
} from "../shared/types";

/**
 * ArchiveOS main process: owns the SQLite archive, runs the simulation loop,
 * and exposes a typed IPC API to the renderer.
 *
 * Time model: at 1× the simulation advances one in-world day every 3 real
 * seconds. Multipliers scale that linearly; day processing is batched per
 * 250 ms interval and flushed to SQLite in a single transaction.
 */

const SMOKE = process.argv.includes("--smoke");
const DEV = process.argv.includes("--dev");

let db: ArchiveDb | null = null;
let engine: Engine | null = null;
let investigator: Investigator | null = null;
let explainer: RelationshipExplainer | null = null;
let win: BrowserWindow | null = null;
let speed: Speed = 1;
let dayAccumulator = 0;
let loopTimer: NodeJS.Timeout | null = null;
let recentHeadlines: TickPush["headlines"] = [];

const INTERVAL_MS = 250;
const BASE_DAYS_PER_SEC = 1 / 3;
const MAX_DAYS_PER_BATCH = 40;

function userDataDir(): string {
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function dbPath(): string {
  return join(userDataDir(), SMOKE ? "smoke.db" : "archive.db");
}

function settingsPath(): string {
  return join(userDataDir(), "settings.json");
}

function loadSettings(): AppSettings {
  try {
    if (existsSync(settingsPath())) {
      return { anthropicApiKey: "", llmModel: "claude-haiku-4-5-20251001", investigatorUsesLlm: false, ...JSON.parse(readFileSync(settingsPath(), "utf8")) };
    }
  } catch { /* corrupted settings: fall back to defaults */ }
  return { anthropicApiKey: "", llmModel: "claude-haiku-4-5-20251001", investigatorUsesLlm: false };
}

function saveSettings(s: AppSettings): void {
  writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

function openArchive(): void {
  db = new ArchiveDb(dbPath());
  const world = db.loadWorld();
  if (world) {
    engine = new Engine(world);
    const savedSpeed = db.getMeta<Speed>("speed");
    if (savedSpeed !== null && (SPEEDS as readonly number[]).includes(savedSpeed)) speed = savedSpeed;
  }
  investigator = new Investigator(db, () => requireEngine().world.org);
  explainer = new RelationshipExplainer(db, () => requireEngine().world.org);
}

function requireDb(): ArchiveDb {
  if (!db) throw new Error("archive not open");
  return db;
}

function requireEngine(): Engine {
  if (!engine) throw new Error("no organization initialized");
  return engine;
}

/** ---------- simulation loop ---------- */

function startLoop(): void {
  if (loopTimer) return;
  loopTimer = setInterval(() => {
    try {
      pump();
    } catch (err) {
      console.error("simulation error:", err);
    }
  }, INTERVAL_MS);
}

function pump(): void {
  if (!engine || !db || speed === 0) return;
  dayAccumulator += speed * BASE_DAYS_PER_SEC * (INTERVAL_MS / 1000);
  let days = Math.floor(dayAccumulator);
  if (days <= 0) return;
  dayAccumulator -= days;
  if (days > MAX_DAYS_PER_BATCH) days = MAX_DAYS_PER_BATCH;

  for (let i = 0; i < days; i++) engine.tickDay();
  flushAndPush();
}

function flushAndPush(): void {
  if (!engine || !db) return;
  const out = engine.drain();
  db.flush(engine.world, out);
  for (const ev of out.events) {
    if (ev.importance >= 3) {
      recentHeadlines.unshift({ id: ev.id, day: ev.day, headline: ev.headline, importance: ev.importance });
    }
  }
  recentHeadlines = recentHeadlines.slice(0, 12);
  pushTick();
}

function pushTick(): void {
  if (!win || !engine || !db) return;
  const org = engine.world.org;
  const payload: TickPush = {
    day: org.day,
    dateLabel: formatSimDate(org, org.day),
    speed,
    cash: Math.round(org.cash),
    reputation: Math.round(org.reputation),
    headlines: recentHeadlines,
    stats: db.stats(),
  };
  win.webContents.send("tick", payload);
}

/** ---------- IPC ---------- */

function registerIpc(): void {
  ipcMain.handle("org:get", () => {
    if (!engine) return { hasWorld: false };
    const org = engine.world.org;
    return {
      hasWorld: true,
      org,
      dateLabel: formatSimDate(org, org.day),
      speed,
      stats: requireDb().stats(),
    };
  });

  ipcMain.handle("org:init", (_e, args: { name: string; kind: OrgKind; seed?: number }) => {
    const d = requireDb();
    if (engine) throw new Error("organization already exists");
    const seed = args.seed ?? Math.floor(Math.random() * 2 ** 31);
    engine = Engine.create(args.name.trim() || "Untitled Organization", args.kind, seed);
    flushAndPush();
    return { ok: true };
  });

  ipcMain.handle("org:reset", () => {
    speed = 1;
    recentHeadlines = [];
    engine = null;
    requireDb().wipe();
    return { ok: true };
  });

  ipcMain.handle("sim:setSpeed", (_e, s: Speed) => {
    if ((SPEEDS as readonly number[]).includes(s)) {
      speed = s;
      requireDb().saveMeta("speed", s);
    }
    pushTick();
    return speed;
  });

  ipcMain.handle("events:list", (_e, filter: EventFilter) => requireDb().listEvents(filter));
  ipcMain.handle("events:detail", (_e, id: number) => requireDb().getEventDetail(id));

  ipcMain.handle("employees:list", (_e, opts) => requireDb().listEmployees(opts ?? {}));
  ipcMain.handle("employees:get", (_e, id: number) => {
    const d = requireDb();
    const employee = d.getEmployee(id);
    if (!employee) return null;
    const dept = employee.deptId !== null ? d.listDepartments().find((x) => x.id === employee.deptId) : undefined;
    return {
      employee,
      deptName: dept?.name ?? null,
      events: d.eventsForEntity("employee", id, 300),
      relationships: d.relationshipsFor(id).slice(0, 40),
      reputation: d.reputationFor(id),
      secrets: d.secretsFor(id),
      documents: d.listDocuments({ authorId: id, limit: 20 }).rows,
    };
  });

  ipcMain.handle("projects:list", (_e, opts) => requireDb().listProjects(opts ?? {}));
  ipcMain.handle("projects:get", (_e, id: number) => {
    const d = requireDb();
    const project = d.getProject(id);
    if (!project) return null;
    const dept = d.listDepartments().find((x) => x.id === project.deptId);
    const team = project.teamIds.map((tid) => d.getEmployee(tid)).filter(Boolean);
    return {
      project,
      deptName: dept?.name ?? null,
      team,
      events: d.eventsForEntity("project", id, 300),
    };
  });

  ipcMain.handle("relationship:get", (_e, args: { aId: number; bId: number }) => requireDb().getRelationshipFull(args.aId, args.bId));
  ipcMain.handle("relationship:explain", async (_e, args: { aId: number; bId: number }) => {
    if (!explainer) throw new Error("archive not ready");
    return explainer.explain(args.aId, args.bId, loadSettings());
  });

  ipcMain.handle("departments:list", () => {
    const d = requireDb();
    const turnover = d.deptTurnover();
    return d.listDepartments().map((dept) => {
      const t = turnover.find((x) => x.deptId === dept.id);
      const head = dept.headId !== null ? d.getEmployee(dept.headId) : null;
      return { ...dept, headName: head?.name ?? null, headcount: t?.headcount ?? 0, departures: t?.departures ?? 0 };
    });
  });
  ipcMain.handle("departments:get", (_e, id: number) => {
    const d = requireDb();
    const dept = d.listDepartments().find((x) => x.id === id);
    if (!dept) return null;
    return {
      department: dept,
      head: dept.headId !== null ? d.getEmployee(dept.headId) : null,
      members: d.listEmployees({ deptId: id, status: "active", limit: 200 }).rows,
      events: d.eventsForEntity("department", id, 300),
    };
  });

  ipcMain.handle("products:list", () => requireDb().listProducts());
  ipcMain.handle("clients:list", () => requireDb().listClients());
  ipcMain.handle("technologies:list", () => requireDb().listTechnologies());
  ipcMain.handle("buildings:list", () => requireDb().listBuildings());

  ipcMain.handle("docs:list", (_e, opts) => requireDb().listDocuments(opts ?? {}));
  ipcMain.handle("docs:get", (_e, id: number) => requireDb().getDocument(id));

  ipcMain.handle("search:query", (_e, q: string) => requireDb().search(q));

  ipcMain.handle("investigator:ask", async (_e, question: string) => {
    if (!investigator) throw new Error("archive not ready");
    return investigator.ask(question, loadSettings());
  });

  ipcMain.handle("settings:get", () => {
    const s = loadSettings();
    // Do not ship the raw key back to the renderer; mask it.
    return { ...s, anthropicApiKey: s.anthropicApiKey ? `${s.anthropicApiKey.slice(0, 12)}…` : "", hasKey: !!s.anthropicApiKey };
  });
  ipcMain.handle("settings:set", (_e, patch: Partial<AppSettings>) => {
    const current = loadSettings();
    const next = { ...current, ...patch };
    // If the renderer echoes back the masked key, keep the stored one.
    if (typeof patch.anthropicApiKey === "string" && patch.anthropicApiKey.endsWith("…")) {
      next.anthropicApiKey = current.anthropicApiKey;
    }
    saveSettings(next);
    return { ok: true };
  });
}

/** ---------- window ---------- */

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0d1117",
    title: "ArchiveOS",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "../ui/index.html"));
  if (DEV) win.webContents.openDevTools({ mode: "detach" });
  win.on("closed", () => { win = null; });
}

/** ---------- smoke test mode ---------- */

function runSmoke(): void {
  try { rmSync(dbPath(), { force: true }); rmSync(dbPath() + "-wal", { force: true }); rmSync(dbPath() + "-shm", { force: true }); } catch { /* first run */ }
  db = new ArchiveDb(dbPath());
  engine = Engine.create("Smoke Dynamics", "ai_company", 12345);
  db.flush(engine.world, engine.drain());
  const DAYS = 500;
  for (let i = 0; i < DAYS; i++) {
    engine.tickDay();
    if (i % 30 === 0) db.flush(engine.world, engine.drain());
  }
  db.flush(engine.world, engine.drain());
  const stats = db.stats();
  // Reload round-trip to prove persistence works.
  const world2 = db.loadWorld();
  const inv = new Investigator(db, () => (world2 as WorldState).org);
  console.log("SMOKE STATS:", JSON.stringify(stats));
  console.log("SMOKE FTS:", db.fts);
  console.log("SMOKE RELOAD DAY:", world2?.org.day, "employees:", world2?.employees.size);
  inv.ask("Show every data breach", loadSettings()).then((ans) => {
    console.log("SMOKE INVESTIGATOR:", ans.answer.slice(0, 400).replace(/\n/g, " | "));
    const ok = stats.events > 100 && stats.documents > 20 && world2?.org.day === DAYS;
    console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
    app.exit(ok ? 0 : 1);
  }).catch((err) => {
    console.error("SMOKE FAIL:", err);
    app.exit(1);
  });
}

/** ---------- lifecycle ---------- */

app.whenReady().then(() => {
  if (SMOKE) {
    runSmoke();
    return;
  }
  openArchive();
  registerIpc();
  createWindow();
  startLoop();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Persist a final snapshot before exit.
  try {
    if (engine && db) db.flush(engine.world, engine.drain());
  } catch (err) {
    console.error("final flush failed:", err);
  }
  if (loopTimer) clearInterval(loopTimer);
  db?.close();
  app.quit();
});
