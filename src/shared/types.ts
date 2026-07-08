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
  integrity: number;   // 0-100 honesty / ethics
  narcissism: number;  // 0-100 self-regard / manipulativeness
}

/** Current dominant emotional colour of a person, set by high-impact memories. */
export type Mood =
  | "content" | "proud" | "ashamed" | "heartbroken" | "angry"
  | "inspired" | "traumatized" | "jealous" | "motivated";

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
  mood: Mood;
  moodDay: number;      // day the current mood was set (fades over time)
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

/** Legacy scalar relationship kind — retained for back-compat migration only. */
export type RelKind = "friend" | "rival" | "mentor" | "romance";

/**
 * The multi-component breakdown of a relationship. Each dimension is a signed
 * -100..100 float. The overall score and display status are derived from these.
 */
export type RelDimension =
  | "trust"        // professional trust
  | "friendship"
  | "respect"
  | "admiration"
  | "fear"
  | "jealousy"
  | "competition"  // professional rivalry
  | "alignment"    // political alignment
  | "loyalty"
  | "attraction"   // romantic attraction
  | "mentorship";

export const REL_DIMENSIONS: RelDimension[] = [
  "trust", "friendship", "respect", "admiration", "fear",
  "jealousy", "competition", "alignment", "loyalty", "attraction", "mentorship",
];

export type RelStatus =
  | "acquaintance" | "friend" | "close_friend" | "rival" | "enemy"
  | "romance" | "ex_romance" | "mentor" | "estranged";

export function emptyDims(): Record<RelDimension, number> {
  const d = {} as Record<RelDimension, number>;
  for (const k of REL_DIMENSIONS) d[k] = 0;
  return d;
}

/** Signed composite score of a relationship, roughly -100..100. */
export function relOverall(dims: Record<RelDimension, number>): number {
  const positive = dims.trust + dims.friendship + dims.respect + dims.admiration
    + dims.alignment + dims.loyalty + dims.attraction + dims.mentorship;
  const negative = dims.fear + dims.jealousy + dims.competition;
  const raw = positive * 0.16 - negative * 0.28;
  return Math.max(-100, Math.min(100, Math.round(raw)));
}

/**
 * Symmetric personality compatibility, -100..100. Similar openness and shared
 * ethics bond; two ambitious egos clash; narcissism corrodes; warmth helps.
 * Pure and shared so the engine, persistence and UI all agree.
 */
export function personalityCompatibility(a: Personality, b: Personality): number {
  const opennessAffinity = 100 - Math.abs(a.openness - b.openness);
  const warmth = (a.empathy + b.empathy) / 2;
  const sharedEthics = 100 - Math.abs(a.integrity - b.integrity);
  const egoClash = (a.ambition * b.ambition) / 100 * (a.narcissism > 60 && b.narcissism > 60 ? 1 : 0.5);
  const narcissism = (a.narcissism + b.narcissism) / 2;
  const raw = opennessAffinity * 0.22 + warmth * 0.32 + sharedEthics * 0.22
    - egoClash * 0.2 - narcissism * 0.12 - 12;
  return Math.max(-100, Math.min(100, Math.round(raw)));
}

/** Derive the display status label from the dimension vector. */
export function relStatusFromDims(dims: Record<RelDimension, number>): RelStatus {
  const overall = relOverall(dims);
  if (dims.attraction >= 45) return "romance";
  if (dims.attraction <= -25 && dims.friendship < 20) return "ex_romance";
  if (dims.mentorship >= 45 && dims.mentorship >= dims.friendship) return "mentor";
  if (dims.competition >= 55 && dims.trust <= 0) return overall <= -35 ? "enemy" : "rival";
  if (overall <= -45) return "enemy";
  if (overall <= -18) return "rival";
  if (dims.friendship >= 60 || overall >= 55) return "close_friend";
  if (dims.friendship >= 25 || overall >= 22) return "friend";
  return "acquaintance";
}

/** The shared, symmetric bond between two people (aId < bId). */
export interface Relationship {
  aId: number;
  bId: number;
  dims: Record<RelDimension, number>;
  status: RelStatus;          // derived from dims, stored for querying
  sinceDay: number;
  lastInteractionDay: number;
}

/** One dated, causal change to a relationship — the relationship timeline. */
export interface RelTimelineEntry {
  id: number;
  aId: number;
  bId: number;
  day: number;
  delta: number;              // net change to the overall score
  reason: string;
  eventId: number | null;
}

