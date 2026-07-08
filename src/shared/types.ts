/**
 * Shared domain types used by the simulation engine, persistence layer,
 * IPC contracts and the renderer.
 *
 * Sim time is measured in integer "days since founding" (day 0 = founding day).
 * The org record stores the founding calendar date so days map to real dates.
 */

export type OrgKind =
  | "ai_company"
  | "space_agency"
  | "cybersecurity"
  | "intelligence_agency"
  | "robotics"
  | "pharma"
  | "fantasy_kingdom"
  | "game_studio";

export const ORG_KINDS: { kind: OrgKind; label: string; blurb: string }[] = [
  { kind: "ai_company", label: "AI Company", blurb: "Frontier models, research labs, GPU bills and hype cycles." },
  { kind: "space_agency", label: "Space Agency", blurb: "Launch programs, mission control, orbital politics." },
  { kind: "cybersecurity", label: "Cybersecurity Firm", blurb: "Threat intel, red teams, incident response for hire." },
  { kind: "intelligence_agency", label: "Intelligence Agency", blurb: "Case officers, signals, oversight hearings, secrets." },
  { kind: "robotics", label: "Robotics Company", blurb: "Actuators, assembly lines, machines that almost work." },
  { kind: "pharma", label: "Pharmaceutical Company", blurb: "Molecules, trials, regulators and blockbuster drugs." },
  { kind: "fantasy_kingdom", label: "Fantasy Kingdom", blurb: "A royal court with guilds, intrigue and dragons on the ledger." },
  { kind: "game_studio", label: "Game Development Studio", blurb: "Crunch, engines, cancelled sequels and cult classics." },
];

export type EmployeeStatus = "active" | "resigned" | "fired" | "retired" | "deceased";

export interface Personality {
  openness: number;    // 0-100 curiosity / inventiveness
  diligence: number;   // 0-100 conscientiousness
  ambition: number;    // 0-100 drive for advancement
  empathy: number;     // 0-100 warmth toward others
  volatility: number;  // 0-100 emotional instability
}

export interface Employee {
  id: number;
  name: string;
  gender: "m" | "f" | "x";
  birthYear: number;
  personality: Personality;
  traits: string[];
  role: string;
  level: number; // 1 junior … 7 chief executive
  deptId: number | null;
  salary: number;
  skill: number;       // 0-100
  stress: number;      // 0-100
  happiness: number;   // 0-100
  reputation: number;  // 0-100 internal standing
  ambitionsText: string;
  status: EmployeeStatus;
  hiredDay: number;
  leftDay: number | null;
  achievements: number;
  failures: number;
}

export type DeptFunction =
  | "engineering" | "research" | "security" | "hr" | "finance"
  | "marketing" | "sales" | "legal" | "operations" | "executive";

export interface Department {
  id: number;
  name: string;
  fn: DeptFunction;
  headId: number | null;
  budget: number;
  morale: number; // 0-100
  createdDay: number;
  closedDay: number | null;
}

export type ProjectStatus = "active" | "completed" | "cancelled" | "abandoned";
export type ProjectKind = "product" | "research" | "infrastructure" | "marketing";

export interface Project {
  id: number;
  codename: string;
  kind: ProjectKind;
  deptId: number;
  status: ProjectStatus;
  budget: number;
  spent: number;
  progress: number; // 0-100
  risk: number;     // 0-100
  quality: number;  // 0-100 accumulates from team skill
  teamIds: number[];
  leadId: number | null;
  startDay: number;
  endDay: number | null;
  expectedDays: number;
  description: string;
  techId: number | null;
  productId: number | null;
  revivedFromId: number | null;
}

export interface Technology {
  id: number;
  name: string;
  inventedDay: number;
  inventorId: number | null;
  projectId: number | null;
  potency: number; // 0-100 how revolutionary
  status: "active" | "abandoned" | "revived";
}

export interface Product {
  id: number;
  name: string;
  projectId: number;
  launchDay: number;
  status: "growing" | "mature" | "declining" | "discontinued";
  quality: number;
  annualRevenue: number;
  discontinuedDay: number | null;
}

