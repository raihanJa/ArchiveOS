import type {
  Building, Client, Department, Employee, OrgState, Product, Project,
  Relationship, Technology,
} from "../shared/types";

/**
 * The in-memory working set of the simulation. Entities live here and are
 * mirrored to SQLite on change; events/documents are append-only and go
 * straight to the archive (they are never needed in memory after emission).
 */
export interface WorldState {
  org: OrgState;
  employees: Map<number, Employee>;
  departments: Map<number, Department>;
  projects: Map<number, Project>;
  technologies: Map<number, Technology>;
  products: Map<number, Product>;
  clients: Map<number, Client>;
  buildings: Map<number, Building>;
  /** key = `${min}|${max}` of the two employee ids */
  relationships: Map<string, Relationship>;
  /** Named pressures that decay daily and bias event probabilities. */
  pressures: Record<string, number>;
  /** Delayed consequences: the causal engine's queue. */
  scheduled: ScheduledItem[];
  nextId: number;
  rngState: number;
  /** Codenames already used, to avoid duplicates until the pool cycles. */
  usedCodenames: string[];
}

export interface ScheduledItem {
  dueDay: number;
  kind: string;
  causeId: number | null;
  payload: Record<string, unknown>;
}

export function relKey(a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Serializable snapshot of non-tabular engine state. */
export interface EngineSnapshot {
  pressures: Record<string, number>;
  scheduled: ScheduledItem[];
  nextId: number;
  rngState: number;
  usedCodenames: string[];
}

export function takeSnapshot(w: WorldState): EngineSnapshot {
  return {
    pressures: w.pressures,
    scheduled: w.scheduled,
    nextId: w.nextId,
    rngState: w.rngState,
    usedCodenames: w.usedCodenames,
  };
}

export function activeEmployees(w: WorldState): Employee[] {
  const out: Employee[] = [];
  for (const e of w.employees.values()) if (e.status === "active") out.push(e);
  return out;
}

export function activeProjects(w: WorldState): Project[] {
  const out: Project[] = [];
  for (const p of w.projects.values()) if (p.status === "active") out.push(p);
  return out;
}

export function openDepartments(w: WorldState): Department[] {
  const out: Department[] = [];
  for (const d of w.departments.values()) if (d.closedDay === null) out.push(d);
  return out;
}
