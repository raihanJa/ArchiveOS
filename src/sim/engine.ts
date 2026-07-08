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
  Building, Client, Department, DeptFunction, Employee, Memory, MemoryCategory,
  Mood, OpinionSource, OrgKind, OrgState, Personality, PersonalMemory, Product,
  Project, RelDimension, Relationship, ReputationTag, RelTimelineEntry, Rumor,
  RumorTruth, ScandalTier, Secret, SecretKind, SimDocument, SimEvent, Technology,
  Witness, WitnessTier,
} from "../shared/types";
import {
  MAJOR_MEMORY, REL_DIMENSIONS, emptyDims, formatSimDate as fmtDate,
  personalityCompatibility, relOverall, relStatusFromDims,
} from "../shared/types";
import { opinionKey, repKey } from "./world";
import { composeDocs, type DocCtx, type DocDraft } from "./docs";

/** Everything produced since the last drain(); the host flushes it to SQLite. */
export interface TickOutput {
  events: SimEvent[];
  documents: SimDocument[];
  /** Append-only archival records (never mutated after emission). */
  relTimeline: RelTimelineEntry[];
  personalMemories: PersonalMemory[];
  witnesses: Witness[];
  dirty: {
    employees: Set<number>;
    departments: Set<number>;
    projects: Set<number>;
    technologies: Set<number>;
    products: Set<number>;
    clients: Set<number>;
    buildings: Set<number>;
    relationships: Set<string>;
    memories: Set<number>;
    opinions: Set<string>;
    secrets: Set<number>;
    rumors: Set<number>;
    reputationMarks: Set<string>;
  };
}

