import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchiveDb } from "../src/main/db";
import { Engine } from "../src/sim/engine";

const dir = mkdtempSync(join(tmpdir(), "archiveos-test-"));
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

function seededDb(name: string, days: number): { db: ArchiveDb; engine: Engine } {
  const db = new ArchiveDb(join(dir, name));
  const engine = Engine.create("Persist Co", "ai_company", 2024);
  db.flush(engine.world, engine.drain());
  for (let i = 0; i < days; i++) {
    engine.tickDay();
    if (i % 25 === 0) db.flush(engine.world, engine.drain());
  }
  db.flush(engine.world, engine.drain());
  return { db, engine };
}

describe("ArchiveDb persistence", () => {
  it("round-trips the world through save and load", () => {
    const { db, engine } = seededDb("roundtrip.db", 600);
    const stats = db.stats();
    expect(stats.events).toBeGreaterThan(100);
    expect(stats.employeesTotal).toBeGreaterThan(5);

    const world2 = db.loadWorld();
    expect(world2).not.toBeNull();
    expect(world2!.org.day).toBe(engine.world.org.day);
    expect(world2!.employees.size).toBe(engine.world.employees.size);
    expect(world2!.projects.size).toBe(engine.world.projects.size);
    expect(world2!.nextId).toBe(engine.world.nextId);
    db.close();
  });

  it("round-trips the full relationship graph", () => {
    const { db, engine } = seededDb("relgraph.db", 1500);
    const w2 = db.loadWorld();
    expect(w2).not.toBeNull();
    expect(w2!.relationships.size).toBe(engine.world.relationships.size);
    expect(w2!.memories.size).toBe(engine.world.memories.size);
    expect(w2!.opinions.size).toBe(engine.world.opinions.size);
    expect(w2!.secrets.size).toBe(engine.world.secrets.size);
    expect(w2!.rumors.size).toBe(engine.world.rumors.size);
    expect(w2!.reputationMarks.size).toBe(engine.world.reputationMarks.size);
    // A relationship's dimension vector survives the trip intact.
    for (const [key, rel] of engine.world.relationships) {
      const r2 = w2!.relationships.get(key);
      expect(r2).toBeDefined();
      expect(r2!.dims).toEqual(rel.dims);
      expect(r2!.status).toBe(rel.status);
    }
    db.close();
  });

  it("continues deterministically after reload", () => {
    const { db, engine } = seededDb("continue.db", 300);
    const world2 = db.loadWorld()!;
    db.close();

    // Continue both the original and the reloaded engine; they must match.
    const contA: string[] = [];
    for (let i = 0; i < 200; i++) { engine.tickDay(); contA.push(...engine.drain().events.map((e) => e.headline)); }

    const engine2 = new Engine(world2);
    const contB: string[] = [];
    for (let i = 0; i < 200; i++) { engine2.tickDay(); contB.push(...engine2.drain().events.map((e) => e.headline)); }

    expect(contB).toEqual(contA);
  });

  it("finds events via search", () => {
    const { db } = seededDb("search.db", 800);
    const results = db.search("project");
    expect(results.length).toBeGreaterThan(0);
    db.close();
  });

  it("builds causal chains", () => {
    const { db } = seededDb("causal.db", 1500);
    const withCauses = db.listEvents({ limit: 500 }).rows.find((e) => e.causeIds.length > 0);
    if (withCauses) {
      const chain = db.causalChain(withCauses.id);
      expect(Array.isArray(chain)).toBe(true);
    }
    db.close();
  });

  it("wipes cleanly", () => {
    const { db } = seededDb("wipe.db", 100);
    db.wipe();
    const stats = db.stats();
    expect(stats.events).toBe(0);
    expect(stats.employeesTotal).toBe(0);
    expect(db.hasWorld()).toBe(false);
    db.close();
  });
});
