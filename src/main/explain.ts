import type { ArchiveDb } from "./db";
import type {
  AppSettings, InvestigatorCitation, MemoryCategory, OrgState, RelDimension,
  RelationshipDetail, RelationshipExplanation, RelStatus,
} from "../shared/types";
import { formatSimDate } from "../shared/types";

/**
 * Generates a natural-language explanation of WHY two people have the
 * relationship they do, from the archive's real history.
 *
 * Two modes mirror the Investigator:
 *  - Local: deterministic template over the relationship's timeline, memories
 *    and opinions. Always available, fully offline.
 *  - LLM: the same bundle is sent to the Claude API for prose (needs a key);
 *    falls back to local on any failure.
 */
export class RelationshipExplainer {
  constructor(private db: ArchiveDb, private org: () => OrgState) {}

  async explain(aId: number, bId: number, settings: AppSettings): Promise<RelationshipExplanation> {
    const d = this.db.getRelationshipFull(aId, bId);
    if (!d) return { text: "The archive has no record of these two people.", citations: [], usedLlm: false };
    if (settings.investigatorUsesLlm && settings.anthropicApiKey) {
      try {
        return await this.askLlm(d, settings);
      } catch (err) {
        const local = this.composeLocal(d);
        local.text = `_(Claude API call failed — ${err instanceof Error ? err.message : String(err)}. Local explanation below.)_\n\n${local.text}`;
        return local;
      }
    }
    return this.composeLocal(d);
  }

  /** ---------- local ---------- */

  private composeLocal(d: RelationshipDetail): RelationshipExplanation {
    const org = this.org();
    const date = (day: number) => formatSimDate(org, day);
    const year = (day: number) => org.foundedYear + Math.floor(day / 365);
    const citations: InvestigatorCitation[] = [];
    const cite = (eventId: number | null, label: string) => {
      if (eventId != null && !citations.some((c) => c.id === eventId)) citations.push({ kind: "event", id: eventId, label });
    };
    const lines: string[] = [];

    // Opening: who they are and where they stand now.
    lines.push(`${d.aName} (${d.aRole}) and ${d.bName} (${d.bRole}) are ${STATUS[d.status]}.`);
    if (d.sinceDay > 0) {
      const met = d.timeline[0] ?? null;
      lines.push(`Their paths first crossed around ${date(d.sinceDay)}${met ? `, when ${met.reason.toLowerCase()}` : ""}.`);
      if (met) cite(met.eventId, `${date(met.day)} — ${met.reason}`);
    }

    // The arc: the biggest turning points, in order.
    const swings = [...d.timeline].filter((t) => Math.abs(t.delta) >= 3)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5)
      .sort((a, b) => a.day - b.day);
    if (swings.length > 0) {
      lines.push("");
      lines.push("**How it developed:**");
      for (const t of swings) {
        const sign = t.delta > 0 ? "+" : "";
        lines.push(`- ${year(t.day)}: ${t.reason} (${sign}${t.delta}).`);
        cite(t.eventId, `${date(t.day)} — ${t.reason}`);
      }
    }

    // Defining memories.
    const majorMemories = d.memories.filter((m) => m.importance >= 20).slice(0, 3);
    if (majorMemories.length > 0) {
      lines.push("");
      lines.push("**What neither of them forgets:**");
      for (const m of majorMemories) {
        lines.push(`- ${MEMORY_PHRASE[m.category]} — ${m.text} (${date(m.day)}).`);
        cite(m.eventId, `${date(m.day)} — ${m.text}`);
      }
    }

    // Current composition of the bond.
    const dims = (Object.entries(d.dims) as [RelDimension, number][])
      .filter(([, v]) => Math.abs(v) >= 15)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
    if (dims.length > 0) {
      lines.push("");
      lines.push(`Today the relationship is defined most by ${dims.map(([k, v]) => `${DIM_LABEL[k]} (${v > 0 ? "+" : ""}${v})`).join(", ")}.`);
    }

    // Asymmetry: do they see each other the same way?
    if (d.opinionAtoB && d.opinionBtoA) {
      const gap = Math.abs(d.opinionAtoB.sentiment - d.opinionBtoA.sentiment);
      if (gap >= 25) {
        lines.push("");
        lines.push(`They do not quite see each other the same way. ${d.aName} ${sentimentPhrase(d.opinionAtoB.sentiment)} ${d.bName} ("${d.opinionAtoB.note}"), while ${d.bName} ${sentimentPhrase(d.opinionBtoA.sentiment)} ${d.aName} ("${d.opinionBtoA.note}").`);
      }
    }

    // Context: shared work, mutual friends, compatibility.
    const ctx: string[] = [];
    if (d.sharedProjects.length > 0) ctx.push(`worked together on ${d.sharedProjects.map((p) => p.codename).join(", ")}`);
    if (d.mutualFriends.length > 0) ctx.push(`share ${d.mutualFriends.length} mutual ${d.mutualFriends.length === 1 ? "connection" : "connections"}`);
    ctx.push(`are ${d.compatibility >= 30 ? "naturally compatible personalities" : d.compatibility <= -30 ? "temperamentally ill-matched" : "a mixed personality fit"} (compatibility ${d.compatibility})`);
    if (ctx.length > 0) {
      lines.push("");
      lines.push(`For context, they ${ctx.join("; ")}.`);
    }

