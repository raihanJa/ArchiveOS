import type { DeptFunction, OrgKind } from "../shared/types";

/**
 * Theme content: everything flavor-specific to an organization kind.
 * The engine is theme-agnostic; it consumes this vocabulary.
 */

export interface Theme {
  kind: OrgKind;
  orgNoun: string; // "company", "agency", "kingdom"...
  /** Departments created at founding (in order) and expansion candidates. */
  foundingDepts: { name: string; fn: DeptFunction }[];
  expansionDepts: { name: string; fn: DeptFunction }[];
  roleByFn: Record<DeptFunction, string[]>; // index by seniority band 0..3 (junior, mid, senior, lead)
  ceoTitle: string;
  projectCodenames: string[];
  productNameParts: { first: string[]; second: string[] };
  techNouns: string[];
  clientParts: { first: string[]; second: string[] };
  industries: string[];
  cities: string[];
  nameStyle: "modern" | "fantasy";
  breakthroughVerbs: string[];
  attackVector: string[];
  regulator: string;
  press: string;
}

const MODERN_CITIES = ["Austin", "Berlin", "Toronto", "Singapore", "Zurich", "Denver", "Amsterdam", "Seoul", "Dublin", "Tel Aviv", "London", "Tokyo"];

const GREEK = ["Atlas", "Orion", "Nova", "Helios", "Artemis", "Chronos", "Daedalus", "Echo", "Hydra", "Icarus", "Janus", "Kronos", "Lyra", "Medusa", "Nyx", "Odyssey", "Pandora", "Quasar", "Rhea", "Selene", "Titan", "Umbra", "Vesta", "Wraith", "Xenon", "Zephyr", "Aegis", "Borealis", "Cascade", "Delphi", "Ember", "Falcon", "Gemini", "Horizon", "Ironwood", "Jade", "Keystone", "Lumen", "Meridian", "Nimbus", "Obsidian", "Polaris", "Quill", "Ragnar", "Sentinel", "Tempest", "Ursa", "Vortex", "Willow", "Yonder", "Zenith", "Anvil", "Basilisk", "Cinder", "Drift", "Eclipse", "Fathom", "Glacier", "Harbinger", "Inkwell", "Juniper", "Kestrel", "Lodestar", "Mirage", "Nomad", "Onyx", "Pinnacle", "Quarry", "Riptide", "Solstice", "Talon", "Undertow", "Vanguard", "Warden", "Xylem", "Yucca", "Zodiac"];

function modernRoles(): Record<DeptFunction, string[]> {
  return {
    engineering: ["Junior Engineer", "Software Engineer", "Senior Engineer", "Engineering Lead"],
    research: ["Research Assistant", "Researcher", "Senior Researcher", "Principal Scientist"],
    security: ["Security Analyst", "Security Engineer", "Senior Security Engineer", "Head of Security"],
    hr: ["HR Coordinator", "HR Specialist", "HR Manager", "Head of People"],
    finance: ["Financial Analyst", "Accountant", "Finance Manager", "Chief Financial Officer"],
    marketing: ["Marketing Associate", "Marketing Specialist", "Marketing Manager", "Head of Marketing"],
    sales: ["Sales Representative", "Account Executive", "Sales Manager", "Head of Sales"],
    legal: ["Paralegal", "Counsel", "Senior Counsel", "General Counsel"],
    operations: ["Operations Assistant", "Operations Specialist", "Operations Manager", "Head of Operations"],
    executive: ["Executive Assistant", "Chief of Staff", "Vice President", "President"],
  };
}

const base: Omit<Theme, "kind" | "orgNoun" | "foundingDepts" | "expansionDepts" | "projectCodenames" | "productNameParts" | "techNouns" | "clientParts" | "industries" | "ceoTitle" | "regulator" | "press"> = {
  roleByFn: modernRoles(),
  cities: MODERN_CITIES,
  nameStyle: "modern",
  breakthroughVerbs: ["achieved a breakthrough in", "cracked", "demonstrated a novel approach to", "solved a long-standing problem in"],
  attackVector: ["a phishing campaign", "a compromised vendor account", "an unpatched server", "stolen credentials", "an insider account", "a zero-day exploit"],
};