function emptyOutput(): TickOutput {
  return {
    events: [],
    documents: [],
    relTimeline: [],
    personalMemories: [],
    witnesses: [],
    dirty: {
      employees: new Set(), departments: new Set(), projects: new Set(),
      technologies: new Set(), products: new Set(), clients: new Set(),
      buildings: new Set(), relationships: new Set(), memories: new Set(),
      opinions: new Set(), secrets: new Set(), rumors: new Set(),
      reputationMarks: new Set(),
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
      criticalScandals: 0,
    };
    const world: WorldState = {
      org,
      employees: new Map(), departments: new Map(), projects: new Map(),
      technologies: new Map(), products: new Map(), clients: new Map(),
      buildings: new Map(), relationships: new Map(), memories: new Map(),
      opinions: new Map(), secrets: new Map(), rumors: new Map(),
      reputationMarks: new Map(),
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
    this.recordWitnesses(ev);
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

  touch<K extends keyof TickOutput["dirty"]>(set: K, id: K extends "relationships" | "opinions" | "reputationMarks" ? string : number): void {
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
        volatility: this.rng.int(5, 90), integrity: this.rng.int(20, 95),
        narcissism: this.rng.int(5, 85),
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
      mood: "content",
      moodDay: this.world.org.day,
    };
    emp.salary = this.salaryFor(level, skill);
    this.world.employees.set(emp.id, emp);
    this.touch("employees", emp.id);
    this.maybeAcquireSecret(emp);
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

  private rel(aId: number, bId: number): Relationship | undefined {
    return this.world.relationships.get(relKey(aId, bId));
  }

  private ensureRel(aId: number, bId: number): Relationship {
    const key = relKey(aId, bId);
    let r = this.world.relationships.get(key);
    if (!r) {
      r = {
        aId: Math.min(aId, bId), bId: Math.max(aId, bId),
        dims: emptyDims(), status: "acquaintance",
        sinceDay: this.world.org.day, lastInteractionDay: this.world.org.day,
      };
      this.world.relationships.set(key, r);
    }
    return r;
  }

  /** Symmetric personality compatibility, -100..100 (shared pure function). */
  compatibility(a: Personality, b: Personality): number {
    return personalityCompatibility(a, b);
  }

  /**
   * The single mutation point for relationships. Applies signed deltas to
   * dimensions (rounded/clamped at mutation for determinism), recomputes the
   * derived status, writes a timeline entry explaining the change, and
   * optionally records a lasting memory. Nothing changes without a reason.
   */
  adjustRel(
    aId: number, bId: number,
    deltas: Partial<Record<RelDimension, number>>,
    opts: {
      reason: string;
      causeEventId?: number | null;
      memory?: { category: MemoryCategory; importance: number; emotionalImpact: number };
    },
  ): void {
    if (aId === bId) return;
    const r = this.ensureRel(aId, bId);
    const before = relOverall(r.dims);
    for (const dim of Object.keys(deltas) as RelDimension[]) {
      const delta = deltas[dim];
      if (delta === undefined || delta === 0) continue;
      r.dims[dim] = clamp(Math.round(r.dims[dim] + delta), -100, 100);
    }
    r.lastInteractionDay = this.world.org.day;
    r.status = relStatusFromDims(r.dims);
    const key = relKey(aId, bId);
    this.touch("relationships", key);

    const net = relOverall(r.dims) - before;
    this.out.relTimeline.push({
      id: this.nextId(), aId: r.aId, bId: r.bId, day: this.world.org.day,
      delta: net, reason: opts.reason, eventId: opts.causeEventId ?? null,
    });
    if (opts.memory) {
      const m: Memory = {
        id: this.nextId(), aId: r.aId, bId: r.bId,
        category: opts.memory.category, day: this.world.org.day,
        importance: clamp(Math.round(opts.memory.importance), 1, 100),
        emotionalImpact: clamp(Math.round(opts.memory.emotionalImpact), -100, 100),
        eventId: opts.causeEventId ?? null, text: opts.reason,
      };
      this.world.memories.set(m.id, m);
      this.touch("memories", m.id);
      // A high-impact shared moment colours both people's emotional state.
      if (Math.abs(opts.memory.emotionalImpact) >= 50) {
        const mood = this.moodFor(opts.memory.category, opts.memory.emotionalImpact);
        for (const id of [aId, bId]) {
          const p = this.world.employees.get(id);
          if (p && p.status === "active") this.setMood(p, mood);
        }
      }
    }
  }

  /**
   * Monthly social decay (pure, no RNG so it is order-independent). Memories
   * fade — minor ones toward nothing, major ones barely — and neglected
   * relationships drift back toward neutral unless anchored by a major memory.
   * Floats are rounded at mutation so the in-memory value matches its DB column.
   */
  private decaySocial(): void {
    const w = this.world;
    const day = w.org.day;
    const anchored = new Set<string>();
    for (const m of w.memories.values()) {
      if (m.importance <= 0) continue;
      const major = m.importance >= MAJOR_MEMORY;
      if (major) anchored.add(relKey(m.aId, m.bId));
      const rate = major ? 0.004 : 0.05;
      const next = clamp(Math.round(m.importance * (1 - rate)) - (major ? 0 : 1), 0, 100);
      if (next !== m.importance) { m.importance = next; this.touch("memories", m.id); }
    }
    for (const r of w.relationships.values()) {
      const monthsIdle = (day - r.lastInteractionDay) / 30;
      if (monthsIdle < 1) continue;
      const rate = (anchored.has(relKey(r.aId, r.bId)) ? 0.01 : 0.03) * Math.min(3, monthsIdle);
      let changed = false;
      for (const dim of REL_DIMENSIONS) {
        const before = r.dims[dim];
        if (before === 0) continue;
        let next = clamp(Math.round(before * (1 - rate)), -100, 100);
        // Nudge stubborn small magnitudes toward zero so drift never stalls.
        if (next === before) next = before - Math.sign(before);
        if (next !== before) { r.dims[dim] = next; changed = true; }
      }
      if (changed) { r.status = relStatusFromDims(r.dims); this.touch("relationships", relKey(r.aId, r.bId)); }
    }
    this.decayOpinions();
  }

  /** ---------- opinions, moods, witnesses, reputation ---------- */

  /** Update holderId's directional opinion of subjectId. */
  adjustOpinion(holderId: number, subjectId: number, delta: number, source: OpinionSource, note: string): void {
    if (holderId === subjectId || delta === 0) return;
    const key = opinionKey(holderId, subjectId);
    let o = this.world.opinions.get(key);
    if (!o) {
      o = { holderId, subjectId, sentiment: 0, source, confidence: 15, note, day: this.world.org.day };
      this.world.opinions.set(key, o);
    }
    o.sentiment = clamp(Math.round(o.sentiment + delta), -100, 100);
    o.confidence = clamp(Math.round(o.confidence + Math.abs(delta) * 0.4), 0, 100);
    o.source = source;
    o.note = note;
    o.day = this.world.org.day;
    this.touch("opinions", key);
  }

  /** Opinions drift toward the shared relationship signal when not reinforced. */
  private decayOpinions(): void {
    for (const o of this.world.opinions.values()) {
      const r = this.rel(o.holderId, o.subjectId);
      const anchor = r ? relOverall(r.dims) : 0;
      const next = clamp(Math.round(o.sentiment + (anchor - o.sentiment) * 0.06), -100, 100);
      const conf = clamp(Math.round(o.confidence * 0.98), 0, 100);
      if (next !== o.sentiment || conf !== o.confidence) {
        o.sentiment = next; o.confidence = conf;
        this.touch("opinions", opinionKey(o.holderId, o.subjectId));
      }
    }
  }

  private setMood(e: Employee, mood: Mood): void {
    if (e.mood === mood) return;
    e.mood = mood;
    e.moodDay = this.world.org.day;
    this.touch("employees", e.id);
  }

  private moodFor(category: MemoryCategory, impact: number): Mood {
    switch (category) {
      case "betrayal": return "angry";
      case "romantic_breakup": return "heartbroken";
      case "humiliation": return "ashamed";
      case "romance_started": return "inspired";
      case "promotion": return "proud";
      case "award": return "proud";
      case "saved_career": case "defense": return "motivated";
      case "completed_project": return "motivated";
      default: return impact >= 0 ? "inspired" : "angry";
    }
  }

  /** Event types dramatic enough to draw an audience and shape opinions. */
  private static readonly WITNESSED = new Set<string>([
    "conflict", "misconduct", "mediation", "investigation_concluded",
    "data_breach", "espionage", "romance_ended", "ceo_resignation",
    "financial_crisis", "secret_exposed", "scandal", "scandal_investigation",
    "scandal_resolved", "arrest", "cover_up",
  ]);

  private eventValence(type: string): number {
    switch (type) {
      case "arrest": case "secret_exposed": return -60;
      case "scandal": case "scandal_resolved": case "cover_up": return -45;
      case "misconduct": return -40;
      case "financial_crisis": return -32;
      case "data_breach": case "espionage": return -25;
      case "conflict": return -20;
      case "ceo_resignation": case "scandal_investigation": return -15;
      case "romance_ended": return -10;
      case "mediation": return 6;
      default: return 0;
    }
  }

  private interpretEvent(witness: Employee, ev: SimEvent, valence: number): string {
    const P = witness.personality;
    if (valence <= -30) {
      if (P.integrity > 65) return "Deeply disappointed by what happened";
      if (P.empathy > 65) return "Felt for everyone caught up in it";
      if (P.narcissism > 65) return "Mostly glad it wasn't them";
      return "Unsettled by the whole affair";
    }
    if (valence < 0) return P.volatility > 60 ? "Took it harder than most" : "Noted it and moved on";
    if (valence > 0) return "Left with a better impression";
    return "Formed their own quiet view of it";
  }

  /** Record who saw an event and let it shape their memories and opinions. */
  private recordWitnesses(ev: SimEvent): void {
    if (!Engine.WITNESSED.has(ev.type) || ev.actorIds.length === 0) return;
    const w = this.world;
    const actors = new Set(ev.actorIds);
    const actorDepts = new Set<number>();
    for (const id of ev.actorIds) { const a = w.employees.get(id); if (a?.deptId != null) actorDepts.add(a.deptId); }
    const audience = activeEmployees(w).filter((c) => !actors.has(c.id));
    const direct = audience.filter((c) => c.deptId != null && actorDepts.has(c.deptId));
    const distant = audience.filter((c) => !(c.deptId != null && actorDepts.has(c.deptId)));
    const valence = this.eventValence(ev.type);
    const picks: [Employee, WitnessTier][] = [
      ...this.rng.sample(direct, Math.min(direct.length, 5)).map((c) => [c, "direct"] as [Employee, WitnessTier]),
      ...this.rng.sample(distant, Math.min(distant.length, 3)).map((c) => [c, (this.rng.chance(0.5) ? "indirect" : "heard")] as [Employee, WitnessTier]),
    ];
    for (const [c, tier] of picks) {
      this.out.witnesses.push({ eventId: ev.id, empId: c.id, tier });
      const tierMag = tier === "direct" ? 1 : tier === "indirect" ? 0.6 : 0.3;
      const interp = this.interpretEvent(c, ev, valence);
      this.out.personalMemories.push({
        id: this.nextId(), holderId: c.id, eventId: ev.id,
        valence: clamp(Math.round(valence * tierMag * (0.7 + c.personality.empathy / 200)), -100, 100),
        interpretation: interp, day: w.org.day,
      });
      for (const actorId of ev.actorIds) {
        if (!w.employees.get(actorId)) continue;
        let delta = valence * tierMag * 0.5;
        if ((ev.type === "misconduct" || ev.type === "secret_exposed" || ev.type === "scandal") && c.personality.integrity > 65) delta -= 8;
        this.adjustOpinion(c.id, actorId, Math.round(delta), tier === "direct" ? "witnessed" : "rumor", interp);
      }
    }
  }

  private setReputationTag(empId: number, tag: ReputationTag, target: number): void {
    const key = repKey(empId, tag);
    let m = this.world.reputationMarks.get(key);
    if (!m) {
      if (target <= 0) return;
      m = { empId, tag, earnedDay: this.world.org.day, strength: 0 };
      this.world.reputationMarks.set(key, m);
    }
    const next = clamp(Math.round(m.strength + (target - m.strength) * 0.4), 0, 100);
    if (next !== m.strength) { m.strength = next; this.touch("reputationMarks", key); }
  }

  repStrength(empId: number, tag: ReputationTag): number {
    return this.world.reputationMarks.get(repKey(empId, tag))?.strength ?? 0;
  }

  /**
   * Derive organization-wide reputation tags from accumulated behaviour.
   * Pure (no RNG) and iterates employees in stable id order.
   */
  private deriveReputation(): void {
    const w = this.world;
    // Tally each person's memory categories once.
    const tally = new Map<number, Record<string, number>>();
    const bump = (id: number, k: string, n = 1) => {
      let t = tally.get(id); if (!t) { t = {}; tally.set(id, t); } t[k] = (t[k] ?? 0) + n;
    };
    for (const m of w.memories.values()) {
      if (m.importance <= 0) continue;
      bump(m.aId, m.category); bump(m.bId, m.category);
    }
    const exposedOwners = new Set<number>();
    for (const s of w.secrets.values()) if (s.status === "exposed") exposedOwners.add(s.ownerId);
    const fame = this.getPressure("fame");
    for (const e of activeEmployees(w)) {
      const t = tally.get(e.id) ?? {};
      const projects = t.completed_project ?? 0;
      const conflicts = (t.conflict ?? 0) + (t.betrayal ?? 0);
      this.setReputationTag(e.id, "reliable", e.achievements >= 3 && e.failures <= e.achievements ? 40 + projects * 3 : 0);
      this.setReputationTag(e.id, "brilliant", e.skill > 80 && e.achievements >= 2 ? 40 + (e.skill - 80) * 2 : 0);
      this.setReputationTag(e.id, "lazy", e.personality.diligence < 30 && e.achievements === 0 ? 45 : 0);
      this.setReputationTag(e.id, "aggressive", conflicts >= 2 && e.personality.empathy < 45 ? 30 + conflicts * 6 : 0);
      this.setReputationTag(e.id, "dishonest", exposedOwners.has(e.id) || e.personality.integrity < 25 ? 45 : 0);
      this.setReputationTag(e.id, "corrupt", exposedOwners.has(e.id) && e.personality.integrity < 35 ? 55 : 0);
      this.setReputationTag(e.id, "manipulator", e.personality.narcissism > 70 && e.personality.integrity < 40 ? 35 : 0);
      this.setReputationTag(e.id, "charismatic", e.personality.empathy > 70 && e.reputation > 65 ? 40 : 0);
      this.setReputationTag(e.id, "visionary", e.reputation > 75 && e.achievements >= 3 && fame > 0.4 ? 50 : 0);
    }
  }

  /** ---------- secrets ---------- */

  private static readonly SECRET_KINDS: SecretKind[] = [
    "gambling", "alcohol", "debt", "affair", "fake_diploma", "expense_fraud",
    "code_plagiarism", "data_theft", "espionage", "bribery", "blackmail",
    "secret_project", "side_business",
  ];

  private secretPhrase(kind: SecretKind): string {
    const map: Record<SecretKind, string> = {
      gambling: "a spiralling gambling habit",
      alcohol: "a hidden drinking problem",
      debt: "crushing personal debt kept quiet",
      affair: "a secret affair with a colleague",
      fake_diploma: "a fabricated academic credential",
      expense_fraud: "systematic expense fraud",
      code_plagiarism: "passing off others' work as their own",
      data_theft: "quietly siphoning internal data",
      espionage: "feeding secrets to a competitor",
      bribery: "taking bribes from a vendor",
      blackmail: "blackmailing a colleague",
      secret_project: "an unsanctioned skunkworks project",
      side_business: "running a competing business on the side",
    };
    return map[kind];
  }

  /** Severe secret kinds that, once exposed, can seed a real scandal. */
  private secretSeverityBase(kind: SecretKind): number {
    switch (kind) {
      case "espionage": case "data_theft": case "bribery": case "blackmail": return 70;
      case "expense_fraud": case "code_plagiarism": return 50;
      case "affair": case "fake_diploma": case "side_business": case "secret_project": return 35;
      default: return 22; // gambling, alcohol, debt — personal, lower stakes
    }
  }

  /** A minority of people carry a secret. Personality skews kind and severity. */
  private maybeAcquireSecret(e: Employee): void {
    const P = e.personality;
    const propensity = (100 - P.integrity) * 0.5 + P.narcissism * 0.3 + P.volatility * 0.2;
    if (!this.rng.chance(propensity / 100 * 0.14)) return;
    const kind = this.rng.pick(Engine.SECRET_KINDS);
    const severity = clamp(Math.round(this.secretSeverityBase(kind) + this.rng.int(-12, 20) + (100 - P.integrity) / 5), 5, 100);
    const secret: Secret = {
      id: this.nextId(), ownerId: e.id, kind, severity,
      discoveryChance: clamp(0.01 + severity / 4000 + P.volatility / 8000, 0.005, 0.06),
      knownBy: [e.id], suspectedBy: [], evidence: this.rng.int(0, 15),
      createdDay: this.world.org.day, exposedDay: null, status: "hidden",
    };
    this.world.secrets.set(secret.id, secret);
    this.touch("secrets", secret.id);
  }

  /** Monthly discovery roll across live secrets (id order — deterministic). */
  private runSecretDiscovery(): void {
    const w = this.world;
    const hasSecurity = !!this.pickByFn("security");
    for (const s of w.secrets.values()) {
      if (s.status === "exposed") continue;
      const owner = w.employees.get(s.ownerId);
      if (!owner || owner.status !== "active") continue;
      // Evidence quietly accumulates; nosy, ethical orgs surface more.
      s.evidence = clamp(Math.round(s.evidence + this.rng.int(0, 3) + (hasSecurity ? 1 : 0)), 0, 100);
      const chance = clamp(s.discoveryChance + s.evidence / 3000 + (hasSecurity ? 0.004 : 0), 0, 0.12);
      this.touch("secrets", s.id);
      if (!this.rng.chance(chance)) continue;

      if (s.status === "hidden") {
        // First it becomes suspected — whispers, not proof.
        s.status = "suspected";
        const colleagues = activeEmployees(w).filter((c) => c.id !== owner.id && c.deptId === owner.deptId);
        const suspecters = this.rng.sample(colleagues, Math.min(colleagues.length, this.rng.int(1, 3)));
        s.suspectedBy = suspecters.map((c) => c.id);
        this.touch("secrets", s.id);
        if (this.rng.chance(0.6)) {
          this.createRumor(owner.id, this.rng.chance(0.7) ? "distorted" : "true", `${owner.name} may be involved in ${this.secretPhrase(s.kind)}`, s.id);
        }
      } else {
        // Suspicion hardens into exposure.
        this.exposeSecret(s, null);
      }
    }
  }

  /** Bring a secret into the open — a public event and the seed of a scandal. */
  exposeSecret(s: Secret, causeId: number | null): SimEvent {
    const w = this.world;
    s.status = "exposed";
    s.exposedDay = w.org.day;
    this.touch("secrets", s.id);
    const owner = w.employees.get(s.ownerId);
    const ev = this.emit({
      type: "secret_exposed", importance: s.severity > 60 ? 4 : 3,
      headline: `${owner?.name ?? "An employee"}'s ${this.secretShort(s.kind)} comes to light`,
      summary: `What was hidden is now known: ${owner?.name ?? "the employee"} has been concealing ${this.secretPhrase(s.kind)}. The revelation lands hard${s.severity > 60 ? " and leadership treats it as a serious matter" : ""}.`,
      actorIds: owner ? [owner.id] : [], deptId: owner?.deptId ?? null,
      causeIds: causeId !== null ? [causeId] : [],
      data: { secretId: s.id, kind: s.kind, severity: s.severity },
    });
    // Confirm any matching rumor.
    for (const r of w.rumors.values()) {
      if (r.secretId === s.id && r.status === "spreading") {
        r.status = "confirmed"; this.touch("rumors", r.id);
      }
    }
    // A serious exposure escalates into the scandal machinery (Phase 4).
    this.onSecretExposed(s, ev);
    return ev;
  }

  private secretShort(kind: SecretKind): string {
    switch (kind) {
      case "espionage": return "espionage";
      case "data_theft": return "data theft";
      case "bribery": return "bribery";
      case "blackmail": return "blackmail scheme";
      case "expense_fraud": return "expense fraud";
      case "code_plagiarism": return "plagiarism";
      case "affair": return "affair";
      case "fake_diploma": return "fake credential";
      case "side_business": return "side business";
      case "secret_project": return "secret project";
      case "gambling": return "gambling problem";
      case "alcohol": return "drinking problem";
      case "debt": return "hidden debt";
    }
  }

  /** Default fallout when a secret is exposed. Phase 4 enriches this. */
  private onSecretExposed(s: Secret, ev: SimEvent): void {
    const owner = this.world.employees.get(s.ownerId);
    if (!owner || owner.status !== "active") return;
    owner.reputation = clamp(owner.reputation - Math.round(s.severity / 4), 0, 100);
    owner.happiness = clamp(owner.happiness - 20, 0, 100);
    this.setMood(owner, "ashamed");
    this.touch("employees", owner.id);
    this.pressure("scandal", s.severity / 200);
    this.pressure("legal_risk", s.severity / 300);
    // A serious secret becomes a full-blown scandal with an investigation;
    // lesser ones stay a personnel matter.
    if (s.severity >= 75) {
      this.openScandal(owner.id, "major", this.secretPhrase(s.kind), ev.id);
    } else if (s.severity >= 50) {
      this.openScandal(owner.id, "moderate", this.secretPhrase(s.kind), ev.id);
    } else if (this.rng.chance(0.5)) {
      this.schedule(this.rng.int(14, 60), "misconduct_result", ev.id, { empId: owner.id, kind: this.secretPhrase(s.kind) });
    }
  }

  /** ---------- rumors ---------- */

  createRumor(subjectId: number, truth: RumorTruth, text: string, secretId: number | null): Rumor | null {
    const w = this.world;
    const subject = w.employees.get(subjectId);
    if (!subject || subject.status !== "active") return null;
    // One live rumor per subject at a time keeps the mill from overflowing.
    for (const r of w.rumors.values()) {
      if (r.subjectId === subjectId && r.status === "spreading") return null;
    }
    const originPool = activeEmployees(w).filter((c) => c.id !== subjectId);
    const origin = originPool.length > 0 ? this.rng.pick(originPool) : null;
    const rumor: Rumor = {
      id: this.nextId(), originId: origin?.id ?? null, subjectId, text, truth,
      believability: truth === "true" ? this.rng.int(45, 70) : truth === "distorted" ? this.rng.int(35, 60) : this.rng.int(20, 50),
      spread: this.rng.int(3, 10),
      believers: [], skeptics: [], uncertain: origin ? [origin.id] : [],
      createdDay: w.org.day, status: "spreading", secretId,
    };
    if (origin) rumor.believers.push(origin.id);
    w.rumors.set(rumor.id, rumor);
    this.touch("rumors", rumor.id);
    return rumor;
  }

  /** Weekly organic spread. Iterates rumors in id order (deterministic). */
  private spreadRumors(): void {
    const w = this.world;
    for (const r of w.rumors.values()) {
      if (r.status !== "spreading") continue;
      const subject = w.employees.get(r.subjectId);
      if (!subject) { r.status = "faded"; this.touch("rumors", r.id); continue; }
      const prevSpread = r.spread;
      const known = new Set([...r.believers, ...r.skeptics, ...r.uncertain]);
      const pool = activeEmployees(w).filter((c) => c.id !== r.subjectId && !known.has(c.id));
      const reach = Math.max(1, Math.round(r.believability / 25 + r.spread / 40));
      const reached = this.rng.sample(pool, Math.min(pool.length, reach));
      for (const c of reached) {
        // Skeptical, high-integrity people resist; a poor opinion of the
        // subject makes the rumor easier to believe.
        const priorOpinion = this.world.opinions.get(opinionKey(c.id, r.subjectId))?.sentiment ?? 0;
        const skepticism = (c.personality.integrity + c.personality.diligence) / 2;
        const believeScore = r.believability - skepticism * 0.5 - priorOpinion * 0.3 + this.rng.int(-15, 15);
        if (believeScore > 15) {
          r.believers.push(c.id);
          this.adjustOpinion(c.id, r.subjectId, -Math.round(r.believability / 8), "rumor", `Heard that ${r.text}`);
        } else if (believeScore < -10) {
          r.skeptics.push(c.id);
        } else {
          r.uncertain.push(c.id);
        }
      }
      const audience = activeEmployees(w).length || 1;
      r.spread = clamp(Math.round((known.size + reached.length) / audience * 100), 0, 100);
      // Emit a single "it's everywhere now" moment as the rumor crosses into
      // wide circulation. Derived from the persisted spread so a reloaded world
      // makes the same decision (no transient flag to lose).
      if (prevSpread < 30 && r.spread >= 30 && r.believers.length >= 3) {
        this.emit({
          type: "rumor_spread", importance: 1,
          headline: `A rumor about ${subject.name} is making the rounds`,
          summary: `Word is spreading${r.truth === "false" ? " — however unfounded" : ""}: ${r.text}. It has reached a good part of the ${this.theme.orgNoun}.`,
          actorIds: [subject.id], deptId: subject.deptId,
          data: { rumorId: r.id, truth: r.truth },
        });
      }
      // Rumors burn out.
      if (w.org.day - r.createdDay > 200 || r.spread >= 85) {
        r.status = r.truth === "false" ? "debunked" : "faded";
      }
      this.touch("rumors", r.id);
    }
  }

  private maybeSpontaneousRumor(): void {
    const w = this.world;
    const staff = activeEmployees(w);
    if (staff.length < 6 || !this.rng.chance(0.05)) return;
    const subject = this.rng.pick(staff);
    const templates = [
      `${subject.name} is quietly interviewing elsewhere`,
      `${subject.name} is about to be pushed out`,
      `${subject.name} is secretly close with leadership`,
      `${subject.name} took credit for someone else's work`,
    ];
    this.createRumor(subject.id, "false", this.rng.pick(templates), null);
  }

  /** ---------- scandals & investigations ---------- */

  private scandalClaim(tier: ScandalTier): string {
    const pools: Record<ScandalTier, string[]> = {
      minor: ["persistent unprofessional conduct", "a minor policy breach", "repeatedly missed deadlines", "petty expense abuse"],
      moderate: ["workplace bullying", "discrimination", "a data leak", "document forgery", "harassment", "financial misconduct"],
      major: ["corporate espionage", "large-scale fraud", "systemic corruption", "sabotage", "blackmail", "illegal surveillance"],
      critical: ["a violent crime", "ties to organized crime", "a grave criminal offence", "kidnapping", "orchestrated terror"],
    };
    return this.rng.pick(pools[tier]);
  }

  private tierImportance(tier: ScandalTier): number {
    return tier === "critical" ? 5 : tier === "major" ? 4 : tier === "moderate" ? 3 : 2;
  }

  /**
   * Open a scandal against someone and kick off a document-generating
   * investigation that resolves weeks later (resignation, firing, lawsuit,
   * arrest or cover-up). Built entirely on the schedule()/handleScheduled()
   * consequence machinery.
   */
  openScandal(subjectId: number, tier: ScandalTier, claim: string, causeId: number | null): SimEvent {
    const w = this.world;
    const subject = w.employees.get(subjectId);
    const ev = this.emit({
      type: "scandal", importance: this.tierImportance(tier),
      headline: `${tier === "critical" ? "Grave scandal" : tier === "major" ? "Major scandal" : "Scandal"} engulfs ${subject?.name ?? "the organization"}`,
      summary: `Allegations of ${claim} against ${subject?.name ?? "a senior figure"} break into the open. ${tier === "critical" || tier === "major" ? `Leadership convenes in emergency session; ${this.theme.press} is already calling.` : "An internal investigation is opened."}`,
      actorIds: subject ? [subject.id] : [],
      deptId: subject?.deptId ?? null,
      causeIds: causeId !== null ? [causeId] : [],
      data: { tier, claim },
    });
    this.pressure("scandal", tier === "critical" ? 1.2 : tier === "major" ? 0.7 : 0.35);
    this.pressure("legal_risk", tier === "critical" ? 0.9 : tier === "major" ? 0.5 : 0.2);
    this.schedule(this.rng.int(4, 14), "scandal_investigate", ev.id, { subjectId, tier, claim });
    return ev;
  }

  /**
   * A rare, believable path to a critical scandal: an already-exposed grave
   * secret, an organization already under a cloud, and a long-odds roll — and
   * at most once in an organization's entire history.
   */
  private maybeCriticalScandal(): void {
    const w = this.world;
    if (w.org.criticalScandals > 0) return;
    if (this.getPressure("scandal") < 1.2 || this.getPressure("legal_risk") < 0.8) return;
    let seed: Secret | undefined;
    for (const s of w.secrets.values()) {
      if (s.status === "exposed" && s.severity >= 82) { seed = s; break; }
    }
    if (!seed) return;
    if (!this.rng.chance(0.02)) return;
    const owner = w.employees.get(seed.ownerId);
    if (!owner || owner.status !== "active") return;
    w.org.criticalScandals++;
    this.openScandal(owner.id, "critical", this.scandalClaim("critical"), null);
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
    if (w.org.day % 7 === 0) this.weekly();
    if (w.org.day % 30 === 0) this.monthly();
    if (w.org.day % 91 === 0) this.quarterly();
    if (w.org.day % 365 === 0) this.annual();
  }

  private weekly(): void {
    this.spreadRumors();
    this.maybeSpontaneousRumor();
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
    // Shipping something together builds trust and respect across the team.
    // This is how a shared history ("worked together on Project X") accrues.
    const bond = 5 + Math.round(proj.quality / 20);
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        this.adjustRel(team[i].id, team[j].id, {
          trust: bond, respect: Math.round(bond * 0.8), friendship: Math.round(bond * 0.4),
        }, {
          reason: `Shipped ${proj.codename} together`, causeEventId: ev.id,
          memory: { category: "completed_project", importance: 8 + Math.round(proj.quality / 12), emotionalImpact: 18 },
        });
      }
    }

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

    // Emotional state colours what a person is likely to do today.
    const m = e.mood;
    const conflictMood = m === "angry" || m === "jealous" ? 2.2 : m === "heartbroken" ? 1.3 : 1;
    const resignMood = m === "heartbroken" ? 1.8 : m === "ashamed" ? 1.4 : 1;
    const workMood = m === "motivated" || m === "inspired" ? 1.6 : m === "heartbroken" || m === "traumatized" ? 0.5 : 1;
    const socialMood = m === "inspired" ? 1.4 : m === "angry" ? 0.6 : 1;

    const candidates: [() => void, number][] = [];
    const add = (w2: number, fn: () => void) => { if (w2 > 0) candidates.push([fn, w2]); };

    if (proj && dept && (dept.fn === "research" || dept.fn === "engineering")) {
      add((e.skill * P.openness) / 9000 * workMood, () => this.actBreakthrough(e, proj));
    }
    add(((P.volatility * e.stress) / 22000 + (this.hasRival(e) ? 0.35 : 0)) * conflictMood, () => this.actConflict(e));
    add((P.ambition * P.openness) / 30000 * (e.level >= 4 ? 2 : 1) * workMood, () => this.actProposal(e));
    if (w.org.day - e.hiredDay > 300 && e.level < 6) {
      add((P.ambition / 100) * (e.reputation / 100) * 0.3, () => this.actPromotionRequest(e));
    }
    add((Math.pow((100 - e.happiness) / 100, 2) * 0.55 + (e.stress > 80 ? 0.2 : 0)) * resignMood, () => this.actResign(e));
    add((P.volatility * (100 - P.diligence)) / 42000, () => this.actMisconduct(e));
    add((P.empathy / 100) * 0.3 * socialMood, () => this.actBefriend(e));
    if (this.hasPartner(e.id)) add((P.volatility / 100) * 0.12 + 0.03, () => this.actBreakup(e));
    if (e.stress > 75) add((e.stress - 75) / 55, () => this.actBurnout(e));
    // "nothing" keeps most days quiet.
    candidates.push([() => {}, 6.0]);

    const action = this.rng.weighted(candidates);
    action();
  }

  private hasRival(e: Employee): boolean {
    for (const r of this.world.relationships.values()) {
      if (r.aId !== e.id && r.bId !== e.id) continue;
      if (r.status === "rival" || r.status === "enemy") return true;
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
    const compat = this.compatibility(e.personality, other.personality);
    // Incompatible people clash harder; a poor existing bond makes it worse.
    const existing = this.rel(e.id, other.id);
    const severity = this.rng.int(10, 28) + Math.round((60 - compat) / 6);
    const topic = this.rng.pick(["credit for recent work", "a missed deadline", "resource allocation", "a design decision", "a promotion everyone saw coming", "tone in a meeting", "who broke the build"]);
    const dept = this.deptOf(e);
    for (const x of [e, other]) {
      x.stress = clamp(x.stress + 8, 0, 100);
      x.happiness = clamp(x.happiness - 6, 0, 100);
      this.touch("employees", x.id);
    }
    if (dept) { dept.morale = clamp(dept.morale - 3, 0, 100); this.touch("departments", dept.id); }
    const willBecomeEnemies = relOverall({ ...emptyDims(), ...(existing?.dims ?? {}) }) - severity < -55;
    const ev = this.emit({
      type: "conflict", importance: willBecomeEnemies ? 3 : 1,
      headline: `Dispute between ${e.name} and ${other.name}`,
      summary: `A disagreement over ${topic} turns personal between ${e.name} and ${other.name}${dept ? ` in ${dept.name}` : ""}. Colleagues notice the chill.`,
      actorIds: [e.id, other.id], deptId: e.deptId,
    });
    this.adjustRel(e.id, other.id, {
      competition: severity, trust: -Math.round(severity * 0.7),
      respect: -Math.round(severity * 0.3), friendship: -Math.round(severity * 0.4),
    }, {
      reason: `Clashed over ${topic}`,
      causeEventId: ev.id,
      memory: { category: "conflict", importance: 10 + Math.round(severity / 2), emotionalImpact: -(20 + severity) },
    });
    const r = this.rel(e.id, other.id);
    if (r && (r.status === "enemy" || relOverall(r.dims) < -55)) this.schedule(this.rng.int(7, 30), "escalate_conflict", ev.id, { aId: e.id, bId: other.id });
  }

  private actProposal(e: Employee): void {
    const w = this.world;
    if (activeProjects(w).length >= Math.max(2, Math.floor(activeEmployees(w).length / 8))) return;
    if (w.org.cash < 500_000) return;
    this.maybeStartProject(null);
  }

  private actPromotionRequest(e: Employee): void {
    const repMod = (this.repStrength(e.id, "reliable") + this.repStrength(e.id, "brilliant")) / 400
      - (this.repStrength(e.id, "lazy") + this.repStrength(e.id, "manipulator")) / 300;
    const ok = this.rng.chance(clamp(e.reputation / 130 + repMod, 0, 0.95));
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
    const compat = this.compatibility(e.personality, other.personality);

    if (existing && (existing.status === "rival" || existing.status === "enemy")) {
      // Reconciliation, gated by empathy and how compatible they really are.
      if (this.rng.chance((e.personality.empathy + Math.max(0, compat)) / 320)) {
        const ev = this.emit({
          type: "reconciliation", importance: 1,
          headline: `${e.name} and ${other.name} bury the hatchet`,
          summary: `After a long frost, ${e.name} extends an olive branch to ${other.name}. It is accepted.`,
          actorIds: [e.id, other.id], deptId: e.deptId,
        });
        this.adjustRel(e.id, other.id, {
          competition: -30, friendship: 22, trust: 15,
        }, {
          reason: "Reconciled after a long dispute", causeEventId: ev.id,
          memory: { category: "reconciliation", importance: 22, emotionalImpact: 25 },
        });
      }
      return;
    }

    // A romance can spark between compatible, empathetic, unattached people.
    const attached = existing && existing.dims.attraction >= 45;
    const romance = !attached && compat > 25 && e.personality.empathy > 48
      && !this.hasPartner(e.id) && !this.hasPartner(other.id) && this.rng.chance(0.06);
    if (romance) {
      const ev = this.emit({
        type: "romance_started", importance: 2,
        headline: `${e.name} and ${other.name} grow close`,
        summary: `What began as friendship between ${e.name} and ${other.name} has quietly become something more.`,
        actorIds: [e.id, other.id], deptId: e.deptId,
      });
      this.adjustRel(e.id, other.id, {
        attraction: this.rng.int(35, 55), friendship: 15, trust: 12,
      }, {
        reason: "A romantic relationship began", causeEventId: ev.id,
        memory: { category: "romance_started", importance: 55, emotionalImpact: 70 },
      });
      for (const x of [e, other]) { x.happiness = clamp(x.happiness + 10, 0, 100); this.touch("employees", x.id); }
      return;
    }

    // Ordinary bonding: compatible people warm up faster.
    const gain = this.rng.int(6, 16) + Math.round(compat / 12);
    this.adjustRel(e.id, other.id, {
      friendship: gain, trust: Math.round(gain * 0.5),
    }, { reason: "Spent time together and got along" });
    for (const x of [e, other]) { x.happiness = clamp(x.happiness + 3, 0, 100); this.touch("employees", x.id); }
  }

  private hasPartner(id: number): boolean {
    for (const r of this.world.relationships.values()) {
      if (r.aId !== id && r.bId !== id) continue;
      if (r.status === "romance") return true;
    }
    return false;
  }

  private actBreakup(e: Employee): void {
    // Deterministic partner selection: stable id order, no reliance on Map order.
    const partners: number[] = [];
    for (const r of this.world.relationships.values()) {
      if (r.status !== "romance") continue;
      if (r.aId === e.id) partners.push(r.bId);
      else if (r.bId === e.id) partners.push(r.aId);
    }
    if (partners.length === 0) return;
    partners.sort((a, b) => a - b);
    const other = this.world.employees.get(partners[0]);
    if (!other || other.status !== "active") return;
    const messy = this.compatibility(e.personality, other.personality) < 0 || e.personality.volatility > 65;
    const ev = this.emit({
      type: "romance_ended", importance: 2,
      headline: `${e.name} and ${other.name} part ways`,
      summary: messy
        ? `The relationship between ${e.name} and ${other.name} ends badly. Colleagues walk on eggshells for weeks.`
        : `${e.name} and ${other.name} quietly end their relationship, remaining on civil terms.`,
      actorIds: [e.id, other.id], deptId: e.deptId,
    });
    this.adjustRel(e.id, other.id, {
      attraction: -90, friendship: messy ? -25 : -5, trust: messy ? -30 : -8,
      respect: messy ? -15 : 0,
    }, {
      reason: messy ? "A painful breakup" : "An amicable breakup", causeEventId: ev.id,
      memory: { category: "romantic_breakup", importance: messy ? 90 : 55, emotionalImpact: messy ? -85 : -40 },
    });
    for (const x of [e, other]) { x.happiness = clamp(x.happiness - (messy ? 18 : 8), 0, 100); this.touch("employees", x.id); }
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
          const ev = this.emit({
            type: "mediation", importance: 2,
            headline: `HR mediates the ${a.name}–${b.name} dispute`,
            summary: `${hr.name} brokers a fragile truce between ${a.name} and ${b.name}. The rivalry cools — officially.`,
            actorIds: [a.id, b.id, hr.id], deptId: a.deptId, causeIds: cause,
          });
          this.adjustRel(a.id, b.id, { competition: -18, trust: 8 }, {
            reason: `HR mediation with ${hr.name}`, causeEventId: ev.id,
            memory: { category: "reconciliation", importance: 18, emotionalImpact: 10 },
          });
        } else if (this.rng.chance(0.4)) {
          // The feud curdles into betrayal before one of them walks.
          this.adjustRel(a.id, b.id, { competition: 20, trust: -25, respect: -15 }, {
            reason: "An unresolved feud turned bitter",
            causeEventId: s.causeId,
            memory: { category: "betrayal", importance: 45, emotionalImpact: -60 },
          });
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
          // A colleague may have stood up for them — a career-saving act that
          // forges lasting trust.
          const defenders = activeEmployees(w).filter((c) => c.id !== emp.id && c.deptId === emp.deptId && c.personality.empathy > 55);
          const defender = defenders.length > 0 ? this.rng.pick(defenders) : undefined;
          const ev = this.emit({
            type: "investigation_concluded", importance: 2,
            headline: `${emp.name} cleared of allegations`,
            summary: `The investigation into ${kind} finds insufficient evidence. ${emp.name} returns to work${defender ? `, helped by ${defender.name}, who vouched for them` : ""}, though the episode leaves a mark.`,
            actorIds: defender ? [emp.id, defender.id] : [emp.id], deptId: emp.deptId, causeIds: cause,
          });
          if (defender) {
            this.adjustRel(emp.id, defender.id, { trust: 30, loyalty: 25, respect: 15 }, {
              reason: `${defender.name} defended ${emp.name} during an investigation`,
              causeEventId: ev.id,
              memory: { category: "defense", importance: 45, emotionalImpact: 60 },
            });
          }
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
      case "scandal_investigate": {
        const tier = s.payload.tier as ScandalTier;
        const claim = String(s.payload.claim);
        const subject = w.employees.get(s.payload.subjectId as number);
        const investigator = this.pickByFn("legal") ?? this.pickByFn("hr") ?? this.pickByFn("security");
        this.emit({
          type: "scandal_investigation", importance: this.tierImportance(tier) - 1 || 2,
          headline: `Investigation opened into ${subject?.name ?? "the allegations"}`,
          summary: `A formal investigation into the alleged ${claim} begins${investigator ? `, led by ${investigator.name}` : ""}. Witnesses are interviewed and records preserved.`,
          actorIds: [subject?.id, investigator?.id].filter((x): x is number => x != null),
          deptId: subject?.deptId ?? null, causeIds: cause,
          data: { tier, claim, subjectId: s.payload.subjectId },
        });
        this.schedule(this.rng.int(20, 70), "scandal_resolve", s.causeId, s.payload);
        break;
      }
      case "scandal_resolve": {
        const tier = s.payload.tier as ScandalTier;
        const claim = String(s.payload.claim);
        const subject = w.employees.get(s.payload.subjectId as number);
        if (!subject) break;
        const powerful = subject.level >= 6;
        // Powerful figures sometimes make it disappear.
        const coverUp = powerful && (tier === "moderate" || tier === "major") && this.rng.chance(0.22);
        if (coverUp) {
          this.emit({
            type: "cover_up", importance: this.tierImportance(tier),
            headline: `Allegations against ${subject.name} quietly disappear`,
            summary: `The investigation into ${claim} ends abruptly with no findings made public. Those who raised it are reassigned; the questions do not go away.`,
            actorIds: [subject.id], deptId: subject.deptId, causeIds: cause,
            data: { tier, claim },
          });
          this.pressure("scandal", 0.3);
          // The truth festers as a rumor.
          this.createRumor(subject.id, "true", `the ${claim} allegations against ${subject.name} were buried`, null);
          break;
        }
        const guilty = this.rng.chance(tier === "critical" ? 0.9 : tier === "major" ? 0.7 : tier === "moderate" ? 0.55 : 0.4);
        if (!guilty) {
          this.emit({
            type: "investigation_concluded", importance: this.tierImportance(tier) - 1 || 2,
            headline: `${subject.name} cleared in ${claim} inquiry`,
            summary: `The investigation into ${claim} closes without substantiated findings. ${subject.name} keeps their position, though the shadow lingers.`,
            actorIds: [subject.id], deptId: subject.deptId, causeIds: cause,
            data: { tier },
          });
          subject.reputation = clamp(subject.reputation - 4, 0, 100);
          this.touch("employees", subject.id);
          break;
        }
        // Guilty: public reckoning scaled by tier.
        const findingEv = this.emit({
          type: "scandal_resolved", importance: this.tierImportance(tier),
          headline: `${subject.name} found responsible for ${claim}`,
          summary: `The investigation substantiates the ${claim}. ${tier === "critical" || tier === "major" ? "The board convenes; the press release is unavoidable." : "Leadership moves to close the matter."}`,
          actorIds: [subject.id], deptId: subject.deptId, causeIds: cause,
          data: { tier, claim },
        });
        w.org.reputation = clamp(w.org.reputation - (tier === "critical" ? 14 : tier === "major" ? 8 : 4), 0, 100);
        // Criminal tiers can end in arrest.
        if ((tier === "critical" || tier === "major") && this.rng.chance(tier === "critical" ? 0.85 : 0.35)) {
          this.emit({
            type: "arrest", importance: 5,
            headline: `${subject.name} arrested`,
            summary: `Authorities take ${subject.name} into custody in connection with the ${claim}. ${this.theme.press} leads with it.`,
            actorIds: [subject.id], deptId: subject.deptId, causeIds: [findingEv.id],
            data: { claim },
          });
        }
        if (subject.id === w.org.ceoId) {
          this.departure(subject, "resigned", findingEv.id, `amid the ${claim} scandal`);
          this.appointCeo(findingEv.id);
        } else {
          this.departure(subject, "fired", findingEv.id, `following a substantiated finding of ${claim}`);
        }
        if (tier !== "minor" && this.rng.chance(0.5)) {
          this.schedule(this.rng.int(40, 160), "breach_lawsuit", findingEv.id, {});
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
      // Strong emotions fade back toward baseline after a few months.
      if (e.mood !== "content" && w.org.day - e.moodDay > 120) { e.mood = "content"; e.moodDay = w.org.day; }
      this.touch("employees", e.id);
    }
    for (const d of openDepartments(w)) {
      d.morale = clamp(Math.round(d.morale + (55 - d.morale) * 0.08), 0, 100);
      this.touch("departments", d.id);
    }

    this.decaySocial();
    this.runSecretDiscovery();
    this.maybeCriticalScandal();

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

    this.deriveReputation();

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
      // Earned reputation tips the scales — reliability and brilliance help,
      // a reputation for laziness or dishonesty hurts.
      const repBonus = (this.repStrength(e.id, "reliable") + this.repStrength(e.id, "brilliant")
        + this.repStrength(e.id, "visionary")) / 12
        - (this.repStrength(e.id, "lazy") + this.repStrength(e.id, "dishonest")) / 8;
      const score = e.skill * 0.5 + e.personality.diligence * 0.3 + repBonus + this.rng.int(0, 25);
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
