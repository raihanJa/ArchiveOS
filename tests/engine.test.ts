import { describe, expect, it } from "vitest";
import { Engine } from "../src/sim/engine";
import { activeEmployees } from "../src/sim/world";
import type { SimEvent } from "../src/shared/types";
import { ORG_KINDS } from "../src/shared/types";

function runEngine(seed: number, days: number): { engine: Engine; events: SimEvent[] } {
  const engine = Engine.create("Test Org", "ai_company", seed);
  const events: SimEvent[] = [];
  events.push(...engine.drain().events);
  for (let i = 0; i < days; i++) {
    engine.tickDay();
    events.push(...engine.drain().events);
  }
  return { engine, events };
}

describe("Engine founding", () => {
  it("creates a founder, departments and a founding event", () => {
    const engine = Engine.create("Acme", "ai_company", 1);
    const out = engine.drain();
    expect(out.events.some((e) => e.type === "founding")).toBe(true);
    expect(engine.world.org.ceoId).not.toBeNull();
    expect(engine.world.departments.size).toBeGreaterThanOrEqual(3);
    expect(activeEmployees(engine.world).length).toBeGreaterThan(3);
  });

  it("founds every organization kind without throwing", () => {
    for (const { kind } of ORG_KINDS) {
      const engine = Engine.create(`Test ${kind}`, kind, 123);
      for (let i = 0; i < 120; i++) engine.tickDay();
      expect(engine.world.org.day).toBe(120);
      expect(engine.drain).toBeTypeOf("function");
    }
  });
});

describe("Engine determinism", () => {
  it("produces identical event streams for identical seeds", () => {
    const a = runEngine(2024, 400);
    const b = runEngine(2024, 400);
    expect(a.events.length).toBe(b.events.length);
    for (let i = 0; i < a.events.length; i++) {
      expect(a.events[i].type).toBe(b.events[i].type);
      expect(a.events[i].headline).toBe(b.events[i].headline);
      expect(a.events[i].day).toBe(b.events[i].day);
    }
  });

  it("advances the calendar exactly one day per tick", () => {
    const { engine } = runEngine(5, 365);
    expect(engine.world.org.day).toBe(365);
  });
});

describe("Engine emergent history", () => {
  it("generates a substantial, varied history over time", () => {
    const { events } = runEngine(777, 1500);
    expect(events.length).toBeGreaterThan(300);
    const types = new Set(events.map((e) => e.type));
    // A broad spread of event kinds should emerge.
    expect(types.size).toBeGreaterThan(12);
    expect(events.some((e) => e.type === "hire")).toBe(true);
    expect(events.some((e) => e.type === "project_started")).toBe(true);
  });

  it("grows the organization", () => {
    const { engine } = runEngine(31, 1500);
    expect(engine.world.employees.size).toBeGreaterThan(10);
    expect(engine.world.projects.size).toBeGreaterThan(2);
  });

  it("links some events causally", () => {
    const { events } = runEngine(88, 2500);
    const withCauses = events.filter((e) => e.causeIds.length > 0);
    expect(withCauses.length).toBeGreaterThan(5);
    // Every referenced cause must be an event that already happened.
    const ids = new Set(events.map((e) => e.id));
    for (const e of withCauses) for (const c of e.causeIds) expect(ids.has(c)).toBe(true);
  });

  it("assigns causes that precede their effects", () => {
    const { events } = runEngine(456, 2000);
    const byId = new Map(events.map((e) => [e.id, e]));
    for (const e of events) {
      for (const c of e.causeIds) {
        const cause = byId.get(c);
        if (cause) expect(cause.day).toBeLessThanOrEqual(e.day);
      }
    }
  });

  it("emits documents alongside events", () => {
    const engine = Engine.create("DocCo", "cybersecurity", 9);
    let docs = 0;
    for (let i = 0; i < 800; i++) {
      engine.tickDay();
      docs += engine.drain().documents.length;
    }
    expect(docs).toBeGreaterThan(20);
  });
});

describe("Engine invariants", () => {
  it("keeps employee stats within bounds", () => {
    const { engine } = runEngine(64, 1500);
    for (const e of engine.world.employees.values()) {
      for (const v of [e.skill, e.stress, e.happiness, e.reputation]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it("never leaves a unique-id collision", () => {
    const { events } = runEngine(11, 1000);
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