export const THEMES: Record<OrgKind, Theme> = {
  ai_company: {
    ...base, kind: "ai_company", orgNoun: "company", ceoTitle: "Chief Executive Officer",
    foundingDepts: [
      { name: "Research", fn: "research" },
      { name: "Engineering", fn: "engineering" },
      { name: "Operations", fn: "operations" },
    ],
    expansionDepts: [
      { name: "Safety & Alignment", fn: "research" },
      { name: "Infrastructure", fn: "engineering" },
      { name: "Security", fn: "security" },
      { name: "People", fn: "hr" },
      { name: "Finance", fn: "finance" },
      { name: "Marketing", fn: "marketing" },
      { name: "Sales", fn: "sales" },
      { name: "Legal & Policy", fn: "legal" },
      { name: "Applied AI", fn: "engineering" },
    ],
    roleByFn: { ...modernRoles(), research: ["Research Intern", "Research Engineer", "Research Scientist", "Principal Researcher"] },
    projectCodenames: GREEK,
    productNameParts: { first: ["Cogni", "Neur", "Syn", "Lexi", "Menti", "Voxa", "Tensor", "Deep", "Auto", "Omni"], second: ["Mind", "Core", "Flow", "Net", "Scale", "Sense", "Graph", "Forge", "Pilot", "Works"] },
    techNouns: ["sparse attention architecture", "self-distilling training loop", "neural memory substrate", "multimodal grounding layer", "low-precision inference kernel", "recursive planning module", "synthetic data refinery", "interpretability probe suite", "agentic orchestration runtime", "continual-learning scheduler"],
    clientParts: { first: ["Meridian", "Cobalt", "Harbor", "Vertex", "Summit", "Pacific", "Northline", "Quantum", "Sterling", "Crescent"], second: ["Health", "Logistics", "Bank", "Media", "Insurance", "Retail", "Energy", "Telecom", "Analytics", "Systems"] },
    industries: ["healthcare", "logistics", "banking", "media", "insurance", "retail", "energy", "telecom"],
    regulator: "the AI Safety Commission", press: "TechWire",
  },
  space_agency: {
    ...base, kind: "space_agency", orgNoun: "agency", ceoTitle: "Director General",
    foundingDepts: [
      { name: "Mission Operations", fn: "operations" },
      { name: "Propulsion Engineering", fn: "engineering" },
      { name: "Astrophysics Division", fn: "research" },
    ],
    expansionDepts: [
      { name: "Launch Systems", fn: "engineering" },
      { name: "Crewed Flight", fn: "operations" },
      { name: "Ground Security", fn: "security" },
      { name: "Personnel Office", fn: "hr" },
      { name: "Budget Office", fn: "finance" },
      { name: "Public Affairs", fn: "marketing" },
      { name: "Commercial Programs", fn: "sales" },
      { name: "Legal Affairs", fn: "legal" },
      { name: "Planetary Science", fn: "research" },
    ],
    roleByFn: { ...modernRoles(), operations: ["Flight Controller", "Mission Specialist", "Flight Director", "Chief of Mission Ops"], engineering: ["Test Engineer", "Systems Engineer", "Senior Systems Engineer", "Chief Engineer"] },
    projectCodenames: GREEK,
    productNameParts: { first: ["Aur", "Sky", "Star", "Luna", "Astra", "Peri", "Helio", "Orbit", "Vega", "Cosmo"], second: ["lith", "reach", "gate", "path", "dyne", "lab", "sat", "probe", "shield", "port"] },
    techNouns: ["methalox staged-combustion engine", "autonomous docking system", "inflatable habitat module", "deep-space relay network", "reusable booster recovery system", "ion propulsion array", "closed-loop life support system", "heat-shield ceramic composite", "orbital refueling architecture", "radiation-hardened flight computer"],
    clientParts: { first: ["Meridian", "Orbital", "Stellar", "Apex", "Global", "TransAtlantic", "Pacific", "Northern", "United", "Continental"], second: ["Communications", "Defense", "Imaging", "Broadcasting", "Weather Services", "Navigation", "Research Consortium", "Telecom", "Logistics", "Observatory"] },
    industries: ["telecommunications", "defense", "earth observation", "broadcasting", "navigation", "research"],
    regulator: "the Parliamentary Space Committee", press: "Orbital Report",
  },
  cybersecurity: {
    ...base, kind: "cybersecurity", orgNoun: "firm", ceoTitle: "Chief Executive Officer",
    foundingDepts: [
      { name: "Threat Research", fn: "research" },
      { name: "Product Engineering", fn: "engineering" },
      { name: "Incident Response", fn: "security" },
    ],
    expansionDepts: [
      { name: "Red Team", fn: "security" },
      { name: "SOC Operations", fn: "operations" },
      { name: "People Ops", fn: "hr" },
      { name: "Finance", fn: "finance" },
      { name: "Marketing", fn: "marketing" },
      { name: "Enterprise Sales", fn: "sales" },
      { name: "Legal & Compliance", fn: "legal" },
      { name: "Malware Analysis", fn: "research" },
    ],
    roleByFn: { ...modernRoles(), security: ["SOC Analyst", "Incident Responder", "Senior Threat Hunter", "Head of Response"], research: ["Threat Intel Analyst", "Vulnerability Researcher", "Senior Reverse Engineer", "Principal Threat Researcher"] },
    projectCodenames: GREEK,
    productNameParts: { first: ["Aegis", "Bastion", "Cipher", "Dark", "Iron", "Night", "Sentry", "Trace", "Vault", "Zero"], second: ["Guard", "Watch", "Wall", "Scope", "Shield", "Hawk", "Grid", "Lock", "Net", "Trap"] },
    techNouns: ["behavioral anomaly engine", "kernel-level telemetry agent", "encrypted traffic classifier", "deception grid framework", "supply-chain attestation service", "memory forensics pipeline", "autonomous containment system", "threat graph correlator", "firmware integrity scanner", "credential exposure monitor"],
    clientParts: { first: ["First National", "Meridian", "Atlantic", "Keystone", "Summit", "Vanguard", "Central", "Union", "Pinnacle", "Continental"], second: ["Bank", "Insurance", "Hospital Group", "Utilities", "Airlines", "Exchange", "Pension Fund", "Retail Group", "Ministry", "Manufacturing"] },
    industries: ["banking", "insurance", "healthcare", "utilities", "aviation", "government", "manufacturing"],
    regulator: "the National Cyber Directorate", press: "SecurityDesk",
  },
  intelligence_agency: {
    ...base, kind: "intelligence_agency", orgNoun: "agency", ceoTitle: "Director",
    foundingDepts: [
      { name: "Clandestine Operations", fn: "operations" },
      { name: "Signals Directorate", fn: "engineering" },
      { name: "Analysis Directorate", fn: "research" },
    ],
    expansionDepts: [
      { name: "Counterintelligence", fn: "security" },
      { name: "Personnel & Vetting", fn: "hr" },
      { name: "Comptroller", fn: "finance" },
      { name: "Liaison Office", fn: "sales" },
      { name: "Office of General Counsel", fn: "legal" },
      { name: "Technical Services", fn: "engineering" },
      { name: "Open Source Center", fn: "research" },
    ],
    roleByFn: { ...modernRoles(), operations: ["Junior Case Officer", "Case Officer", "Senior Case Officer", "Station Chief"], research: ["Junior Analyst", "Analyst", "Senior Analyst", "Chief Analyst"], engineering: ["Technical Officer", "Signals Engineer", "Senior Signals Engineer", "Head of Technical Collection"] },
    projectCodenames: GREEK.map((g) => g.toUpperCase()),
    productNameParts: { first: ["LOOKING", "SILENT", "AMBER", "COLD", "BLUE", "IRON", "MIDNIGHT", "GREY", "HOLLOW", "STONE"], second: ["GLASS", "ARCHER", "LANTERN", "HARVEST", "CANARY", "VEIL", "COMPASS", "MIRROR", "FERRY", "ANCHOR"] },
    techNouns: ["burst-transmission intercept array", "one-time-pad distribution network", "deep-cover legend fabrication system", "satellite imagery enhancement suite", "voice-print identification system", "covert exfiltration protocol", "dead-drop sensor network", "cipher-breaking compute cluster", "biometric border watchlist", "clandestine communications relay"],
    clientParts: { first: ["Allied", "Foreign", "Joint", "National", "Coalition", "Regional", "Central", "Northern", "Maritime", "Strategic"], second: ["Ministry", "Directorate", "Task Force", "Command", "Bureau", "Council", "Commission", "Service", "Office", "Mission"] },
    industries: ["defense", "diplomacy", "border security", "counterterrorism", "trade policy"],
    regulator: "the Oversight Committee", press: "The National Ledger",
  },
  robotics: {
    ...base, kind: "robotics", orgNoun: "company", ceoTitle: "Chief Executive Officer",
    foundingDepts: [
      { name: "Mechanical Engineering", fn: "engineering" },
      { name: "Autonomy Research", fn: "research" },
      { name: "Manufacturing", fn: "operations" },
    ],
    expansionDepts: [
      { name: "Controls & Firmware", fn: "engineering" },
      { name: "Field Operations", fn: "operations" },
      { name: "Security", fn: "security" },
      { name: "People", fn: "hr" },
      { name: "Finance", fn: "finance" },
      { name: "Marketing", fn: "marketing" },
      { name: "Industrial Sales", fn: "sales" },
      { name: "Legal", fn: "legal" },
    ],
    projectCodenames: GREEK,
    productNameParts: { first: ["Servo", "Dyna", "Flex", "Omni", "Grip", "Stride", "Lift", "Weld", "Pick", "Haul"], second: ["Arm", "Bot", "Rig", "Frame", "Unit", "Walker", "Cart", "Cell", "Dock", "Swarm"] },
    techNouns: ["series-elastic actuator", "tactile fingertip sensor array", "whole-body motion planner", "swappable battery spine", "vision-guided grasping stack", "self-calibrating joint encoder", "warehouse fleet coordinator", "compliant gripper material", "terrain-adaptive gait engine", "sim-to-real transfer pipeline"],
    clientParts: { first: ["Midwest", "Global", "Pacific", "Apex", "United", "Precision", "Continental", "Northgate", "Bluefield", "Ironline"], second: ["Automotive", "Fulfillment", "Foods", "Aerospace", "Shipyards", "Electronics", "Pharma", "Agriculture", "Mining", "Logistics"] },
    industries: ["automotive", "warehousing", "food processing", "aerospace", "shipbuilding", "agriculture", "mining"],
    regulator: "the Industrial Safety Board", press: "Automation Weekly",
  },
  pharma: {
    ...base, kind: "pharma", orgNoun: "company", ceoTitle: "Chief Executive Officer",
    foundingDepts: [
      { name: "Drug Discovery", fn: "research" },
      { name: "Clinical Development", fn: "operations" },
      { name: "Regulatory Affairs", fn: "legal" },
    ],
    expansionDepts: [
      { name: "Biostatistics", fn: "research" },
      { name: "Manufacturing & Quality", fn: "operations" },
      { name: "Pharmacovigilance", fn: "security" },
      { name: "Human Resources", fn: "hr" },
      { name: "Finance", fn: "finance" },
      { name: "Medical Marketing", fn: "marketing" },
      { name: "Payer Relations", fn: "sales" },
      { name: "IT & Informatics", fn: "engineering" },
    ],
    roleByFn: { ...modernRoles(), research: ["Lab Technician", "Research Associate", "Senior Scientist", "Principal Investigator"], operations: ["Clinical Coordinator", "Clinical Research Associate", "Trial Manager", "Head of Clinical Ops"] },
    projectCodenames: GREEK,
    productNameParts: { first: ["Neva", "Cardi", "Onco", "Immu", "Zela", "Vora", "Luma", "Reni", "Axo", "Delta"], second: ["mab", "nib", "zol", "pril", "statin", "vir", "cept", "gene", "dex", "fen"] },
    techNouns: ["mRNA delivery vector", "protein-folding screening platform", "targeted antibody conjugate", "small-molecule kinase inhibitor", "organ-on-chip trial model", "gene-editing payload", "sustained-release formulation", "biomarker discovery pipeline", "cold-chain logistics system", "adaptive trial design framework"],
    clientParts: { first: ["Meridian", "St. Anne's", "Northern", "University", "Regional", "Coastal", "Mercy", "Highland", "Grand", "Century"], second: ["Hospital Network", "Health System", "Insurance Group", "Ministry of Health", "Clinics", "Medical Center", "Pharmacy Chain", "Care Alliance", "Research Hospital", "HMO"] },
    industries: ["hospitals", "insurers", "public health", "pharmacies", "research"],
    regulator: "the Medicines Regulatory Agency", press: "PharmaWatch",
  },
  fantasy_kingdom: {
    ...base, kind: "fantasy_kingdom", orgNoun: "kingdom", ceoTitle: "Sovereign",
    nameStyle: "fantasy",
    cities: ["Emberhold", "Silvermere", "Thornwick", "Duskhaven", "Highspire", "Ravenmoor", "Goldenford", "Mistvale", "Stormwatch", "Willowdeep"],
    foundingDepts: [
      { name: "Royal Guard", fn: "security" },
      { name: "College of Mages", fn: "research" },
      { name: "Royal Treasury", fn: "finance" },
    ],
    expansionDepts: [
      { name: "Guild of Artificers", fn: "engineering" },
      { name: "Court of Heralds", fn: "marketing" },
      { name: "Diplomatic Corps", fn: "sales" },
      { name: "Court of Law", fn: "legal" },
      { name: "Steward's Office", fn: "operations" },
      { name: "Office of the Chamberlain", fn: "hr" },
      { name: "Order of Scouts", fn: "security" },
    ],
    roleByFn: {
      engineering: ["Apprentice Artificer", "Artificer", "Master Artificer", "Guildmaster"],
      research: ["Novice Mage", "Mage", "Archmage", "Grand Archmage"],
      security: ["Guard Recruit", "Guardsman", "Knight-Captain", "Lord Commander"],
      hr: ["Page", "Steward", "Chamberlain", "High Chamberlain"],
      finance: ["Clerk of Coin", "Treasurer's Aide", "Treasurer", "Master of Coin"],
      marketing: ["Crier", "Herald", "Royal Herald", "Master of Heralds"],
      sales: ["Envoy", "Emissary", "Ambassador", "High Ambassador"],
      legal: ["Scribe of Law", "Magistrate", "High Magistrate", "Lord Justice"],
      operations: ["Laborer", "Overseer", "Steward of Works", "High Steward"],
      executive: ["Squire", "Advisor", "Royal Advisor", "Hand of the Crown"],
    },
    projectCodenames: ["Dragonwatch", "Starfall", "Ironcrown", "Nightbloom", "Suncrest", "Frostgate", "Emberwake", "Thornshield", "Moonwell", "Stormcaller", "Goldenveil", "Ashenroad", "Wyrmhunt", "Silverbough", "Ravenspire", "Hallowmere", "Grimward", "Brightforge", "Shadowfen", "Oakenheart", "Windmarch", "Deepdelve", "Skyharbor", "Runebind", "Wolfsong"],
    productNameParts: { first: ["Ember", "Frost", "Storm", "Moon", "Sun", "Iron", "Silver", "Shadow", "Bright", "Wyrm"], second: ["blade", "ward", "charm", "brew", "stone", "cloak", "lantern", "sigil", "draught", "banner"] },
    techNouns: ["everburning forge-flame", "scrying mirror network", "runic ward lattice", "alchemical healing draught", "skyship ballast enchantment", "golem animation matrix", "far-speaking crystal", "dragonscale plating technique", "portal anchor stone", "grain-blessing ritual"],
    clientParts: { first: ["Duchy of", "Barony of", "Free City of", "Guild of", "Order of", "House", "March of", "Port of", "Abbey of", "League of"], second: ["Vantis", "Coriander", "Blackmoor", "Etherlyn", "Karth", "Selvane", "Drossford", "Yarrow", "Miren", "Tolgrath"] },
    industries: ["grain trade", "silver mining", "wool trade", "shipping", "spice routes", "timber", "enchantments"],
    regulator: "the Council of Lords", press: "The Herald's Voice",
    breakthroughVerbs: ["uncovered the secret of", "mastered", "wove the first working", "recovered the lost art of"],
    attackVector: ["a shapeshifter infiltrator", "a bribed gate guard", "a cursed gift", "a tunnel beneath the walls", "a traitor within the court", "a hex upon the granaries"],
  },
  game_studio: {
    ...base, kind: "game_studio", orgNoun: "studio", ceoTitle: "Studio Director",
    foundingDepts: [
      { name: "Game Design", fn: "research" },
      { name: "Engine & Tools", fn: "engineering" },
      { name: "Art & Animation", fn: "operations" },
    ],
    expansionDepts: [
      { name: "QA", fn: "security" },
      { name: "Live Ops", fn: "operations" },
      { name: "People", fn: "hr" },
      { name: "Finance", fn: "finance" },
      { name: "Marketing", fn: "marketing" },
      { name: "Publishing & BizDev", fn: "sales" },
      { name: "Legal", fn: "legal" },
      { name: "Audio", fn: "engineering" },
    ],
    roleByFn: { ...modernRoles(), research: ["Junior Designer", "Game Designer", "Senior Designer", "Design Director"], security: ["QA Tester", "QA Analyst", "Senior QA Analyst", "QA Lead"], operations: ["Junior Artist", "Artist", "Senior Artist", "Art Director"] },
    projectCodenames: GREEK,
    productNameParts: { first: ["Ashen", "Crystal", "Neon", "Iron", "Lost", "Star", "Grim", "Wild", "Hollow", "Ever"], second: ["fall", " Vale", " Drift", "born", " Tides", "forge", " Haven", " Protocol", " Kingdoms", " Horizon"] },
    techNouns: ["procedural world streaming engine", "cloth-and-hair physics solver", "dialogue branching toolchain", "rollback netcode stack", "photogrammetry asset pipeline", "dynamic music layering system", "crowd simulation framework", "modding SDK", "cross-platform save sync", "in-engine cinematic editor"],
    clientParts: { first: ["Titanview", "Polaris", "Redwood", "Harbor", "Nebula", "Crown", "Vertex", "Bluebird", "Monolith", "Summit"], second: ["Publishing", "Interactive", "Games Fund", "Entertainment", "Distribution", "Platform", "Media Group", "Partners", "Ventures", "Arcade"] },
    industries: ["publishing", "platforms", "esports", "merchandising", "film licensing"],
    regulator: "the Ratings Board", press: "PixelPress",
  },
};

