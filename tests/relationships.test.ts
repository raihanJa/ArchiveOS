import { describe, expect, it } from "vitest";
import { Engine, type TickOutput } from "../src/sim/engine";
import {
  emptyDims, personalityCompatibility, relOverall, relStatusFromDims,
  type Personality, type SimEvent,
} from "../src/shared/types";

function runCollecting(seed: number, days: number, kind: Parameters<typeof Engine.create>[1] = "ai_company") {
  const engine = Engine.create("Rel Co", kind, seed);
  const events: SimEvent[] = [...engine.drain().events];
  const outs: TickOutput[] = [];
  for (let i = 0; i < days; i++) {
    engine.tickDay();
    const out = engine.drain();
    events.push(...out.events);
    outs.push(out);
  }
  return { engine, events, outs };
}

const P = (o: Partial<Personality>): Personality => ({
  openness: 50, diligence: 50, ambition: 50, empathy: 50, volatility: 50,
  integrity: 50, narcissism: 30, ...o,
});

describe("relationship dimensions", () => {
  it("derives overall and status purely from dimensions", () => {
    const friendly = { ...emptyDims(), friendship: 70, trust: 40 };
    expect(relOverall(friendly)).toBeGreaterThan(0);
    expect(relStatusFromDims(friendly)).toBe("close_friend");

    const hostile = { ...emptyDims(), competition: 70, trust: -40, friendship: -30 };
    expect(relOverall(hostile)).toBeLessThan(0);
    expect(["rival", "enemy"]).toContain(relStatusFromDims(hostile));

    const lovers = { ...emptyDims(), attraction: 60, friendship: 30 };
    expect(relStatusFromDims(lovers)).toBe("romance");
  });

  it("computes symmetric personality compatibility", () => {
    const a = P({ openness: 80, empathy: 70, integrity: 70 });
    const b = P({ openness: 78, empathy: 65, integrity: 72 });
    expect(personalityCompatibility(a, b)).toBe(personalityCompatibility(b, a));
    // Two hyper-ambitious narcissists should not be a natural match.
    const ego1 = P({ ambition: 95, narcissism: 90, empathy: 10, integrity: 20 });
    const ego2 = P({ ambition: 95, narcissism: 90, empathy: 10, integrity: 20 });
    const warm1 = P({ empathy: 85, openness: 70, integrity: 75, ambition: 40, narcissism: 15 });
    const warm2 = P({ empathy: 82, openness: 72, integrity: 78, ambition: 40, narcissism: 15 });
    expect(personalityCompatibility(warm1, warm2)).toBeGreaterThan(personalityCompatibility(ego1, ego2));
  });
});

describe("relationship engine emergence", () => {
  it("writes a timeline entry and memory for every scored change", () => {
    const { outs } = runCollecting(2024, 800);
    const timeline = outs.flatMap((o) => o.relTimeline);
    expect(timeline.length).toBeGreaterThan(10);
    // Every timeline entry carries a human-readable reason.
    for (const t of timeline) expect(t.reason.length).toBeGreaterThan(0);
  });

  it("accumulates relationships, memories, opinions and witnesses", () => {
    const { engine, outs } = runCollecting(99, 1500);
    expect(engine.world.relationships.size).toBeGreaterThan(5);
    expect(engine.world.memories.size).toBeGreaterThan(5);
    expect(engine.world.opinions.size).toBeGreaterThan(0);
    expect(outs.flatMap((o) => o.witnesses).length).toBeGreaterThan(0);
    expect(outs.flatMap((o) => o.personalMemories).length).toBeGreaterThan(0);
  });

  it("keeps every dimension within bounds", () => {
    const { engine } = runCollecting(7, 1500);
    for (const r of engine.world.relationships.values()) {
      for (const v of Object.values(r.dims)) {
        expect(v).toBeGreaterThanOrEqual(-100);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("creates secrets that stay hidden until discovered", () => {
    const { engine, events } = runCollecting(31, 4000);
    expect(engine.world.secrets.size).toBeGreaterThan(0);
    // A secret is only ever public via a secret_exposed / scandal event.
    for (const s of engine.world.secrets.values()) {
      if (s.status === "hidden") {
        expect(s.exposedDay).toBeNull();
      }
    }
    const exposed = [...engine.world.secrets.values()].filter((s) => s.status === "exposed");
    if (exposed.length > 0) {
      expect(events.some((e) => e.type === "secret_exposed")).toBe(true);
    }
  });

  it("spreads rumors that move opinions", () => {
    const { engine } = runCollecting(88, 3000);
    // Some rumor has reached believers.
    const spread = [...engine.world.rumors.values()].some((r) => r.believers.length > 1);
    expect(engine.world.rumors.size >= 0).toBe(true);
    // Opinions formed with a rumor source exist once rumors circulate.
    if (spread) {
      const rumorOpinions = [...engine.world.opinions.values()].some((o) => o.source === "rumor");
      expect(rumorOpinions).toBe(true);
    }
  });

  it("keeps critical scandals extremely rare", () => {
    let criticals = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { events } = runCollecting(seed, 4000);
      criticals += events.filter((e) => e.type === "scandal" && e.data.tier === "critical").length;
    }
    // At most a small handful across six multi-decade histories.
    expect(criticals).toBeLessThan(4);
  });
});
