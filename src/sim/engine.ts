import {
  AMBITION_TEXTS, FANTASY_FIRST_F, FANTASY_FIRST_M, FANTASY_LAST,
  MODERN_FIRST_F, MODERN_FIRST_M, MODERN_LAST, THEMES, TRAIT_POOL, type Theme,
} from "./themes";
import { Rng, clamp } from "./rng";
import {
  activeEmployees, activeProjects, openDepartments, relKey,
  type ScheduledItem, type WorldState,
} from "./world";
import type {
  Building, Client, Department, DeptFunction, Employee, OrgKind, OrgState,
  Product, Project, SimDocument, SimEvent, Technology,
} from "../shared/types";
import { formatSimDate as fmtDate } from "../shared/types";
import { composeDocs, type DocCtx, type DocDraft } from "./docs";

/** Everything produced since the last drain(); the host flushes it to SQLite. */
export interface TickOutput {
  events: SimEvent[];
  documents: SimDocument[];
  dirty: {
    employees: Set<number>;
    departments: Set<number>;
    projects: Set<number>;
    technologies: Set<number>;
    products: Set<number>;
    clients: Set<number>;
    buildings: Set<number>;
    relationships: Set<string>;
  };
}

function emptyOutput(): TickOutput {
  return {
    events: [],
    documents: [],
    dirty: {
      employees: new Set(), departments: new Set(), projects: new Set(),
      technologies: new Set(), products: new Set(), clients: new Set(),
      buildings: new Set(), relationships: new Set(),
    },
  };
}

interface EmitSpec {
  type: string;
  headline: string;
  summary: string;
  importance: number;
  actorIds?: number[];
  deptId?: number | null;
  projectId?: number | null;
  productId?: number | null;
  clientId?: number | null;
  causeIds?: number[];
  data?: Record<string, unknown>;
  /** Skip automatic document generation for this event. */
  noDocs?: boolean;
}

export class Engine {
  world: WorldState;
  rng: Rng;
  theme: Theme;
  private out: TickOutput = emptyOutput();

  constructor(world: WorldState) {
    this.world = world;
    this.rng = new Rng(world.rngState);
    this.theme = THEMES[world.org.kind];
  }

  /** Create a brand new world with its founding history. */
  static create(name: string, kind: OrgKind, seed: number): Engine {
    const rng = new Rng(seed);
    const org: OrgState = {
      name, kind, seed,
      foundedYear: rng.int(1974, 2004),
      foundedMonth: rng.int(0, 11),
      foundedDayOfMonth: rng.int(1, 28),
      day: 0,
      cash: 5_000_000 + rng.int(0, 3_000_000),
      reputation: rng.int(38, 55),
      ceoId: null,
      bankruptcies: 0,
    };
    const world: WorldState = {
      org,
      employees: new Map(), departments: new Map(), projects: new Map(),
      technologies: new Map(), products: new Map(), clients: new Map(),
      buildings: new Map(), relationships: new Map(),
      pressures: {}, scheduled: [], nextId: 1, rngState: rng.state,
      usedCodenames: [],
    };
    const engine = new Engine(world);
    engine.founding();
    return engine;
  }

  drain(): TickOutput {
    this.world.rngState = this.rng.state;
    const o = this.out;
    this.out = emptyOutput();
    return o;
  }

  /** ---------- infrastructure ---------- */

  nextId(): number {
    return this.world.nextId++;
  }

  private docCtx(): DocCtx {
    return {
      rng: this.rng,
      theme: this.theme,
      org: this.world.org,
      day: this.world.org.day,
      dateLabel: (d: number) => fmtDate(this.world.org, d),
      emp: (id: number) => this.world.employees.get(id),
      dept: (id: number) => this.world.departments.get(id),
      proj: (id: number) => this.world.projects.get(id),
      prod: (id: number) => this.world.products.get(id),
      client: (id: number) => this.world.clients.get(id),
      tech: (id: number) => this.world.technologies.get(id),
      money: (n: number) => this.money(n),
      pickByFn: (fn: DeptFunction) => this.pickByFn(fn),
    };
  }

  money(n: number): string {
    const v = Math.round(n).toLocaleString("en-US");
    return this.theme.kind === "fantasy_kingdom" ? `${v} gp` : `$${v}`;
  }

  dateLabel(day = this.world.org.day): string {
    return fmtDate(this.world.org, day);
  }

  emit(spec: EmitSpec): SimEvent {
    const ev: SimEvent = {
      id: this.nextId(),
      day: this.world.org.day,
      type: spec.type,
      headline: spec.headline,
      summary: spec.summary,
      importance: spec.importance,
      actorIds: spec.actorIds ?? [],
      deptId: spec.deptId ?? null,
      projectId: spec.projectId ?? null,
      productId: spec.productId ?? null,
      clientId: spec.clientId ?? null,
      causeIds: spec.causeIds ?? [],
      data: spec.data ?? {},
    };
    this.out.events.push(ev);
    if (!spec.noDocs) {
      const drafts: DocDraft[] = composeDocs(this.docCtx(), ev);
      for (const d of drafts) {
        this.out.documents.push({ ...d, id: this.nextId(), day: ev.day, eventId: ev.id });
      }
    }
    return ev;
  }

  schedule(daysAhead: number, kind: string, causeId: number | null, payload: Record<string, unknown> = {}): void {
    this.world.scheduled.push({ dueDay: this.world.org.day + Math.max(1, Math.round(daysAhead)), kind, causeId, payload });
  }

  pressure(name: string, delta: number): void {
    const p = this.world.pressures;
    p[name] = clamp((p[name] ?? 0) + delta, 0, 3);
  }

  getPressure(name: string): number {
    return this.world.pressures[name] ?? 0;
  }

  touch<K extends keyof TickOutput["dirty"]>(set: K, id: K extends "relationships" ? string : number): void {
    (this.out.dirty[set] as Set<string | number>).add(id);
  }

  /** ---------- people helpers ---------- */

  private newPersonName(gender: "m" | "f"): string {
    const fantasy = this.theme.nameStyle === "fantasy";
    const first = gender === "m" ? (fantasy ? FANTASY_FIRST_M : MODERN_FIRST_M) : (fantasy ? FANTASY_FIRST_F : MODERN_FIRST_F);
    const last = fantasy ? FANTASY_LAST : MODERN_LAST;
    for (let i = 0; i < 20; i++) {
      const name = `${this.rng.pick(first)} ${this.rng.pick(last)}`;
      let taken = false;
      for (const e of this.world.employees.values()) if (e.name === name) { taken = true; break; }
      if (!taken) return name;
    }
    return `${this.rng.pick(first)} ${this.rng.pick(last)} ${["Jr.", "II", "III"][this.rng.int(0, 2)]}`;
  }

  roleTitle(fn: DeptFunction, level: number): string {
    if (level >= 7) return this.theme.ceoTitle;
    const band = level >= 6 ? 3 : level >= 5 ? 2 : level >= 3 ? 1 : 0;
    return this.theme.roleByFn[fn][band];
  }

  salaryFor(level: number, skill: number): number {
    return Math.round((42000 + level * level * 4200) * (0.85 + skill / 400) / 100) * 100;
  }

  private makeEmployee(fn: DeptFunction, deptId: number | null, level: number): Employee {
    const gender = this.rng.chance(0.5) ? "m" : "f";
    const skill = Math.round(this.rng.gauss(45 + level * 5, 15, 15, 98));
    const year = this.world.org.foundedYear + Math.floor(this.world.org.day / 365);
    const emp: Employee = {
      id: this.nextId(),
      name: this.newPersonName(gender),
      gender,
      birthYear: year - this.rng.int(22 + level * 2, 40 + level * 3),
      personality: {
        openness: this.rng.int(10, 95), diligence: this.rng.int(15, 95),
        ambition: this.rng.int(10, 95), empathy: this.rng.int(10, 95),
        volatility: this.rng.int(5, 90),
      },
      traits: this.rng.sample(TRAIT_POOL, this.rng.int(2, 3)),
      role: this.roleTitle(fn, level),
      level,
      deptId,
      salary: 0,
      skill,
      stress: this.rng.int(10, 35),
      happiness: this.rng.int(55, 85),
      reputation: clamp(Math.round(skill * 0.6 + this.rng.int(0, 25)), 5, 95),
      ambitionsText: this.rng.pick(AMBITION_TEXTS),
      status: "active",
      hiredDay: this.world.org.day,
      leftDay: null,
      achievements: 0,
      failures: 0,
    };
    emp.salary = this.salaryFor(level, skill);
    this.world.employees.set(emp.id, emp);
    this.touch("employees", emp.id);
    return emp;
  }

  deptOf(e: Employee): Department | undefined {
    return e.deptId !== null ? this.world.departments.get(e.deptId) : undefined;
  }