/** ---- Person name pools ---- */

export const MODERN_FIRST_M = ["James", "Daniel", "Marcus", "Ethan", "Victor", "Samuel", "Adrian", "Nathan", "Oliver", "Lucas", "Henry", "Felix", "Omar", "Ravi", "Kenji", "Mateo", "Andrei", "Tomas", "Jonas", "Elias", "Dmitri", "Hassan", "Leo", "Arthur", "Miles", "Julian", "Theo", "Isaac", "Ruben", "Stefan"];
export const MODERN_FIRST_F = ["Sarah", "Elena", "Maya", "Claire", "Ingrid", "Priya", "Naomi", "Alice", "Diana", "Sofia", "Hannah", "Yuki", "Amara", "Lucia", "Nadia", "Freya", "Iris", "Zoe", "Camille", "Leila", "Astrid", "Mira", "Tessa", "Vera", "Anya", "Greta", "Noor", "Bianca", "Dana", "Helena"];
export const MODERN_LAST = ["Johnson", "Chen", "Novak", "Okafor", "Lindqvist", "Marchetti", "Tanaka", "Petrov", "Almeida", "Kowalski", "Haddad", "Fischer", "Nakamura", "O'Brien", "Vasquez", "Sørensen", "Ivanova", "Dubois", "Kim", "Mbeki", "Larsson", "Romano", "Yilmaz", "Andersen", "Silva", "Weiss", "Nagy", "Costa", "Bergström", "Moreau", "Kaur", "Adeyemi", "Vance", "Holloway", "Mercer", "Ashford", "Blackwood", "Sterling", "Whitmore", "Caldwell"];