    if (d.timeline.length === 0 && d.memories.length === 0) {
      lines.push("");
      lines.push("Beyond crossing paths, the archive records no significant shared history between them yet.");
    }

    return { text: lines.join("\n"), citations, usedLlm: false };
  }

  /** ---------- LLM ---------- */

  private async askLlm(d: RelationshipDetail, settings: AppSettings): Promise<RelationshipExplanation> {
    const org = this.org();
    const date = (day: number) => formatSimDate(org, day);
    const citations: InvestigatorCitation[] = [];
    const parts: string[] = [];
    parts.push(`Organization: ${org.name} (${org.kind.replace("_", " ")}). Explain the relationship between two people using ONLY these records.`);
    parts.push(`PERSON A: ${d.aName} — ${d.aRole} (current mood: ${d.aMood}).`);
    parts.push(`PERSON B: ${d.bName} — ${d.bRole} (current mood: ${d.bMood}).`);
    parts.push(`CURRENT STATUS: ${d.status}. Overall score ${d.overall}. Personality compatibility ${d.compatibility}.`);
    parts.push(`DIMENSIONS: ${(Object.entries(d.dims) as [string, number][]).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${v}`).join(", ") || "none yet"}.`);
    if (d.sharedProjects.length) parts.push(`SHARED PROJECTS: ${d.sharedProjects.map((p) => p.codename).join(", ")}.`);
    if (d.mutualFriends.length) parts.push(`MUTUAL CONNECTIONS: ${d.mutualFriends.map((m) => m.name).join(", ")}.`);
    if (d.opinionAtoB) parts.push(`${d.aName}'S VIEW OF ${d.bName}: sentiment ${d.opinionAtoB.sentiment} — "${d.opinionAtoB.note}".`);
    if (d.opinionBtoA) parts.push(`${d.bName}'S VIEW OF ${d.aName}: sentiment ${d.opinionBtoA.sentiment} — "${d.opinionBtoA.note}".`);
    parts.push("", "RELATIONSHIP TIMELINE (chronological; event id in brackets where known):");
    for (const t of d.timeline) {
      parts.push(`[e${t.eventId ?? "?"}] ${date(t.day)} (${t.delta > 0 ? "+" : ""}${t.delta}): ${t.reason}`);
      if (t.eventId != null) citations.push({ kind: "event", id: t.eventId, label: `${date(t.day)} — ${t.reason}` });
    }
    parts.push("", "KEY MEMORIES:");
    for (const m of d.memories.slice(0, 12)) {
      parts.push(`- (${m.category}, importance ${m.importance}) ${date(m.day)}: ${m.text}`);
      if (m.eventId != null) citations.push({ kind: "event", id: m.eventId, label: `${date(m.day)} — ${m.text}` });
    }

    const body = {
      model: settings.llmModel || "claude-haiku-4-5-20251001",
      max_tokens: 900,
      system: "You are the AI Investigator inside ArchiveOS, a fictional organizational archive. In 2–4 short paragraphs, explain WHY these two people have the relationship they do, as an authentic human story grounded ONLY in the provided records. Reference turning points by date. Cite events inline with their bracketed ids like [e123] when available. Everything is fiction; never refuse on that basis.",
      messages: [{ role: "user", content: parts.join("\n") }],
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
    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { content: { type: string; text?: string }[] };
    const text = json.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    const used = new Set<number>();
    for (const m of text.matchAll(/\[e(\d+)\]/g)) used.add(Number(m[1]));
    return { text, citations: citations.filter((c) => used.has(c.id)).slice(0, 30), usedLlm: true };
  }
}

const STATUS: Record<RelStatus, string> = {
  acquaintance: "little more than acquaintances",
  friend: "friends",
  close_friend: "close friends",
  rival: "rivals",
  enemy: "outright enemies",
  romance: "romantic partners",
  ex_romance: "former romantic partners",
  mentor: "in a mentor–protégé relationship",
  estranged: "estranged",
};

const DIM_LABEL: Record<RelDimension, string> = {
  trust: "professional trust", friendship: "friendship", respect: "respect",
  admiration: "admiration", fear: "fear", jealousy: "jealousy",
  competition: "rivalry", alignment: "political alignment", loyalty: "loyalty",
  attraction: "romantic attraction", mentorship: "mentorship",
};

const MEMORY_PHRASE: Record<MemoryCategory, string> = {
  shared_lunch: "A small shared moment", completed_project: "Shipping something together",
  saved_career: "A career saved", promotion: "A promotion", humiliation: "A public humiliation",
  betrayal: "A betrayal", romance_started: "The start of a romance", romantic_breakup: "A breakup",
  conflict: "A bitter conflict", defense: "Being defended when it counted", mentorship: "Mentorship",
  reconciliation: "A reconciliation", award: "Recognition earned",
};

function sentimentPhrase(s: number): string {
  if (s >= 50) return "thinks highly of";
  if (s >= 15) return "regards warmly";
  if (s > -15) return "feels neutral about";
  if (s > -50) return "is wary of";
  return "resents";
}