  pickByFn(fn: DeptFunction): Employee | undefined {
    const cands = activeEmployees(this.world).filter((e) => {
      const d = this.deptOf(e);
      return d?.fn === fn;
    });
    if (cands.length === 0) return undefined;
    cands.sort((a, b) => b.level - a.level);
    return cands[0];
  }

  age(e: Employee): number {
    return this.world.org.foundedYear + Math.floor(this.world.org.day / 365) - e.birthYear;
  }

  private rel(aId: number, bId: number) {
    return this.world.relationships.get(relKey(aId, bId));
  }

  private setRel(aId: number, bId: number, kind: "friend" | "rival" | "mentor" | "romance", strength: number): void {
    const key = relKey(aId, bId);
    const existing = this.world.relationships.get(key);
    if (existing) {
      existing.kind = kind;
      existing.strength = clamp(strength, -100, 100);
    } else {
      this.world.relationships.set(key, { aId: Math.min(aId, bId), bId: Math.max(aId, bId), kind, strength: clamp(strength, -100, 100), sinceDay: this.world.org.day });
    }
    this.touch("relationships", key);
  }

  /** ---------- founding ---------- */

  private founding(): void {
    const w = this.world;
    const org = w.org;
    const city = this.rng.pick(this.theme.cities);
    const hq: Building = { id: this.nextId(), name: `${org.name} Headquarters`, city, openedDay: 0, closedDay: null, capacity: 80 };
    w.buildings.set(hq.id, hq);
    this.touch("buildings", hq.id);

    // Founder / chief executive.
    const founder = this.makeEmployee("executive", null, 7);
    founder.role = this.theme.ceoTitle;
    founder.reputation = this.rng.int(60, 90);
    org.ceoId = founder.id;

    const foundingEv = this.emit({
      type: "founding", importance: 5,
      headline: `${org.name} is founded`,
      summary: `${founder.name} founds ${org.name} in ${city} with ${this.money(org.cash)} in initial capital. The ${this.theme.orgNoun} sets out with a small team and outsized ambitions.`,
      actorIds: [founder.id],
      data: { city },
    });

    for (const spec of this.theme.foundingDepts) {
      this.createDepartment(spec.name, spec.fn, foundingEv.id, true);
    }
    // A couple of early projects to set the world in motion.
    const n = this.rng.int(1, 2);
    for (let i = 0; i < n; i++) this.maybeStartProject(foundingEv.id, true);
  }

  createDepartment(name: string, fn: DeptFunction, causeId: number | null, founding = false): Department {
    const w = this.world;
    const dept: Department = {
      id: this.nextId(), name, fn, headId: null,
      budget: this.rng.int(200, 900) * 1000,
      morale: this.rng.int(55, 75),
      createdDay: w.org.day, closedDay: null,
    };
    w.departments.set(dept.id, dept);
    this.touch("departments", dept.id);

    const head = this.makeEmployee(fn, dept.id, 6);
    dept.headId = head.id;
    const staffN = founding ? this.rng.int(1, 3) : this.rng.int(1, 2);
    const staff: Employee[] = [];
    for (let i = 0; i < staffN; i++) staff.push(this.makeEmployee(fn, dept.id, this.rng.int(1, 4)));

    this.emit({
      type: "dept_created", importance: 3,
      headline: `${name} department established`,
      summary: `${w.org.name} establishes ${name}, led by ${head.name} (${head.role}), with an initial team of ${staffN + 1} and a budget of ${this.money(dept.budget)}.`,
      actorIds: [head.id], deptId: dept.id,
      causeIds: causeId !== null ? [causeId] : [],
    });
    for (const s of staff) {
      this.emit({
        type: "hire", importance: 1,
        headline: `${s.name} joins as ${s.role}`,
        summary: `${s.name} is hired into ${name} as ${s.role} at a salary of ${this.money(s.salary)}/yr.`,
        actorIds: [s.id], deptId: dept.id,
      });
    }
    return dept;
  }

  /** ---------- the daily tick ---------- */

  tickDay(): void {
    const w = this.world;
    w.org.day++;
    this.processScheduled();
    this.decayPressures();
    this.projectsDaily();
    this.agentActions();
    this.orgProcesses();
    if (w.org.day % 30 === 0) this.monthly();
    if (w.org.day % 91 === 0) this.quarterly();
    if (w.org.day % 365 === 0) this.annual();
  }

  private decayPressures(): void {
    const p = this.world.pressures;
    for (const k of Object.keys(p)) {
      p[k] *= 0.985;
      if (p[k] < 0.01) delete p[k];
    }
  }

  /** ---------- projects ---------- */

  private nextCodename(): string {
    const pool = this.theme.projectCodenames.filter((c) => !this.world.usedCodenames.includes(c));
    if (pool.length === 0) {
      this.world.usedCodenames = [];
      return this.rng.pick(this.theme.projectCodenames);
    }
    const name = this.rng.pick(pool);
    this.world.usedCodenames.push(name);
    return name;
  }

  maybeStartProject(causeId: number | null, force = false, reviveTech?: Technology): Project | null {
    const w = this.world;
    const depts = openDepartments(w).filter((d) => d.fn === "engineering" || d.fn === "research" || d.fn === "operations");
    if (depts.length === 0) return null;
    const dept = this.rng.pick(depts);
    const members = activeEmployees(w).filter((e) => e.deptId === dept.id);
    if (members.length < 2 && !force) return null;

    const kind = reviveTech ? "product" : this.rng.weighted([
      ["product", dept.fn === "engineering" ? 5 : 2],
      ["research", dept.fn === "research" ? 6 : 2],
      ["infrastructure", 2],
      ["marketing", 1],
    ] as const);
    const team = this.rng.sample(members, Math.min(members.length, this.rng.int(2, 6)));
    if (team.length === 0) {
      team.push(this.makeEmployee(dept.fn, dept.id, 3));
    }
    const lead = team.reduce((a, b) => (a.level >= b.level ? a : b));
    const expectedDays = this.rng.int(120, 520);
    const dailyCost = team.reduce((s, e) => s + e.salary, 0) / 365;
    const proj: Project = {
      id: this.nextId(),
      codename: `Project ${this.nextCodename()}`,
      kind,
      deptId: dept.id,
      status: "active",
      budget: Math.round(dailyCost * expectedDays * 1.5),
      spent: 0,
      progress: 0,
      risk: this.rng.int(15, reviveTech ? 55 : 80),
      quality: 0,
      teamIds: team.map((e) => e.id),
      leadId: lead.id,
      startDay: w.org.day,
      endDay: null,
      expectedDays,
      description: reviveTech
        ? `An effort to revive the abandoned ${reviveTech.name} and finally bring it to fruition.`
        : this.projectDescription(kind),
      techId: reviveTech ? reviveTech.id : null,
      productId: null,
      revivedFromId: reviveTech ? reviveTech.projectId : null,
    };
    w.projects.set(proj.id, proj);
    this.touch("projects", proj.id);

    this.emit({
      type: reviveTech ? "project_revived" : "project_started",
      importance: reviveTech ? 4 : 2,
      headline: reviveTech
        ? `${proj.codename} revives the abandoned ${reviveTech.name}`
        : `${proj.codename} kicks off in ${dept.name}`,
      summary: reviveTech
        ? `Years after it was shelved, the ${reviveTech.name} is dusted off. ${lead.name} convinces leadership to fund ${proj.codename} (${this.money(proj.budget)}) to complete what an earlier team abandoned.`
        : `${dept.name} launches ${proj.codename}: ${proj.description} Led by ${lead.name} with a team of ${team.length} and a budget of ${this.money(proj.budget)}.`,
      actorIds: team.map((e) => e.id),
      deptId: dept.id, projectId: proj.id,
      causeIds: causeId !== null ? [causeId] : [],
      data: { budget: proj.budget, kind },
    });
    if (reviveTech) {
      reviveTech.status = "revived";
      this.touch("technologies", reviveTech.id);
    }
    return proj;
  }

  private projectDescription(kind: Project["kind"]): string {
    const noun = this.rng.pick(this.theme.techNouns);
    switch (kind) {
      case "product": return `an ambitious effort to turn a ${noun} into a flagship offering.`;
      case "research": return `an exploratory program probing the limits of a ${noun}.`;
      case "infrastructure": return `an internal overhaul built around a ${noun}.`;
      case "marketing": return `a coordinated push to put the ${this.theme.orgNoun}'s name in front of the world.`;
    }
  }

