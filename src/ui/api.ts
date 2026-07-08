import type {
  AppSettings, ArchiveStats, Building, Client, Department, Employee,
  EventDetail, EventFilter, InvestigatorAnswer, OrgKind, OrgState, Product,
  Project, Relationship, SearchResult, SimDocument, SimEvent, Speed,
  Technology, TickPush,
} from "../shared/types";

export interface OrgInfo {
  hasWorld: boolean;
  org?: OrgState;
  dateLabel?: string;
  speed?: Speed;
  stats?: ArchiveStats;
}

export interface EmployeeDetail {
  employee: Employee;
  deptName: string | null;
  events: SimEvent[];
  relationships: (Relationship & { otherName: string; otherId: number })[];
  documents: Omit<SimDocument, "body">[];
}

export interface ProjectDetail {
  project: Project;
  deptName: string | null;
  team: Employee[];
  events: SimEvent[];
}

export interface DeptRow extends Department {
  headName: string | null;
  headcount: number;
  departures: number;
}

export interface DeptDetail {
  department: Department;
  head: Employee | null;
  members: Employee[];
  events: SimEvent[];
}

export interface ArchiveApi {
  getOrg(): Promise<OrgInfo>;
  initOrg(args: { name: string; kind: OrgKind; seed?: number }): Promise<{ ok: boolean }>;
  resetOrg(): Promise<{ ok: boolean }>;
  setSpeed(s: Speed): Promise<Speed>;
  listEvents(filter: EventFilter): Promise<{ total: number; rows: SimEvent[] }>;
  eventDetail(id: number): Promise<EventDetail | null>;
  listEmployees(opts: { text?: string; status?: string; deptId?: number; offset?: number; limit?: number }): Promise<{ total: number; rows: Employee[] }>;
  getEmployee(id: number): Promise<EmployeeDetail | null>;
  listProjects(opts: { text?: string; status?: string; offset?: number; limit?: number }): Promise<{ total: number; rows: Project[] }>;
  getProject(id: number): Promise<ProjectDetail | null>;
  listDepartments(): Promise<DeptRow[]>;
  getDepartment(id: number): Promise<DeptDetail | null>;
  listProducts(): Promise<Product[]>;
  listClients(): Promise<Client[]>;
  listTechnologies(): Promise<Technology[]>;
  listBuildings(): Promise<Building[]>;
  listDocs(opts: { offset?: number; limit?: number; type?: string; text?: string }): Promise<{ total: number; rows: Omit<SimDocument, "body">[] }>;
  getDoc(id: number): Promise<SimDocument | null>;
  search(q: string): Promise<SearchResult[]>;
  ask(question: string): Promise<InvestigatorAnswer>;
  getSettings(): Promise<AppSettings & { hasKey: boolean }>;
  setSettings(patch: Partial<AppSettings>): Promise<{ ok: boolean }>;
  onTick(cb: (t: TickPush) => void): () => void;
}

export const api: ArchiveApi = (window as unknown as { archive: ArchiveApi }).archive;