export const FANTASY_FIRST_M = ["Aldric", "Bran", "Cedric", "Doran", "Elric", "Fenwick", "Gareth", "Hadrian", "Ivo", "Joric", "Kael", "Lucan", "Merek", "Nyle", "Osric", "Perrin", "Quill", "Roderic", "Soren", "Theron", "Ulric", "Varen", "Wystan", "Yorick", "Zane", "Alaric", "Corvin", "Edmun", "Falken", "Godric"];
export const FANTASY_FIRST_F = ["Aeliana", "Brienne", "Cassia", "Delia", "Elowen", "Fiora", "Gwyn", "Isolde", "Junia", "Katriel", "Lyra", "Maeve", "Nimue", "Ophira", "Petra", "Rhoswen", "Seraphine", "Thessaly", "Una", "Vesna", "Wren", "Ysolde", "Zaria", "Annora", "Cordelia", "Evaine", "Fenella", "Ginevra", "Helewise", "Imogen"];
export const FANTASY_LAST = ["Ashdown", "Blackbriar", "Coldwater", "Duskwhisper", "Emberfall", "Frostmantle", "Greenward", "Hollowbrook", "Ironwood", "Kestrelmoor", "Larkspur", "Mossgrave", "Nightriver", "Oakenshield", "Pinehurst", "Quickstep", "Ravenhall", "Silverstrand", "Thornefield", "Umberfell", "Vayle", "Winterbourne", "Wyrmbane", "Yarrowe", "Stormcrow", "Brightwater", "Hawthorne", "Griffonvale", "Marrowgate", "Snowmarch"];

export const TRAIT_POOL = ["meticulous", "impulsive", "charismatic", "reclusive", "stubborn", "diplomatic", "cynical", "idealistic", "workaholic", "easygoing", "perfectionist", "risk-taker", "cautious", "blunt", "secretive", "generous", "petty", "loyal", "opportunistic", "curious", "methodical", "hot-tempered", "patient", "vindictive", "forgiving", "eccentric", "pragmatic", "superstitious", "competitive", "humble"];

export const AMBITION_TEXTS = [
  "wants to run their own department one day",
  "dreams of building something the world remembers",
  "is quietly saving up to start their own venture",
  "wants recognition more than money",
  "just wants a stable, quiet career",
  "intends to be the youngest executive in the organization's history",
  "hopes to mentor the next generation",
  "wants to prove a former employer wrong",
  "is chasing one great discovery",
  "wants power, and is honest with themselves about it",
  "hopes to retire early to a quiet coastline",
  "wants their name on a patent, a paper, or a plaque",
];