  private projectsDaily(): void {
    const w = this.world;
    for (const proj of activeProjects(w)) {
      const team = proj.teamIds.map((id) => w.employees.get(id)).filter((e): e is Employee => !!e && e.status === "active");
      if (team.length === 0) {
        proj.status = "abandoned";
        proj.endDay = w.org.day;
        this.touch("projects", proj.id);
        this.emit({
          type: "project_abandoned", importance: 3,
          headline: `${proj.codename} abandoned — no one left to work on it`,
          summary: `With every team member gone, ${proj.codename} quietly stops. ${Math.round(proj.progress)}% complete, ${this.money(proj.spent)} spent.`,
          projectId: proj.id, deptId: proj.deptId,
        });
        continue;
      }
      const expectedDays = proj.expectedDays || 300;
      const skillAvg = team.reduce((s, e) => s + e.skill, 0) / team.length;
      const dept = w.departments.get(proj.deptId);
      const moraleFactor = 0.7 + ((dept?.morale ?? 50) / 100) * 0.45;
      proj.progress = clamp(proj.progress + (100 / expectedDays) * (0.55 + skillAvg / 140) * moraleFactor, 0, 100);
      proj.quality = clamp(proj.quality + skillAvg / expectedDays, 0, 100);
      const dailyCost = team.reduce((s, e) => s + e.salary, 0) / 365 * 1.3;
      proj.spent += dailyCost;
      w.org.cash -= dailyCost * 0.3; // non-payroll portion of project burn

      if (this.rng.chance(proj.risk / 6000)) this.projectSetback(proj, team);
      if (proj.progress >= 100) this.completeProject(proj, team);
      this.touch("projects", proj.id);
    }
  }

  private projectSetback(proj: Project, team: Employee[]): void {
    const victim = this.rng.pick(team);
    proj.progress = clamp(proj.progress - this.rng.int(4, 14), 0, 100);
    victim.stress = clamp(victim.stress + this.rng.int(5, 15), 0, 100);
    victim.failures++;
    this.touch("employees", victim.id);
    this.emit({
      type: "experiment_failed", importance: 2,
      headline: `Setback on ${proj.codename}`,
      summary: `A key assumption behind ${proj.codename} fails under testing. ${victim.name} takes the brunt of the fallout; weeks of work are lost and the schedule slips.`,
      actorIds: [victim.id], projectId: proj.id, deptId: proj.deptId,
    });
  }

  private completeProject(proj: Project, team: Employee[]): void {
    const w = this.world;
    proj.status = "completed";
    proj.endDay = w.org.day;
    const lead = w.employees.get(proj.leadId ?? -1);
    for (const e of team) {
      e.achievements++;
      e.happiness = clamp(e.happiness + 8, 0, 100);
      e.reputation = clamp(e.reputation + 4, 0, 100);
      this.touch("employees", e.id);
    }
    const ev = this.emit({
      type: "project_completed", importance: 3,
      headline: `${proj.codename} completed`,
      summary: `After ${w.org.day - proj.startDay} days and ${this.money(proj.spent)}, ${proj.codename} reaches completion${lead ? ` under ${lead.name}` : ""}. Quality assessment: ${Math.round(proj.quality)}/100.`,
      actorIds: team.map((e) => e.id), projectId: proj.id, deptId: proj.deptId,
    });

    if (proj.kind === "product") {
      this.launchProduct(proj, ev.id);
    } else if (proj.kind === "research") {
      if (this.rng.chance(0.55) || proj.techId !== null) {
        if (proj.techId === null) this.inventTech(proj, lead ?? team[0], ev.id, Math.round(proj.quality * 0.6 + this.rng.int(5, 40)));
      } else {
        this.emit({
          type: "research_concluded", importance: 2,
          headline: `${proj.codename} concludes without a breakthrough`,
          summary: `The findings of ${proj.codename} are written up and filed. Valuable groundwork, but nothing that changes the ${this.theme.orgNoun}'s trajectory.`,
          projectId: proj.id, deptId: proj.deptId, causeIds: [ev.id],
        });
      }
    } else if (proj.kind === "marketing") {
      this.pressure("fame", 0.4);
      w.org.reputation = clamp(w.org.reputation + 2, 0, 100);
    }
  }

  inventTech(proj: Project | null, inventor: Employee, causeId: number, potency: number): Technology {
    const w = this.world;
    const tech: Technology = {
      id: this.nextId(),
      name: this.rng.pick(this.theme.techNouns),
      inventedDay: w.org.day,
      inventorId: inventor.id,
      projectId: proj?.id ?? null,
      potency: clamp(potency, 10, 100),
      status: "active",
    };
    w.technologies.set(tech.id, tech);
    this.touch("technologies", tech.id);
    if (proj) { proj.techId = tech.id; this.touch("projects", proj.id); }
    inventor.achievements++;
    inventor.reputation = clamp(inventor.reputation + 10, 0, 100);
    this.touch("employees", inventor.id);
    this.pressure("fame", tech.potency / 150);

    this.emit({
      type: "tech_invented", importance: tech.potency > 70 ? 5 : 4,
      headline: `${inventor.name} ${this.rng.pick(this.theme.breakthroughVerbs)} the ${tech.name}`,
      summary: `${inventor.name} ${this.rng.pick(this.theme.breakthroughVerbs)} the ${tech.name}${proj ? ` while working on ${proj.codename}` : ""}. Internal assessments rate its significance at ${tech.potency}/100. ${tech.potency > 70 ? "Leadership immediately understands this could change everything." : "A meaningful advance, if not a revolution."}`,
      actorIds: [inventor.id], projectId: proj?.id ?? null, deptId: proj?.deptId ?? inventor.deptId,
      causeIds: [causeId],
      data: { techId: tech.id, potency: tech.potency },
    });
    if (tech.potency > 70) this.pressure("espionage_target", 0.6);
    // A product project frequently follows a strong invention.
    if (tech.potency > 55 && this.rng.chance(0.7)) {
      this.schedule(this.rng.int(20, 90), "productize_tech", causeId, { techId: tech.id });
    }
    return tech;
  }

  private launchProduct(proj: Project, causeId: number): void {
    const w = this.world;
    const p = this.theme.productNameParts;
    let name = `${this.rng.pick(p.first)}${this.rng.pick(p.second)}`;
    for (let i = 0; i < 10; i++) {
      let taken = false;
      for (const pr of w.products.values()) if (pr.name === name) { taken = true; break; }
      if (!taken) break;
      name = `${this.rng.pick(p.first)}${this.rng.pick(p.second)}`;
    }
    const fame = this.getPressure("fame");
    const leak = this.getPressure("tech_leaked");
    const quality = clamp(proj.quality + this.rng.int(-10, 10), 5, 100);
    const product: Product = {
      id: this.nextId(), name, projectId: proj.id, launchDay: w.org.day,
      status: "growing", quality,
      annualRevenue: Math.round(quality * 26000 * (0.6 + fame * 0.5) * (1 - leak * 0.25)),
      discontinuedDay: null,
    };
    w.products.set(product.id, product);
    this.touch("products", product.id);
    proj.productId = product.id;
    this.touch("projects", proj.id);
    this.pressure("fame", 0.25);

    this.emit({
      type: "product_launched", importance: 4,
      headline: `${w.org.name} launches ${product.name}`,
      summary: `${product.name}, born from ${proj.codename}, ships to the public. Early reception rates it ${quality}/100; first-year revenue is projected at ${this.money(product.annualRevenue)}.`,
      projectId: proj.id, productId: product.id, deptId: proj.deptId,
      causeIds: [causeId],
      data: { quality, projectedRevenue: product.annualRevenue },
    });
    if (this.rng.chance(0.06)) {
      this.schedule(this.rng.int(30, 200), "patent_suit", causeId, { productId: product.id });
    }
  }

  private monthlyProjectReview(): void {
    for (const proj of activeProjects(this.world)) {
      if (proj.spent > proj.budget * 1.7 && proj.progress < 60) {
        this.cancelProject(proj, "runaway costs and stalled progress");
      }
    }
  }

  cancelProject(proj: Project, reason: string): void {
    const w = this.world;
    proj.status = "cancelled";
    proj.endDay = w.org.day;
    this.touch("projects", proj.id);
    const lead = w.employees.get(proj.leadId ?? -1);
    if (lead) {
      lead.failures++;
      lead.happiness = clamp(lead.happiness - 12, 0, 100);
      lead.reputation = clamp(lead.reputation - 6, 0, 100);
      this.touch("employees", lead.id);
    }
    const dept = w.departments.get(proj.deptId);
    if (dept) { dept.morale = clamp(dept.morale - 6, 0, 100); this.touch("departments", dept.id); }

    const ev = this.emit({
      type: "project_cancelled", importance: 3,
      headline: `${proj.codename} cancelled`,
      summary: `Leadership pulls the plug on ${proj.codename} after ${this.money(proj.spent)} against a ${this.money(proj.budget)} budget, citing ${reason}. The project dies at ${Math.round(proj.progress)}% complete.`,
      projectId: proj.id, deptId: proj.deptId,
      actorIds: lead ? [lead.id] : [],
      data: { reason },
    });
    // Promising cancelled work leaves an abandoned technology behind — a seed
    // for a revival arc years later.
    if (proj.kind !== "marketing" && proj.quality > 45 && proj.techId === null && this.rng.chance(0.5)) {
      const inventor = lead ?? undefined;
      const tech: Technology = {
        id: this.nextId(), name: this.rng.pick(this.theme.techNouns),
        inventedDay: w.org.day, inventorId: inventor?.id ?? null, projectId: proj.id,
        potency: clamp(Math.round(proj.quality * 0.8), 10, 100), status: "abandoned",
      };
      w.technologies.set(tech.id, tech);
      this.touch("technologies", tech.id);
      proj.techId = tech.id;
      this.schedule(this.rng.int(700, 2600), "tech_revival_check", ev.id, { techId: tech.id });
    } else if (proj.techId !== null) {
      const tech = w.technologies.get(proj.techId);
      if (tech && tech.status === "active") {
        tech.status = "abandoned";
        this.touch("technologies", tech.id);
        this.schedule(this.rng.int(700, 2600), "tech_revival_check", ev.id, { techId: tech.id });
      }
    }
  }

