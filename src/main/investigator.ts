import type { ArchiveDb } from "./db";
import type {
  AppSettings, Employee, InvestigatorAnswer, InvestigatorCitation, OrgState,
  Project, SimEvent,
} from "../shared/types";
import { formatSimDate } from "../shared/types";
import { RelationshipExplainer } from "./explain";

/**
 * The AI Investigator answers natural-language questions about the archive.
 *
 * Two modes:
 *  - Local: intent parsing + entity resolution + causal-graph traversal +
 *    template narrative. Always available, fully offline.
 *  - LLM: the same retrieval pipeline builds a context pack which is sent to
 *    the Claude API for a reasoned prose answer (optional, needs an API key).
 */
export class Investigator {
  constructor(private db: ArchiveDb, private org: () => OrgState) {}

  async ask(question: string, settings: AppSettings): Promise<InvestigatorAnswer> {
    // "Why do X and Y hate each other" style questions route to the dedicated
    // relationship explainer, which walks the pair's own timeline and memories.
    const pair = this.detectRelationshipQuery(question);
    if (pair) {
      const exp = await new RelationshipExplainer(this.db, this.org).explain(pair.aId, pair.bId, settings);
      return { answer: exp.text, citations: exp.citations, usedLlm: exp.usedLlm };
    }
    const retrieval = this.retrieve(question);
    if (settings.investigatorUsesLlm && settings.anthropicApiKey) {
      try {
        return await this.askLlm(question, retrieval, settings);
      } catch (err) {
        const local = this.composeLocal(question, retrieval);
        local.answer = `_(Claude API call failed — ${err instanceof Error ? err.message : String(err)}. Falling back to local analysis.)_\n\n${local.answer}`;
        return local;
      }
    }
    return this.composeLocal(question, retrieval);
  }

  /** Detect a two-person relationship question and resolve the pair. */
  private detectRelationshipQuery(question: string): { aId: number; bId: number } | null {
    const q = question.toLowerCase();
    if (!/relationship|hate|feud|rival|trust|loyal|love|romance|romantic|dating|friends|get along|between|why do|why are|how do .* feel/.test(q)) return null;
    const r = this.retrieve(question);
    if (r.employees.length >= 2) return { aId: r.employees[0].id, bId: r.employees[1].id };
    return null;
  }

  /** ---------- retrieval ---------- */