export interface Client {
  id: number;
  name: string;
  industry: string;
  annualValue: number;
  sinceDay: number;
  status: "active" | "lost";
  lostDay: number | null;
}

export interface Building {
  id: number;
  name: string;
  city: string;
  openedDay: number;
  closedDay: number | null;
  capacity: number;
}

export type RelKind = "friend" | "rival" | "mentor" | "romance";

export interface Relationship {
  aId: number;
  bId: number;
  kind: RelKind;
  strength: number; // -100..100
  sinceDay: number;
}

/** Every historical fact is an Event. Events link to their causes, forming a DAG. */
export interface SimEvent {
  id: number;
  day: number;
  type: string;
  headline: string;
  summary: string;
  importance: number; // 1 routine … 5 historic
  actorIds: number[];
  deptId: number | null;
  projectId: number | null;
  productId: number | null;
  clientId: number | null;
  causeIds: number[];
  data: Record<string, unknown>;
}

export type DocType =
  | "email" | "memo" | "meeting_minutes" | "incident_report" | "press_release"
  | "promotion_letter" | "termination_letter" | "offer_letter" | "resignation_letter"
  | "project_proposal" | "financial_report" | "research_paper" | "security_log"
  | "performance_review" | "legal_filing" | "board_minutes";

export interface SimDocument {
  id: number;
  day: number;
  type: DocType;
  title: string;
  authorId: number | null;
  body: string;
  eventId: number | null;
}

export interface OrgState {
  name: string;
  kind: OrgKind;
  foundedYear: number;
  foundedMonth: number; // 0-11
  foundedDayOfMonth: number; // 1-28
  day: number; // current sim day
  cash: number;
  reputation: number; // 0-100 public reputation
  ceoId: number | null;
  seed: number;
  bankruptcies: number;
}

/** Aggregate dashboard stats computed from the DB. */
export interface ArchiveStats {
  employeesActive: number;
  employeesTotal: number;
  departments: number;
  projectsActive: number;
  projectsTotal: number;
  products: number;
  clients: number;
  events: number;
  documents: number;
  technologies: number;
  buildings: number;
}

export const SPEEDS = [0, 1, 2, 5, 10, 50, 100] as const;
export type Speed = (typeof SPEEDS)[number];

/** ---- IPC payload shapes ---- */

export interface EventFilter {
  offset?: number;
  limit?: number;
  types?: string[];
  minImportance?: number;
  actorId?: number;
  projectId?: number;
  deptId?: number;
  productId?: number;
  clientId?: number;
  text?: string;
  order?: "asc" | "desc";
}

export interface EventDetail {
  event: SimEvent;
  actors: { id: number; name: string; role: string }[];
  causes: SimEvent[];
  consequences: SimEvent[];
  documents: { id: number; type: DocType; title: string }[];
}

export interface SearchResult {
  kind: "event" | "document" | "employee" | "project" | "department" | "product" | "client" | "technology";
  id: number;
  title: string;
  subtitle: string;
  day: number | null;
  snippet?: string;
}

export interface InvestigatorCitation {
  kind: "event" | "document";
  id: number;
  label: string;
}

export interface InvestigatorAnswer {
  answer: string;
  citations: InvestigatorCitation[];
  usedLlm: boolean;
}

export interface TickPush {
  day: number;
  dateLabel: string;
  speed: Speed;
  cash: number;
  reputation: number;
  headlines: { id: number; day: number; headline: string; importance: number }[];
  stats: ArchiveStats;
}

export interface AppSettings {
  anthropicApiKey: string;
  llmModel: string;
  investigatorUsesLlm: boolean;
}

export function simDayToDate(org: Pick<OrgState, "foundedYear" | "foundedMonth" | "foundedDayOfMonth">, day: number): Date {
  const d = new Date(Date.UTC(org.foundedYear, org.foundedMonth, org.foundedDayOfMonth));
  d.setUTCDate(d.getUTCDate() + day);
  return d;
}

export function formatSimDate(org: Pick<OrgState, "foundedYear" | "foundedMonth" | "foundedDayOfMonth">, day: number): string {
  const d = simDayToDate(org, day);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