  /** ---------- agent actions ---------- */

  private agentActions(): void {
    const w = this.world;
    const staff = activeEmployees(w);
    if (staff.length === 0) return;
    const k = Math.round(clamp(staff.length / 10, 2, 14));
    const actors = this.rng.sample(staff, k);
    for (const e of actors) this.actOnce(e);
  }

  private actOnce(e: Employee): void {
    const w = this.world;
    const dept = this.deptOf(e);
    const proj = activeProjects(w).find((p) => p.teamIds.includes(e.id));
    const P = e.personality;

    const candidates: [() => void, number][] = [];
    const add = (w2: number, fn: () => void) => { if (w2 > 0) candidates.push([fn, w2]); };

    if (proj && dept && (dept.fn === "research" || dept.fn === "engineering")) {
      add((e.skill * P.openness) / 9000, () => this.actBreakthrough(e, proj));
    }
    add((P.volatility * e.stress) / 22000 + (this.hasRival(e) ? 0.35 : 0), () => this.actConflict(e));
    add((P.ambition * P.openness) / 30000 * (e.level >= 4 ? 2 : 1), () => this.actProposal(e));
    if (w.org.day - e.hiredDay > 300 && e.level < 6) {
      add((P.ambition / 100) * (e.reputation / 100) * 0.3, () => this.actPromotionRequest(e));
    }
    add(Math.pow((100 - e.happiness) / 100, 2) * 0.55 + (e.stress > 80 ? 0.2 : 0), () => this.actResign(e));
    add((P.volatility * (100 - P.diligence)) / 42000, () => this.actMisconduct(e));
    add((P.empathy / 100) * 0.3, () => this.actBefriend(e));
    if (e.stress > 75) add((e.stress - 75) / 55, () => this.actBurnout(e));
    // "nothing" keeps most days quiet.
    candidates.push([() => {}, 6.0]);

    const action = this.rng.weighted(candidates);
    action();
  }

  private hasRival(e: Employee): boolean {
    for (const r of this.world.relationships.values()) {
      if ((r.aId === e.id || r.bId === e.id) && r.kind === "rival" && r.strength < -30) return true;
    }
    return false;
  }

  private actBreakthrough(e: Employee, proj: Project): void {
    if (!this.rng.chance(0.22 + e.skill / 400)) {
      // A near-miss still helps the project a little.
      proj.progress = clamp(proj.progress + 2, 0, 100);
      this.touch("projects", proj.id);
      return;
    }
    proj.progress = clamp(proj.progress + this.rng.int(6, 18), 0, 100);
    proj.quality = clamp(proj.quality + this.rng.int(4, 12), 0, 100);
    this.touch("projects", proj.id);
    const ev = this.emit({
      type: "breakthrough", importance: 3,
      headline: `Breakthrough on ${proj.codename}`,
      summary: `${e.name} ${this.rng.pick(this.theme.breakthroughVerbs)} a core problem blocking ${proj.codename}. The team regains months of schedule overnight.`,
      actorIds: [e.id], projectId: proj.id, deptId: proj.deptId,
    });
    e.achievements++;
    e.reputation = clamp(e.reputation + 6, 0, 100);
    e.happiness = clamp(e.happiness + 8, 0, 100);
    this.touch("employees", e.id);
    if (proj.kind === "research" && proj.quality > 60 && this.rng.chance(0.3) && proj.techId === null) {
      this.inventTech(proj, e, ev.id, Math.round(proj.quality * 0.7 + this.rng.int(0, 30)));
    }
  }

  private actConflict(e: Employee): void {
    const w = this.world;
    const colleagues = activeEmployees(w).filter((c) => c.id !== e.id && c.deptId === e.deptId);
    if (colleagues.length === 0) return;
    const other = this.rng.pick(colleagues);
    const existing = this.rel(e.id, other.id);
    const strength = (existing?.strength ?? 0) - this.rng.int(15, 40);
    this.setRel(e.id, other.id, "rival", strength);
    for (const x of [e, other]) {
      x.stress = clamp(x.stress + 8, 0, 100);
      x.happiness = clamp(x.happiness - 6, 0, 100);
      this.touch("employees", x.id);
    }
    const dept = this.deptOf(e);
    if (dept) { dept.morale = clamp(dept.morale - 3, 0, 100); this.touch("departments", dept.id); }
    const topic = this.rng.pick(["credit for recent work", "a missed deadline", "resource allocation", "a design decision", "a promotion everyone saw coming", "tone in a meeting", "who broke the build"]);
    const ev = this.emit({
      type: "conflict", importance: strength < -60 ? 3 : 1,
      headline: `Dispute between ${e.name} and ${other.name}`,
      summary: `A disagreement over ${topic} turns personal between ${e.name} and ${other.name}${dept ? ` in ${dept.name}` : ""}. Colleagues notice the chill.`,
      actorIds: [e.id, other.id], deptId: e.deptId,
    });
    if (strength < -60) this.schedule(this.rng.int(7, 30), "escalate_conflict", ev.id, { aId: e.id, bId: other.id });
  }

  private actProposal(e: Employee): void {
    const w = this.world;
    if (activeProjects(w).length >= Math.max(2, Math.floor(activeEmployees(w).length / 8))) return;
    if (w.org.cash < 500_000) return;
    this.maybeStartProject(null);
  }

  private actPromotionRequest(e: Employee): void {
    const ok = this.rng.chance(e.reputation / 130);
    if (ok) {
      this.promote(e, null);
    } else {
      e.happiness = clamp(e.happiness - 10, 0, 100);
      this.touch("employees", e.id);
      this.emit({
        type: "promotion_denied", importance: 1,
        headline: `${e.name} passed over for promotion`,
        summary: `${e.name} makes the case for a promotion and is turned down. ${e.personality.ambition > 70 ? "They do not take it well." : "They swallow the disappointment, for now."}`,
        actorIds: [e.id], deptId: e.deptId,
      });
    }
  }

  promote(e: Employee, causeId: number | null): void {
    const dept = this.deptOf(e);
    e.level = Math.min(6, e.level + 1);
    e.role = this.roleTitle(dept?.fn ?? "operations", e.level);
    const oldSalary = e.salary;
    e.salary = this.salaryFor(e.level, e.skill);
    e.happiness = clamp(e.happiness + 15, 0, 100);
    e.reputation = clamp(e.reputation + 5, 0, 100);
    this.touch("employees", e.id);
    if (dept && e.level === 6) {
      dept.headId = e.id;
      this.touch("departments", dept.id);
    }
    this.emit({
      type: "promotion", importance: 2,
      headline: `${e.name} promoted to ${e.role}`,
      summary: `${e.name} is promoted to ${e.role}${dept ? ` in ${dept.name}` : ""}, with salary rising from ${this.money(oldSalary)} to ${this.money(e.salary)}.`,
      actorIds: [e.id], deptId: e.deptId,
      causeIds: causeId !== null ? [causeId] : [],
    });
  }

  private actResign(e: Employee): void {
    if (e.level >= 7) return; // CEO handled by dedicated arcs
    this.departure(e, "resigned", null, this.rng.pick([
      "citing burnout and a desire for change",
      "for a rival organization offering considerably more",
      "to start their own venture",
      "citing frustrations with leadership",
      "for personal reasons they decline to elaborate on",
    ]));
  }

