import { describe, expect, it } from "vitest";
import { Rng, clamp } from "../src/sim/rng";

describe("Rng", () => {
  it("is deterministic for a given seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it("produces different streams for different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let diff = 0;
    for (let i = 0; i < 100; i++) if (a.next() !== b.next()) diff++;
    expect(diff).toBeGreaterThan(90);
  });

  it("resumes from a serialized state", () => {
    const a = new Rng(7);
    for (let i = 0; i < 50; i++) a.next();
    const saved = a.state;
    const expected = [a.next(), a.next(), a.next()];
    const b = new Rng(0);
    b.state = saved;
    expect([b.next(), b.next(), b.next()]).toEqual(expected);
  });

  it("int stays within bounds", () => {
    const r = new Rng(99);
    for (let i = 0; i < 5000; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it("weighted respects weights approximately", () => {
    const r = new Rng(5);
    let a = 0;
    for (let i = 0; i < 10000; i++) {
      if (r.weighted([["a", 9], ["b", 1]] as const) === "a") a++;
    }
    expect(a).toBeGreaterThan(8500);
    expect(a).toBeLessThan(9500);
  });

  it("gauss stays clamped", () => {
    const r = new Rng(3);
    for (let i = 0; i < 5000; i++) {
      const v = r.gauss(50, 20, 10, 90);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(90);
    }
  });

  it("clamp works", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