export type MemoryCategory =
  | "shared_lunch" | "completed_project" | "saved_career" | "promotion"
  | "humiliation" | "betrayal" | "romance_started" | "romantic_breakup"
  | "conflict" | "defense" | "mentorship" | "reconciliation" | "award";

/** A significant interaction remembered by a relationship (aId < bId). */
export interface Memory {
  id: number;
  aId: number;
  bId: number;
  category: MemoryCategory;
  day: number;
  importance: number;         // 1..100, decays unless "major" (>=40)
  emotionalImpact: number;    // -100..100
  eventId: number | null;
  text: string;
}

/** A memory of importance >= this threshold resists decay for decades. */
export const MAJOR_MEMORY = 40;

export type OpinionSource =
  | "direct" | "rumor" | "dept_culture" | "witnessed" | "recommendation"
  | "media" | "investigation" | "reputation";

/** Directional: how holderId views subjectId. */
export interface Opinion {
  holderId: number;
  subjectId: number;
  sentiment: number;          // -100..100
  source: OpinionSource;
  confidence: number;         // 0..100
  note: string;
  day: number;
}

/** One person's subjective recollection of an objective event. */
export interface PersonalMemory {
  id: number;
  holderId: number;
  eventId: number;
  valence: number;            // -100..100 how they felt about it
  interpretation: string;
  day: number;
}

export type SecretKind =
  | "gambling" | "alcohol" | "debt" | "affair" | "fake_diploma"
  | "expense_fraud" | "code_plagiarism" | "data_theft" | "espionage"
  | "bribery" | "blackmail" | "secret_project" | "side_business";

export type SecretStatus = "hidden" | "suspected" | "exposed";

export interface Secret {
  id: number;
  ownerId: number;
  kind: SecretKind;
  severity: number;           // 1..100
  discoveryChance: number;    // 0..1 per check
  knownBy: number[];
  suspectedBy: number[];
  evidence: number;           // 0..100
  createdDay: number;
  exposedDay: number | null;
  status: SecretStatus;
}

export type RumorTruth = "true" | "false" | "distorted";
export type RumorStatus = "spreading" | "faded" | "confirmed" | "debunked";

export interface Rumor {
  id: number;
  originId: number | null;
  subjectId: number;
  text: string;
  truth: RumorTruth;
  believability: number;      // 0..100
  spread: number;             // 0..100 share of org reached
  believers: number[];
  skeptics: number[];
  uncertain: number[];
  createdDay: number;
  status: RumorStatus;
  secretId: number | null;
}

export type ScandalTier = "minor" | "moderate" | "major" | "critical";

export type WitnessTier = "direct" | "indirect" | "heard" | "none";

export interface Witness {
  eventId: number;
  empId: number;
  tier: WitnessTier;
}

export type ReputationTag =
  | "reliable" | "brilliant" | "lazy" | "aggressive" | "dishonest"
  | "charismatic" | "visionary" | "manipulator" | "corrupt";

export interface ReputationMark {
  empId: number;
  tag: ReputationTag;
  earnedDay: number;
  strength: number;           // 0..100
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
  | "performance_review" | "legal_filing" | "board_minutes"
  | "hr_report" | "investigation_report" | "witness_statement" | "arrest_record";

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
  /** Number of critical scandals in this org's history — capped, extremely rare. */
  criticalScandals: number;
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
  relationships: number;
  secrets: number;
  rumors: number;
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

/** Everything needed to explore and explain a single relationship. */
export interface RelationshipDetail {
  aId: number; bId: number;
  aName: string; bName: string;
  aRole: string; bRole: string;
  aMood: Mood; bMood: Mood;
  dims: Record<RelDimension, number>;
  status: RelStatus;
  overall: number;
  compatibility: number;
  sinceDay: number;
  lastInteractionDay: number;
  timeline: RelTimelineEntry[];
  memories: Memory[];
  opinionAtoB: Opinion | null;
  opinionBtoA: Opinion | null;
  sharedProjects: { id: number; codename: string }[];
  incidents: { id: number; day: number; headline: string; type: string }[];
  mutualFriends: { id: number; name: string }[];
  aTags: ReputationMark[];
  bTags: ReputationMark[];
}

export interface RelationshipExplanation {
  text: string;
  citations: InvestigatorCitation[];
  usedLlm: boolean;
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