  departure(e: Employee, status: "resigned" | "fired" | "retired", causeId: number | null, reason: string): SimEvent {
    const w = this.world;
    e.status = status;
    e.leftDay = w.org.day;
    this.touch("employees", e.id);
    const dept = this.deptOf(e);
    // Remove from project teams; a departing lead raises project risk.
    for (const p of activeProjects(w)) {
      const i = p.teamIds.indexOf(e.id);
      if (i >= 0) {
        p.teamIds.splice(i, 1);
        if (p.leadId === e.id) {
          p.leadId = p.teamIds[0] ?? null;
          p.risk = clamp(p.risk + 15, 0, 100);
        }
        this.touch("projects", p.id);
      }
    }
    if (dept && dept.headId === e.id) {
      dept.headId = null;
      this.touch("departments", dept.id);
      this.schedule(this.rng.int(5, 40), "fill_dept_head", null, { deptId: dept.id });
    }
    const verb = status === "resigned" ? "resigns" : status === "fired" ? "is terminated" : "retires";
    const imp = status === "fired" ? 3 : e.level >= 5 ? 3 : 2;
    const ev = this.emit({
      type: status === "resigned" ? "resignation" : status === "fired" ? "termination" : "retirement",
      importance: imp,
      headline: `${e.name} ${verb}`,
      summary: `${e.name} (${e.role}${dept ? `, ${dept.name}` : ""}) ${verb} after ${Math.max(1, Math.round((w.org.day - e.hiredDay) / 365 * 10) / 10)} years, ${reason}.`,
      actorIds: [e.id], deptId: e.deptId,
      causeIds: causeId !== null ? [causeId] : [],
      data: { reason, tenureDays: w.org.day - e.hiredDay },
    });
    if (dept) { dept.morale = clamp(dept.morale - (e.level >= 5 ? 6 : 2), 0, 100); this.touch("departments", dept.id); }
    if (status === "fired" && this.rng.chance(0.18)) {
      this.schedule(this.rng.int(30, 160), "wrongful_termination_suit", ev.id, { empId: e.id });
    }
    return ev;
  }

  private actMisconduct(e: Employee): void {
    const kind = this.rng.pick(["expense fraud", "leaking confidential material", "falsifying a report", "harassing a colleague", "moonlighting for a competitor"]);
    const ev = this.emit({
      type: "misconduct", importance: 2,
      headline: `Allegations surface against ${e.name}`,
      summary: `Whispers turn into a formal complaint: ${e.name} is accused of ${kind}. An internal investigation is opened.`,
      actorIds: [e.id], deptId: e.deptId,
      data: { kind },
    });
    this.pressure("legal_risk", 0.15);
    this.schedule(this.rng.int(14, 60), "misconduct_result", ev.id, { empId: e.id, kind });
  }

  private actBefriend(e: Employee): void {
    const w = this.world;
    const others = activeEmployees(w).filter((c) => c.id !== e.id);
    if (others.length === 0) return;
    const other = this.rng.pick(others);
    const existing = this.rel(e.id, other.id);
    if (existing?.kind === "rival") {
      // Reconciliation is possible.
      if (this.rng.chance(e.personality.empathy / 200)) {
        this.setRel(e.id, other.id, "friend", 20);
        this.emit({
          type: "reconciliation", importance: 1,
          headline: `${e.name} and ${other.name} bury the hatchet`,
          summary: `After a long frost, ${e.name} extends an olive branch to ${other.name}. It is accepted.`,
          actorIds: [e.id, other.id], deptId: e.deptId,
        });
      }
      return;
    }
    const romance = e.personality.empathy > 60 && this.rng.chance(0.04);
    this.setRel(e.id, other.id, romance ? "romance" : existing?.kind === "mentor" ? "mentor" : "friend", (existing?.strength ?? 10) + this.rng.int(8, 25));
    for (const x of [e, other]) { x.happiness = clamp(x.happiness + 3, 0, 100); this.touch("employees", x.id); }
  }

  private actBurnout(e: Employee): void {
    e.stress = clamp(e.stress - 45, 0, 100);
    this.touch("employees", e.id);
    this.emit({
      type: "sabbatical", importance: 1,
      headline: `${e.name} takes extended leave`,
      summary: `${e.name} steps away for several weeks on medical advice. ${this.deptOf(e)?.name ?? "The team"} redistributes their workload.`,
      actorIds: [e.id], deptId: e.deptId,
    });
  }

  /** ---------- org-level daily processes ---------- */

  private orgProcesses(): void {
    const w = this.world;
    const staff = activeEmployees(w);
    const payrollMo = staff.reduce((s, e) => s + e.salary, 0) / 12;

    // Hiring toward a target that grows with success.
    const target = Math.min(420, 10 + w.products.size * 8 + activeProjects(w).length * 5 + this.countActiveClients() * 2 + Math.floor(w.org.cash / 400_000));
    if (staff.length < target && w.org.cash > payrollMo * 8 && this.rng.chance(0.35)) this.hireIntoNeediestDept();

    // New department when the org has clearly outgrown its structure.
    const depts = openDepartments(w);
    if (staff.length > depts.length * 14 && this.rng.chance(0.02)) {
      const existing = new Set(depts.map((d) => d.name));
      const candidates = this.theme.expansionDepts.filter((d) => !existing.has(d.name));
      if (candidates.length > 0) {
        const spec = this.rng.pick(candidates);
        this.createDepartment(spec.name, spec.fn, null);
      }
    }

    // Client acquisition (sales-driven, reputation-gated).
    if (this.rng.chance(0.02 + (this.pickByFn("sales") ? 0.025 : 0) + this.getPressure("fame") * 0.02)) {
      if (this.rng.chance(w.org.reputation / 110)) this.signClient();
    }

    // New projects sometimes come top-down.
    if (this.rng.chance(0.03) && activeProjects(w).length < Math.max(2, Math.floor(staff.length / 8))) {
      this.maybeStartProject(null);
    }

    // Marketing campaigns.
    if (this.pickByFn("marketing") && this.rng.chance(0.008) && w.org.cash > 400_000) this.marketingCampaign();

    // Incidents.
    this.rollIncidents();

    // Office expansion.
    const capacity = [...w.buildings.values()].filter((b) => b.closedDay === null).reduce((s, b) => s + b.capacity, 0);
    if (staff.length > capacity * 0.95 && w.org.cash > payrollMo * 10) this.openOffice();
  }

  private countActiveClients(): number {
    let n = 0;
    for (const c of this.world.clients.values()) if (c.status === "active") n++;
    return n;
  }