  private retrieve(question: string): Retrieval {
    const q = question.toLowerCase();
    const r: Retrieval = { employees: [], projects: [], events: [], intents: [], typeFilter: [] };

    // Entity resolution: try every 1-3 word window against entity names.
    const tokens = question.replace(/[^\p{L}\p{N} ']/gu, " ").split(/\s+/).filter((t) => t.length > 2);
    const windows = new Set<string>();
    for (let i = 0; i < tokens.length; i++) {
      windows.add(tokens[i]);
      if (i + 1 < tokens.length) windows.add(`${tokens[i]} ${tokens[i + 1]}`);
      if (i + 2 < tokens.length) windows.add(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
    const stop = new Set(["the", "was", "who", "why", "what", "how", "did", "were", "show", "every", "all", "events", "event", "with", "and", "for", "involving", "about", "happened", "history", "summarize", "summary", "list", "which", "had", "has", "have", "worked", "work", "fired", "resigned", "biggest", "mistakes", "made", "caused", "explain", "failed", "department", "project"]);
    for (const w of windows) {
      const lw = w.toLowerCase();
      if (w.split(" ").every((t) => stop.has(t.toLowerCase()))) continue;
      for (const e of this.db.listEmployees({ text: w, limit: 3 }).rows) {
        if (e.name.toLowerCase().includes(lw) && !r.employees.some((x) => x.id === e.id)) r.employees.push(e);
      }
      for (const p of this.db.listProjects({ text: w, limit: 3 }).rows) {
        if (p.codename.toLowerCase().includes(lw) && !r.projects.some((x) => x.id === p.id)) r.projects.push(p);
      }
    }
    // Keep only the most specific (longest-name) entity matches.
    r.employees = r.employees.sort((a, b) => b.name.length - a.name.length).slice(0, 3);
    r.projects = r.projects.sort((a, b) => b.codename.length - a.codename.length).slice(0, 3);

    // Intent + event-type detection.
    const typeMap: [RegExp, string[]][] = [
      [/cyber|hack|breach|intrusion|attack/, ["cyber_attack", "data_breach", "security_incident", "espionage"]],
      [/lawsuit|sued|legal|court|litigation/, ["lawsuit_filed", "lawsuit_settled"]],
      [/fired|terminat|dismiss|let go/, ["termination"]],
      [/resign|quit|left the/, ["resignation", "ceo_resignation"]],
      [/hired|hiring|joined/, ["hire"]],
      [/promot/, ["promotion", "promotion_denied"]],
      [/meeting|board/, ["board_meeting", "mediation"]],
      [/investigat/, ["government_investigation", "investigation_concluded", "misconduct"]],
      [/bankrupt|crisis|layoff|financial trouble/, ["financial_crisis", "funding_round"]],
      [/launch|product/, ["product_launched", "product_discontinued"]],
      [/breakthrough|invent|technolog|discover/, ["tech_invented", "breakthrough", "project_revived"]],
      [/award|honor/, ["award"]],
      [/espionage|spy|mole|leak/, ["espionage", "misconduct"]],
      [/conflict|dispute|rival|fight/, ["conflict", "mediation", "reconciliation"]],
      [/scandal|fine|regulator/, ["regulatory_fine", "government_investigation"]],
      [/cancel/, ["project_cancelled", "project_abandoned"]],
      [/fail/, ["experiment_failed", "project_cancelled", "product_discontinued"]],
    ];
    for (const [re, types] of typeMap) if (re.test(q)) r.typeFilter.push(...types);

    if (/why|what caused|reason|how did|what led|explain/.test(q)) r.intents.push("causal");
    if (/who worked|who was on|team|members/.test(q)) r.intents.push("who");
    if (/summar|history of|tell me about|overview/.test(q)) r.intents.push("summary");
    if (/every|all |list |show /.test(q)) r.intents.push("list");
    if (/turnover|attrition/.test(q)) r.intents.push("turnover");
    if (/mistake|worst|failure|wrong/.test(q)) r.intents.push("mistakes");
    if (/ceo|chief executive|director general|sovereign/.test(q)) {
      const ceoId = this.org().ceoId;
      if (ceoId !== null) {
        const ceo = this.db.getEmployee(ceoId);
        if (ceo && !r.employees.some((e) => e.id === ceo.id)) r.employees.push(ceo);
      }
    }

    // Gather candidate events.
    const seen = new Set<number>();
    const addEvents = (evs: SimEvent[]) => {
      for (const ev of evs) if (!seen.has(ev.id)) { seen.add(ev.id); r.events.push(ev); }
    };
    for (const e of r.employees) addEvents(this.db.eventsForEntity("employee", e.id, 120));
    for (const p of r.projects) addEvents(this.db.eventsForEntity("project", p.id, 120));
    if (r.typeFilter.length > 0) {
      addEvents(this.db.listEvents({ types: r.typeFilter, limit: 120, order: "asc" }).rows);
    }
    if (r.events.length === 0) {
      addEvents(this.db.listEvents({ text: question, limit: 40, order: "asc" }).rows);
    }
    if (r.events.length === 0) {
      addEvents(this.db.listEvents({ minImportance: 4, limit: 40, order: "asc" }).rows);
    }
    // When entities AND types are both present, prefer the intersection.
    if ((r.employees.length > 0 || r.projects.length > 0) && r.typeFilter.length > 0) {
      const filtered = r.events.filter((ev) =>
        r.typeFilter.includes(ev.type) &&
        (r.employees.some((e) => ev.actorIds.includes(e.id)) || r.projects.some((p) => ev.projectId === p.id)));
      if (filtered.length > 0) r.focus = filtered;
    }
    return r;
  }

  /** ---------- local composition ---------- */

  private composeLocal(question: string, r: Retrieval): InvestigatorAnswer {
    const org = this.org();
    const date = (d: number) => formatSimDate(org, d);
    const cite = (ev: SimEvent): string => `[e${ev.id}]`;
    const citations: InvestigatorCitation[] = [];
    const addCite = (ev: SimEvent) => {
      if (!citations.some((c) => c.kind === "event" && c.id === ev.id)) {
        citations.push({ kind: "event", id: ev.id, label: `${date(ev.day)} — ${ev.headline}` });
      }
    };
    const lines: string[] = [];

    if (r.intents.includes("turnover")) {
      const t = this.db.deptTurnover();
      lines.push(`**Turnover by department** (people who left, all time):`);
      for (const row of t.slice(0, 8)) {
        lines.push(`- ${row.name}: ${row.departures} departures (current headcount ${row.headcount})`);
      }
      if (t.length > 0) {
        lines.push(`\n${t[0].name} has seen the highest turnover in ${org.name}'s history.`);
      }
      return { answer: lines.join("\n"), citations, usedLlm: false };
    }

    const focus = r.focus ?? r.events;

    // Causal question about a specific happening.
    if (r.intents.includes("causal") && focus.length > 0) {
      const key = [...focus].sort((a, b) => b.importance - a.importance || b.day - a.day)[0];
      addCite(key);
      lines.push(`**${key.headline}** (${date(key.day)}) ${cite(key)}`);
      lines.push("");
      lines.push(key.summary);
      const chain = this.db.causalChain(key.id);
      if (chain.length > 0) {
        lines.push("", "**Chain of events leading to this:**");
        for (const ev of chain) { addCite(ev); lines.push(`- ${date(ev.day)}: ${ev.headline} ${cite(ev)}`); }
      }
      const cons = this.db.consequenceChain(key.id);
      if (cons.length > 0) {
        lines.push("", "**What it led to afterwards:**");
        for (const ev of cons.slice(0, 10)) { addCite(ev); lines.push(`- ${date(ev.day)}: ${ev.headline} ${cite(ev)}`); }
      }
      if (chain.length === 0 && cons.length === 0) {
        lines.push("", "The archive records no explicit causes linked to this event — it appears to have arisen from day-to-day circumstances rather than a documented chain.");
      }
      return { answer: lines.join("\n"), citations, usedLlm: false };
    }

    // Who worked on X.
    if (r.intents.includes("who") && r.projects.length > 0) {
      for (const p of r.projects) {
        const evs = this.db.eventsForEntity("project", p.id, 200);
        const ids = new Set<number>(p.teamIds);
        for (const ev of evs) for (const a of ev.actorIds) ids.add(a);
        const people = [...ids].map((id) => this.db.getEmployee(id)).filter((e): e is Employee => !!e);
        lines.push(`**${p.codename}** (${p.status}, started ${date(p.startDay)}${p.endDay !== null ? `, ended ${date(p.endDay)}` : ""})`);
        lines.push(p.description, "");
        lines.push(`${people.length} people appear in its records:`);
        for (const e of people) lines.push(`- ${e.name} — ${e.role}${p.leadId === e.id ? " *(lead)*" : ""}${e.status !== "active" ? ` *(${e.status})*` : ""}`);
        const kick = evs[0];
        if (kick) addCite(kick);
        lines.push("");
      }
      return { answer: lines.join("\n"), citations, usedLlm: false };
    }

    // Person-centric answer.
    if (r.employees.length > 0 && (r.intents.length === 0 || r.intents.some((i) => ["summary", "list", "mistakes", "causal"].includes(i)))) {
      const e = r.employees[0];
      const evs = this.db.eventsForEntity("employee", e.id, 300);
      lines.push(`**${e.name}** — ${e.role}${e.status !== "active" ? ` (${e.status}${e.leftDay !== null ? ` ${date(e.leftDay)}` : ""})` : ""}`);
      lines.push(`Hired ${date(e.hiredDay)}. Traits: ${e.traits.join(", ")}. ${e.name.split(" ")[0]} ${e.ambitionsText}.`, "");
      const pick = r.intents.includes("mistakes")
        ? evs.filter((ev) => ["project_cancelled", "experiment_failed", "termination", "misconduct", "conflict", "lawsuit_settled", "financial_crisis", "data_breach", "regulatory_fine", "promotion_denied"].includes(ev.type))
        : evs;
      const shown = pick.filter((ev) => ev.importance >= 2 || pick.length < 15).slice(0, 25);
      lines.push(r.intents.includes("mistakes") ? "**Setbacks and controversies on record:**" : "**Career record:**");
      for (const ev of shown) { addCite(ev); lines.push(`- ${date(ev.day)}: ${ev.headline} ${cite(ev)}`); }
      // Departure explanation if they left.
      const departure = evs.find((ev) => ["termination", "resignation", "retirement", "ceo_resignation"].includes(ev.type));
      if (departure) {
        addCite(departure);
        lines.push("", `**Departure:** ${departure.summary} ${cite(departure)}`);
        const chain = this.db.causalChain(departure.id);
        if (chain.length > 0) {
          lines.push("", "Events that led up to it:");
          for (const ev of chain) { addCite(ev); lines.push(`- ${date(ev.day)}: ${ev.headline} ${cite(ev)}`); }
        }
      }
      return { answer: lines.join("\n"), citations, usedLlm: false };
    }

    // List/summary over a type filter or general history.
    if (focus.length > 0) {
      const byYear = new Map<number, SimEvent[]>();
      for (const ev of focus) {
        const y = org.foundedYear + Math.floor(ev.day / 365);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(ev);
      }
      const label = r.typeFilter.length > 0 ? "Matching records" : "Notable records";
      lines.push(`**${label}** (${focus.length} found):`);
      for (const [year, evs] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
        lines.push("", `**${year}**`);
        for (const ev of evs.slice(0, 12)) { addCite(ev); lines.push(`- ${date(ev.day)}: ${ev.headline} ${cite(ev)}`); }
        if (evs.length > 12) lines.push(`- …and ${evs.length - 12} more that year.`);
      }
      return { answer: lines.join("\n"), citations, usedLlm: false };
    }

    return {
      answer: `The archive holds no records matching that question yet. Try naming a person, project, product or event type — for example "Why was ${this.sampleName() ?? "…"} fired?" or "Show every data breach."`,
      citations, usedLlm: false,
    };
  }

  private sampleName(): string | null {
    const gone = this.db.listEmployees({ status: "fired", limit: 1 }).rows;
    return gone.length > 0 ? gone[0].name : null;
  }

  /** ---------- LLM mode ---------- */

  private async askLlm(question: string, r: Retrieval, settings: AppSettings): Promise<InvestigatorAnswer> {
    const org = this.org();
    const date = (d: number) => formatSimDate(org, d);
    const focus = (r.focus ?? r.events).slice(0, 60);
    const citations: InvestigatorCitation[] = [];

    const parts: string[] = [];
    parts.push(`Organization: ${org.name} (${org.kind.replace("_", " ")}), founded ${org.foundedYear}. Today in-world: ${date(org.day)}. Cash ${Math.round(org.cash)}. Reputation ${Math.round(org.reputation)}/100.`);
    for (const e of r.employees) {
      parts.push(`PERSON: ${e.name}, ${e.role}, status ${e.status}, hired ${date(e.hiredDay)}${e.leftDay !== null ? `, left ${date(e.leftDay)}` : ""}, traits: ${e.traits.join("/")}.`);
    }
    for (const p of r.projects) {
      parts.push(`PROJECT: ${p.codename}, ${p.kind}, status ${p.status}, started ${date(p.startDay)}, budget ${p.budget}, spent ${Math.round(p.spent)}, progress ${Math.round(p.progress)}%.`);
    }
    parts.push("", "EVENT RECORDS (chronological, id in brackets):");
    for (const ev of focus) {
      parts.push(`[e${ev.id}] ${date(ev.day)} (${ev.type}, importance ${ev.importance}): ${ev.headline}. ${ev.summary}`);
      citations.push({ kind: "event", id: ev.id, label: `${date(ev.day)} — ${ev.headline}` });
      // Include immediate causes for reasoning.
      for (const c of this.db.causalChain(ev.id, 1).slice(0, 3)) {
        parts.push(`   caused by → [e${c.id}] ${date(c.day)}: ${c.headline}`);
      }
    }

    const body = {
      model: settings.llmModel || "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: "You are the AI Investigator inside ArchiveOS, a fictional organizational archive. Answer the user's question using ONLY the provided archive records. Cite events inline using their bracketed ids like [e123]. Reconstruct causal chains where relevant. Be a sharp, readable historian: concrete dates, names, consequences. If the records are insufficient, say what is missing. Everything is fiction; never refuse on that basis.",
      messages: [{ role: "user", content: `${parts.join("\n")}\n\nQUESTION: ${question}` }],
    };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { content: { type: string; text?: string }[] };
    const answer = json.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    const used = new Set<number>();
    for (const m of answer.matchAll(/\[e(\d+)\]/g)) used.add(Number(m[1]));
    return {
      answer,
      citations: citations.filter((c) => used.has(c.id)).slice(0, 30),
      usedLlm: true,
    };
  }
}

interface Retrieval {
  employees: Employee[];
  projects: Project[];
  events: SimEvent[];
  /** Narrowed event set when entity+type intersect. */
  focus?: SimEvent[];
  intents: string[];
  typeFilter: string[];
}