  private hireIntoNeediestDept(): void {
    const w = this.world;
    const depts = openDepartments(w);
    if (depts.length === 0) return;
    const counts = new Map<number, number>();
    for (const e of activeEmployees(w)) if (e.deptId !== null) counts.set(e.deptId, (counts.get(e.deptId) ?? 0) + 1);
    depts.sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0));
    const dept = depts[0];
    const level = this.rng.weighted([[1, 3], [2, 4], [3, 3], [4, 2], [5, 1]] as const);
    const e = this.makeEmployee(dept.fn, dept.id, level);
    this.emit({
      type: "hire", importance: level >= 5 ? 2 : 1,
      headline: `${e.name} joins as ${e.role}`,
      summary: `${e.name} (${this.age(e)}) is hired into ${dept.name} as ${e.role} at ${this.money(e.salary)}/yr. ${e.name.split(" ")[0]} ${e.ambitionsText}.`,
      actorIds: [e.id], deptId: dept.id,
    });
  }

  private signClient(): void {
    const w = this.world;
    const p = this.theme.clientParts;
    const client: Client = {
      id: this.nextId(),
      name: `${this.rng.pick(p.first)} ${this.rng.pick(p.second)}`,
      industry: this.rng.pick(this.theme.industries),
      annualValue: this.rng.int(8, 60) * 10000,
      sinceDay: w.org.day,
      status: "active", lostDay: null,
    };
    w.clients.set(client.id, client);
    this.touch("clients", client.id);
    this.emit({
      type: "contract_won", importance: client.annualValue > 400_000 ? 3 : 2,
      headline: `${w.org.name} signs ${client.name}`,
      summary: `${client.name} (${client.industry}) signs a contract worth ${this.money(client.annualValue)}/yr. ${client.annualValue > 400_000 ? "The largest deal of the year, and everyone knows it." : "A solid win for the sales pipeline."}`,
      clientId: client.id,
    });
  }

  private marketingCampaign(): void {
    const w = this.world;
    const cost = this.rng.int(15, 80) * 10000;
    w.org.cash -= cost;
    const lead = this.pickByFn("marketing");
    const success = this.rng.chance(0.4 + (lead ? lead.skill / 300 : 0));
    this.pressure("fame", success ? 0.5 : 0.15);
    if (success) w.org.reputation = clamp(w.org.reputation + 3, 0, 100);
    this.emit({
      type: "marketing_campaign", importance: success ? 3 : 2,
      headline: success ? `Marketing campaign lands — ${w.org.name} is everywhere` : `${w.org.name} runs a marketing push`,
      summary: `A ${this.money(cost)} campaign${lead ? ` led by ${lead.name}` : ""} ${success ? `catches fire. Coverage in ${this.theme.press} and a measurable jump in inbound interest.` : "runs its course with modest results."}`,
      actorIds: lead ? [lead.id] : [],
      deptId: lead?.deptId ?? null,
      data: { cost, success },
    });
  }

  private openOffice(): void {
    const w = this.world;
    const used = new Set([...w.buildings.values()].map((b) => b.city));
    const cities = this.theme.cities.filter((c) => !used.has(c));
    if (cities.length === 0) return;
    const b: Building = {
      id: this.nextId(),
      city: this.rng.pick(cities),
      name: "",
      openedDay: w.org.day, closedDay: null,
      capacity: this.rng.int(40, 160),
    };
    b.name = `${b.city} Office`;
    w.buildings.set(b.id, b);
    this.touch("buildings", b.id);
    w.org.cash -= b.capacity * 6000;
    this.emit({
      type: "office_opened", importance: 3,
      headline: `${w.org.name} opens ${b.city} office`,
      summary: `Growth forces the question and ${b.city} wins the answer: a new office with room for ${b.capacity} opens its doors.`,
      data: { city: b.city, capacity: b.capacity },
    });
  }

  /** ---------- incidents & external threats ---------- */

  private rollIncidents(): void {
    const w = this.world;
    const security = this.pickByFn("security");
    const secStrength = security ? security.skill / 100 : 0;
    const pAttack = clamp(0.0035 + this.getPressure("security_threat") * 0.01 + this.getPressure("fame") * 0.002 - secStrength * 0.002, 0.0012, 0.05);
    if (this.rng.chance(pAttack)) this.cyberAttack();

    if (this.getPressure("espionage_target") > 0.3 && this.rng.chance(0.004 + this.getPressure("espionage_target") * 0.004)) {
      this.espionage();
    }
    if (this.rng.chance(0.0015 + this.getPressure("legal_risk") * 0.006)) this.lawsuit(null, "a commercial dispute", this.rng.pick([
      "breach of contract", "misuse of proprietary information", "unpaid invoices", "defamation", "patent infringement",
    ]));
    // Unhappy clients complain.
    for (const c of w.clients.values()) {
      if (c.status === "active" && this.rng.chance(0.0008)) this.clientComplaint(c);
    }
  }

  private cyberAttack(): void {
    const w = this.world;
    const security = this.pickByFn("security");
    const vector = this.rng.pick(this.theme.attackVector);
    const contained = this.rng.chance(0.55 + (security ? security.skill / 250 : 0));
    this.pressure("security_threat", 0.2);

    if (contained) {
      this.emit({
        type: "security_incident", importance: 2,
        headline: `Attempted intrusion contained`,
        summary: `An attack via ${vector} is detected and contained${security ? ` by ${security.name}'s team` : ""} before any data is taken. Systems are patched; a post-incident review is scheduled.`,
        actorIds: security ? [security.id] : [],
        deptId: security?.deptId ?? null,
        data: { vector, contained: true },
      });
      return;
    }
    const severe = this.rng.chance(0.4);
    const repHit = severe ? this.rng.int(8, 16) : this.rng.int(3, 7);
    w.org.reputation = clamp(w.org.reputation - repHit, 0, 100);
    this.pressure("legal_risk", severe ? 0.6 : 0.25);
    this.pressure("scandal", severe ? 0.5 : 0.2);
    const ev = this.emit({
      type: "data_breach", importance: severe ? 5 : 4,
      headline: severe ? `Major data breach at ${w.org.name}` : `${w.org.name} suffers a data breach`,
      summary: `Attackers get in through ${vector}. ${severe ? `Sensitive records are exfiltrated at scale; ${this.theme.press} runs the story within hours. Reputation takes a ${repHit}-point hit.` : `The intrusion is caught late; a limited data set is exposed. Reputation drops ${repHit} points.`}`,
      actorIds: security ? [security.id] : [],
      deptId: security?.deptId ?? null,
      data: { vector, severe, repHit },
    });
    if (this.rng.chance(severe ? 0.6 : 0.25)) this.schedule(this.rng.int(20, 70), "gov_investigation", ev.id, {});
    if (this.rng.chance(0.35)) this.schedule(this.rng.int(10, 50), "client_fallout", ev.id, {});
    if (this.rng.chance(severe ? 0.5 : 0.2)) this.schedule(this.rng.int(40, 160), "breach_lawsuit", ev.id, {});
    if (severe) this.schedule(this.rng.int(30, 90), "scandal_pressure_check", ev.id, {});
    // Breaches usually trigger security investment.
    if (!this.pickByFn("security") && this.rng.chance(0.7)) {
      const spec = this.theme.expansionDepts.find((d) => d.fn === "security");
      if (spec && !openDepartments(w).some((d) => d.name === spec.name)) this.createDepartment(spec.name, spec.fn, ev.id);
    }
  }

  private espionage(): void {
    const w = this.world;
    const techs = [...w.technologies.values()].filter((t) => t.potency > 60 && t.status !== "abandoned");
    if (techs.length === 0) return;
    const tech = this.rng.pick(techs);
    const insider = this.rng.chance(0.35);
    this.pressure("security_threat", 0.3);
    if (insider) {
      const staff = activeEmployees(w).filter((e) => e.happiness < 50);
      const mole = staff.length > 0 ? this.rng.pick(staff) : null;
      const ev = this.emit({
        type: "espionage", importance: 4,
        headline: `Industrial espionage: the ${tech.name} targeted from within`,
        summary: `Evidence emerges that details of the ${tech.name} were passed to a competitor${mole ? ". Suspicion falls on an insider" : ""}. Counterintelligence review begins.`,
        actorIds: mole ? [mole.id] : [],
        data: { techId: tech.id, insider: true },
      });
      this.pressure("tech_leaked", 0.5);
      if (mole) this.schedule(this.rng.int(10, 45), "misconduct_result", ev.id, { empId: mole.id, kind: "leaking confidential material to a competitor" });
    } else {
      this.emit({
        type: "espionage", importance: 3,
        headline: `Espionage attempt against the ${tech.name} thwarted`,
        summary: `An outside attempt to steal the ${tech.name} — via ${this.rng.pick(this.theme.attackVector)} — is detected and blocked. The ${this.theme.orgNoun} quietly hardens its defenses.`,
        data: { techId: tech.id, insider: false },
      });
    }
  }

  lawsuit(causeId: number | null, context: string, claim: string): void {
    const w = this.world;
    const legal = this.pickByFn("legal");
    const amount = this.rng.int(5, 250) * 10000;
    const ev = this.emit({
      type: "lawsuit_filed", importance: amount > 1_000_000 ? 4 : 3,
      headline: `${w.org.name} sued for ${claim}`,
      summary: `A lawsuit alleging ${claim} is filed against ${w.org.name}, arising from ${context}. Damages sought: ${this.money(amount)}.${legal ? ` ${legal.name} leads the defense.` : " The organization has no in-house counsel and scrambles for outside representation."}`,
      actorIds: legal ? [legal.id] : [],
      causeIds: causeId !== null ? [causeId] : [],
      data: { claim, amount },
    });
    this.schedule(this.rng.int(90, 420), "lawsuit_resolution", ev.id, { amount, claim });
  }

  private clientComplaint(c: Client): void {
    const ev = this.emit({
      type: "complaint", importance: 1,
      headline: `${c.name} files a formal complaint`,
      summary: `${c.name} escalates dissatisfaction with service quality. Account managers scramble to respond before the renewal conversation.`,
      clientId: c.id,
    });
    if (this.rng.chance(0.3)) this.schedule(this.rng.int(20, 90), "client_churn", ev.id, { clientId: c.id });
  }

  /** ---------- scheduled consequence handlers ---------- */

  private processScheduled(): void {
    const w = this.world;
    const due: ScheduledItem[] = [];
    w.scheduled = w.scheduled.filter((s) => (s.dueDay <= w.org.day ? (due.push(s), false) : true));
    for (const s of due) this.handleScheduled(s);
  }

  private handleScheduled(s: ScheduledItem): void {
    const w = this.world;
    const cause = s.causeId !== null ? [s.causeId] : [];
    switch (s.kind) {
      case "productize_tech": {
        const tech = w.technologies.get(s.payload.techId as number);
        if (tech && tech.status !== "abandoned" && activeProjects(w).length < Math.max(3, activeEmployees(w).length / 7)) {
          this.maybeStartProject(s.causeId, false, undefined);
        }
        break;
      }
      case "tech_revival_check": {
        const tech = w.technologies.get(s.payload.techId as number);
        if (!tech || tech.status !== "abandoned") break;
        const curious = activeEmployees(w).filter((e) => e.personality.openness > 65 && e.skill > 55);
        if (curious.length > 0 && this.rng.chance(0.5)) {
          this.maybeStartProject(s.causeId, true, tech);
        } else {
          this.schedule(this.rng.int(400, 1500), "tech_revival_check", s.causeId, s.payload);
        }
        break;
      }
      case "fill_dept_head": {
        const dept = w.departments.get(s.payload.deptId as number);
        if (!dept || dept.closedDay !== null || dept.headId !== null) break;
        const members = activeEmployees(w).filter((e) => e.deptId === dept.id);
        if (members.length === 0) break;
        const successor = members.reduce((a, b) => (a.reputation >= b.reputation ? a : b));
        successor.level = 6;
        this.promote(successor, s.causeId);
        dept.headId = successor.id;
        this.touch("departments", dept.id);
        break;
      }
      case "escalate_conflict": {
        const a = w.employees.get(s.payload.aId as number);
        const b = w.employees.get(s.payload.bId as number);
        if (!a || !b || a.status !== "active" || b.status !== "active") break;
        const hr = this.pickByFn("hr");
        const loser = this.rng.chance(0.5) ? a : b;
        const winner = loser === a ? b : a;
        if (hr && this.rng.chance(0.55)) {
          this.emit({
            type: "mediation", importance: 2,
            headline: `HR mediates the ${a.name}–${b.name} dispute`,
            summary: `${hr.name} brokers a fragile truce between ${a.name} and ${b.name}. The rivalry cools — officially.`,
            actorIds: [a.id, b.id, hr.id], deptId: a.deptId, causeIds: cause,
          });
          this.setRel(a.id, b.id, "rival", -20);
        } else if (this.rng.chance(0.4)) {
          this.departure(loser, "resigned", s.causeId, `after an unresolved conflict with ${winner.name}`);
        }
        break;
      }
      case "misconduct_result": {
        const emp = w.employees.get(s.payload.empId as number);
        if (!emp || emp.status !== "active") break;
        const kind = String(s.payload.kind);
        const guilty = this.rng.chance(0.65);
        if (guilty) {
          const ev = this.emit({
            type: "investigation_concluded", importance: 3,
            headline: `Investigation finds against ${emp.name}`,
            summary: `The internal investigation into ${kind} concludes that the allegations are substantiated. Termination proceedings begin immediately.`,
            actorIds: [emp.id], deptId: emp.deptId, causeIds: cause,
          });
          this.departure(emp, "fired", ev.id, `following a substantiated finding of ${kind}`);
        } else {
          this.emit({
            type: "investigation_concluded", importance: 2,
            headline: `${emp.name} cleared of allegations`,
            summary: `The investigation into ${kind} finds insufficient evidence. ${emp.name} returns to work, though the episode leaves a mark.`,
            actorIds: [emp.id], deptId: emp.deptId, causeIds: cause,
          });
          emp.happiness = clamp(emp.happiness - 10, 0, 100);
          this.touch("employees", emp.id);
        }
        break;
      }
      case "wrongful_termination_suit": {
        const emp = w.employees.get(s.payload.empId as number);
        if (emp) this.lawsuit(s.causeId, `the termination of ${emp.name}`, "wrongful termination");
        break;
      }
      case "breach_lawsuit":
        this.lawsuit(s.causeId, "the recent data breach", "negligent data protection");
        break;
      case "patent_suit":
        this.lawsuit(s.causeId, "a recently launched product", "patent infringement");
        break;
      case "lawsuit_resolution": {
        const amount = s.payload.amount as number;
        const claim = String(s.payload.claim);
        const legal = this.pickByFn("legal");
        const winChance = 0.35 + (legal ? legal.skill / 250 : 0);
        if (this.rng.chance(winChance)) {
          this.emit({
            type: "lawsuit_settled", importance: 2,
            headline: `${w.org.name} prevails in ${claim} suit`,
            summary: `The ${claim} lawsuit collapses${legal ? ` under ${legal.name}'s defense` : ""}. No damages are paid; legal fees sting anyway.`,
            actorIds: legal ? [legal.id] : [], causeIds: cause,
          });
          w.org.cash -= 40_000;
        } else {
          const paid = Math.round(amount * this.rng.float(0.3, 1));
          w.org.cash -= paid;
          w.org.reputation = clamp(w.org.reputation - 3, 0, 100);
          this.emit({
            type: "lawsuit_settled", importance: paid > 800_000 ? 4 : 3,
            headline: `${w.org.name} settles ${claim} suit for ${this.money(paid)}`,
            summary: `Rather than risk trial, ${w.org.name} settles the ${claim} claim for ${this.money(paid)}. The board is not pleased.`,
            actorIds: legal ? [legal.id] : [], causeIds: cause,
            data: { paid },
          });
        }
        break;
      }
      case "gov_investigation": {
        const ev = this.emit({
          type: "government_investigation", importance: 4,
          headline: `${this.theme.regulator} opens investigation into ${w.org.name}`,
          summary: `Citing recent events, ${this.theme.regulator} opens a formal inquiry. Document preservation notices go out; lawyers cancel their vacations.`,
          causeIds: cause,
        });
        this.pressure("scandal", 0.3);
        this.schedule(this.rng.int(60, 240), "gov_investigation_result", ev.id, {});
        break;
      }
      case "gov_investigation_result": {
        if (this.rng.chance(0.45)) {
          w.org.reputation = clamp(w.org.reputation + 3, 0, 100);
          this.emit({
            type: "investigation_concluded", importance: 3,
            headline: `${w.org.name} cleared by ${this.theme.regulator}`,
            summary: `The inquiry ends without findings of wrongdoing. Leadership exhales; the press release writes itself.`,
            causeIds: cause,
          });
        } else {
          const fine = this.rng.int(20, 300) * 10000;
          w.org.cash -= fine;
          w.org.reputation = clamp(w.org.reputation - 6, 0, 100);
          this.pressure("scandal", 0.4);
          this.emit({
            type: "regulatory_fine", importance: 4,
            headline: `${this.theme.regulator} fines ${w.org.name} ${this.money(fine)}`,
            summary: `The investigation concludes with a ${this.money(fine)} penalty and a compliance mandate. ${this.theme.press} covers it prominently.`,
            causeIds: cause, data: { fine },
          });
        }
        break;
      }
      case "client_fallout": {
        const clients = [...w.clients.values()].filter((c) => c.status === "active");
        if (clients.length === 0) break;
        const c = this.rng.pick(clients);
        this.loseClient(c, s.causeId, "citing the recent security failures");
        break;
      }
      case "client_churn": {
        const c = w.clients.get(s.payload.clientId as number);
        if (c && c.status === "active" && this.rng.chance(0.6)) this.loseClient(c, s.causeId, "after months of unresolved complaints");
        break;
      }
      case "scandal_pressure_check": {
        if (this.getPressure("scandal") > 1.1) this.ceoResignation(s.causeId);
        break;
      }
      case "poach_attempt": {
        const emp = w.employees.get(s.payload.empId as number);
        if (emp && emp.status === "active" && emp.happiness < 60 && this.rng.chance(0.5)) {
          this.departure(emp, "resigned", s.causeId, "poached by a competitor with an offer too large to refuse");
        }
        break;
      }
    }
  }

  loseClient(c: Client, causeId: number | null, reason: string): void {
    c.status = "lost";
    c.lostDay = this.world.org.day;
    this.touch("clients", c.id);
    this.emit({
      type: "client_lost", importance: c.annualValue > 400_000 ? 3 : 2,
      headline: `${c.name} terminates its contract`,
      summary: `${c.name} walks away from ${this.money(c.annualValue)}/yr, ${reason}. The revenue hole is immediate.`,
      clientId: c.id,
      causeIds: causeId !== null ? [causeId] : [],
    });
  }

  private ceoResignation(causeId: number | null): void {
    const w = this.world;
    const ceo = w.employees.get(w.org.ceoId ?? -1);
    if (!ceo || ceo.status !== "active") return;
    const ev = this.emit({
      type: "ceo_resignation", importance: 5,
      headline: `${ceo.name} resigns as ${this.theme.ceoTitle}`,
      summary: `Under mounting pressure, ${ceo.name} announces their resignation after ${Math.round((w.org.day - ceo.hiredDay) / 365 * 10) / 10} years at the helm. "The organization deserves a fresh start," the statement reads. Few believe it was voluntary.`,
      actorIds: [ceo.id],
      causeIds: causeId !== null ? [causeId] : [],
    });
    ceo.status = "resigned";
    ceo.leftDay = w.org.day;
    this.touch("employees", ceo.id);
    this.world.pressures["scandal"] = 0.2;
    this.appointCeo(ev.id);
  }

  private appointCeo(causeId: number | null): void {
    const w = this.world;
    const cands = activeEmployees(w).filter((e) => e.level >= 6);
    let successor: Employee;
    if (cands.length > 0) {
      successor = cands.reduce((a, b) => (a.reputation >= b.reputation ? a : b));
    } else {
      successor = this.makeEmployee("executive", null, 7);
    }
    successor.level = 7;
    successor.role = this.theme.ceoTitle;
    successor.salary = this.salaryFor(7, successor.skill);
    w.org.ceoId = successor.id;
    this.touch("employees", successor.id);
    this.emit({
      type: "ceo_appointed", importance: 5,
      headline: `${successor.name} appointed ${this.theme.ceoTitle}`,
      summary: `The board names ${successor.name} as the new ${this.theme.ceoTitle}. ${successor.personality.ambition > 70 ? "Insiders describe the pick as ambitious — perhaps dangerously so." : "The choice is read as a steady hand for turbulent times."}`,
      actorIds: [successor.id],
      causeIds: causeId !== null ? [causeId] : [],
    });
  }

  /** ---------- periodic cycles ---------- */

  private monthly(): void {
    const w = this.world;
    const staff = activeEmployees(w);
    const payroll = staff.reduce((s, e) => s + e.salary, 0) / 12;
    const overhead = staff.length * 900 + [...w.buildings.values()].filter((b) => b.closedDay === null).length * 15000;

    let revenue = 0;
    for (const p of w.products.values()) if (p.status !== "discontinued") revenue += p.annualRevenue / 12;
    for (const c of w.clients.values()) if (c.status === "active") revenue += c.annualValue / 12;
    const publicKinds: OrgKind[] = ["space_agency", "intelligence_agency", "fantasy_kingdom"];
    if (publicKinds.includes(w.org.kind)) {
      revenue += staff.length * 10500 * (0.6 + w.org.reputation / 125);
    }
    revenue *= 0.6 + w.org.reputation / 125;

    w.org.cash += revenue - payroll - overhead;

    // Emotional drift toward baseline; morale drift.
    for (const e of staff) {
      const dept = this.deptOf(e);
      const target = clamp(52 + ((dept?.morale ?? 50) - 50) / 3 - e.stress / 5, 5, 95);
      // Rounded so the in-memory value matches its integer-affinity DB column
      // exactly — a prerequisite for deterministic continuation after reload.
      e.happiness = clamp(Math.round(e.happiness + (target - e.happiness) * 0.15), 0, 100);
      e.stress = clamp(e.stress - 3, 0, 100);
      this.touch("employees", e.id);
    }
    for (const d of openDepartments(w)) {
      d.morale = clamp(Math.round(d.morale + (55 - d.morale) * 0.08), 0, 100);
      this.touch("departments", d.id);
    }

    // Retirements.
    for (const e of staff) {
      if (this.age(e) >= 63 && this.rng.chance(0.04)) {
        if (e.id === w.org.ceoId) {
          const ev = this.departure(e, "retired", null, "closing a long career at the top");
          this.appointCeo(ev.id);
        } else {
          this.departure(e, "retired", null, "trading deadlines for mornings without alarms");
        }
      }
    }

    // Poaching pressure against stars when the org is famous.
    if (this.getPressure("fame") > 0.6 && staff.length > 5 && this.rng.chance(0.3)) {
      const star = staff.reduce((a, b) => (a.skill >= b.skill ? a : b));
      this.schedule(this.rng.int(5, 25), "poach_attempt", null, { empId: star.id });
    }

    this.monthlyProjectReview();
    this.financialHealthCheck(payroll);
  }

  private financialHealthCheck(payroll: number): void {
    const w = this.world;
    if (w.org.cash > payroll * 4) return;
    const isCompany = !["space_agency", "intelligence_agency", "fantasy_kingdom"].includes(w.org.kind);

    if (w.org.cash > 0 && w.org.reputation > 32 && this.rng.chance(0.7)) {
      // Rescue funding before it gets ugly.
      const raise = Math.round(payroll * this.rng.float(10, 20));
      w.org.cash += raise;
      this.emit({
        type: "funding_round", importance: 4,
        headline: isCompany ? `${w.org.name} raises ${this.money(raise)}` : `${w.org.name} secures emergency appropriation of ${this.money(raise)}`,
        summary: isCompany
          ? `With runway shrinking, leadership closes a ${this.money(raise)} funding round. The terms are not disclosed; the relief is visible.`
          : `After tense hearings, ${this.theme.regulator} approves an emergency appropriation of ${this.money(raise)}. Conditions apply.`,
        data: { raise },
      });
      return;
    }
    if (w.org.cash > -payroll * 2) return;

    // Full financial crisis.
    const staff = activeEmployees(w);
    const cutN = Math.max(1, Math.floor(staff.length * this.rng.float(0.1, 0.25)));
    const crisisEv = this.emit({
      type: "financial_crisis", importance: 5,
      headline: `Financial crisis at ${w.org.name}`,
      summary: `The numbers no longer work: obligations exceed cash and creditors are calling. Leadership announces emergency measures, including the elimination of ${cutN} positions.`,
      data: { cutN },
    });
    this.pressure("scandal", 0.4);
    const ranked = staff.filter((e) => e.level < 7).sort((a, b) => (a.skill + a.reputation) - (b.skill + b.reputation));
    for (const victim of ranked.slice(0, cutN)) {
      this.departure(victim, "fired", crisisEv.id, "as part of emergency cost reductions");
    }
    for (const d of openDepartments(w)) { d.morale = clamp(d.morale - 18, 0, 100); this.touch("departments", d.id); }
    w.org.cash += payroll * 6; // bridge financing / creditor standstill
    w.org.reputation = clamp(w.org.reputation - 5, 0, 100);
    this.schedule(this.rng.int(30, 60), "scandal_pressure_check", crisisEv.id, {});
  }

  private quarterly(): void {
    const w = this.world;
    const staff = activeEmployees(w);
    const payroll = staff.reduce((s, e) => s + e.salary, 0) / 12;
    this.emit({
      type: "board_meeting", importance: 2,
      headline: `Quarterly ${w.org.kind === "fantasy_kingdom" ? "council of lords" : "board meeting"} convenes`,
      summary: `Leadership reviews the quarter: ${staff.length} personnel, ${activeProjects(w).length} active projects, cash position ${this.money(w.org.cash)}, monthly payroll ${this.money(payroll)}. Reputation stands at ${Math.round(w.org.reputation)}/100.`,
      actorIds: w.org.ceoId !== null ? [w.org.ceoId] : [],
      data: { headcount: staff.length, cash: Math.round(w.org.cash), reputation: Math.round(w.org.reputation) },
    });
  }

  private annual(): void {
    const w = this.world;
    const year = Math.floor(w.org.day / 365);

    // Product lifecycle drift.
    for (const p of w.products.values()) {
      if (p.status === "discontinued") continue;
      const ageYears = (w.org.day - p.launchDay) / 365;
      const leak = this.getPressure("tech_leaked");
      if (p.status === "growing") {
        p.annualRevenue = Math.round(p.annualRevenue * this.rng.float(1.05, 1.35) * (1 - leak * 0.15));
        if (ageYears > 3 || this.rng.chance(0.25)) p.status = "mature";
      } else if (p.status === "mature") {
        p.annualRevenue = Math.round(p.annualRevenue * this.rng.float(0.9, 1.1));
        if (ageYears > 6 && this.rng.chance(0.35)) p.status = "declining";
      } else {
        p.annualRevenue = Math.round(p.annualRevenue * this.rng.float(0.6, 0.85));
        if (p.annualRevenue < 80_000) {
          p.status = "discontinued";
          p.discontinuedDay = w.org.day;
          this.emit({
            type: "product_discontinued", importance: 2,
            headline: `${p.name} discontinued`,
            summary: `After ${Math.round(ageYears)} years, ${p.name} is retired. A loyal handful of users mourn; the balance sheet does not.`,
            productId: p.id,
          });
        }
      }
      this.touch("products", p.id);
    }

    // Annual reviews: a few promotions, a few disappointments.
    const staff = activeEmployees(w);
    const reviewed = this.rng.sample(staff.filter((e) => e.level < 6), Math.min(8, staff.length));
    for (const e of reviewed) {
      const score = e.skill * 0.5 + e.personality.diligence * 0.3 + this.rng.int(0, 25);
      if (score > 75 && e.level < 6) {
        this.promote(e, null);
      } else if (score < 30 && this.rng.chance(0.4)) {
        this.departure(e, "fired", null, "after a performance review that left no room for interpretation");
      }
    }

    // Industry recognition when the org is in the public eye.
    if (this.getPressure("fame") > 0.5 && staff.length > 0 && this.rng.chance(0.6)) {
      const star = staff.reduce((a, b) => (a.reputation >= b.reputation ? a : b));
      star.achievements++;
      star.reputation = clamp(star.reputation + 8, 0, 100);
      this.touch("employees", star.id);
      w.org.reputation = clamp(w.org.reputation + 2, 0, 100);
      this.emit({
        type: "award", importance: 3,
        headline: `${star.name} honored with an industry award`,
        summary: `${this.theme.press} names ${star.name} among the year's most influential figures, citing their work at ${w.org.name}.`,
        actorIds: [star.id], deptId: star.deptId,
      });
    }

    if (year > 0 && year % 5 === 0) {
      this.emit({
        type: "anniversary", importance: 3,
        headline: `${w.org.name} marks ${year} years`,
        summary: `${w.org.name} turns ${year}. ${w.employees.size} people have passed through its doors; ${w.products.size} products, ${w.projects.size} projects and ${w.technologies.size} technologies carry its fingerprints.`,
        actorIds: w.org.ceoId !== null ? [w.org.ceoId] : [],
      });
    }
  }
}
