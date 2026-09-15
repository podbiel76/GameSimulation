/**
 * Przebiegi referencyjne silnika symulacji (faza 3).
 *
 *   npm test               — porównanie z zapisanymi przebiegami
 *   npm run test:update    — świadoma aktualizacja przebiegów po zmianie modelu
 *
 * Przebiegi leżą w tests/sim/reference/*.json. Zmiana liczb modelu (np.
 * ATTRITION_COEFFICIENT) musi wywalić te testy — inaczej przebiegi nie pokrywają
 * mechaniki. Asercje „pokrycia" poniżej pilnują, że każda mechanika faktycznie
 * występuje w swoim scenariuszu, nawet po regeneracji plików.
 */
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../src/sim/scenarios";
import { runScenario, serializeRun, type ReferenceRun } from "../../src/sim/recorder";

const runs = new Map<string, ReferenceRun>(SCENARIOS.map(sc => [sc.name, runScenario(sc)]));
const run = (name: string) => {
  const r = runs.get(name);
  if (!r) throw new Error(`Brak scenariusza ${name}`);
  return r;
};
const lastFrame = (name: string) => run(name).frames[run(name).frames.length - 1];
const unitIn = (frame: ReturnType<typeof lastFrame>, id: string) => {
  const u = frame.units.find(x => x.id === id);
  if (!u) throw new Error(`Brak jednostki ${id}`);
  return u;
};

describe("przebiegi referencyjne", () => {
  for (const sc of SCENARIOS) {
    it(sc.name, async () => {
      await expect(serializeRun(run(sc.name))).toMatchFileSnapshot(`./reference/${sc.name}.json`);
    });
  }
});

describe("determinizm", () => {
  it("ten sam scenariusz liczony dwa razy daje identyczny przebieg", () => {
    for (const sc of SCENARIOS) {
      expect(serializeRun(runScenario(sc))).toBe(serializeRun(run(sc.name)));
    }
  });
});

describe("pokrycie mechanik", () => {
  it("ruch: trasa przejechana do końca, paliwo spalone", () => {
    const first = run("ruch").frames[0];
    const last = lastFrame("ruch");
    expect(last.routesLeft.F1).toBe(0);
    expect(unitIn(last, "F1").fuel!).toBeLessThan(unitIn(first, "F1").fuel!);
  });

  it("hierarchia: podległy przesuwa się z przełożonym, jego trasa jest zdejmowana", () => {
    const first = run("ruch_z_hierarchia").frames[0];
    const last = lastFrame("ruch_z_hierarchia");
    const dxParent = unitIn(last, "P").x! - unitIn(first, "P").x!;
    const dxChild = unitIn(last, "C").x! - unitIn(first, "C").x!;
    expect(dxParent).toBeGreaterThan(0);
    expect(dxChild).toBeCloseTo(dxParent, 3);
    expect(last.routesLeft.C).toBe(0);
    expect(last.aoFirstVertex.C[0]).not.toBe(first.aoFirstVertex.C[0]);
  });

  it("natarcie 1v1: starcie z atakującym friendly", () => {
    const start = run("natarcie_1v1").events.find(e => e.type === "engagement_start");
    expect(start).toMatchObject({ attackerSide: "friendly" });
  });

  it("starcie grupowe: jedna grupa 2 na 2", () => {
    const starts = run("starcie_grupowe").events.filter(e => e.type === "engagement_start");
    expect(starts.map(e => e.key)).toContain("F1,F2|vs|H1,H2");
  });

  it("zniszczenie: jednostka traci wszystkich ludzi", () => {
    const ev = run("zniszczenie_brak_ludzi").events.find(e => e.type === "unit_defeated");
    expect(ev).toMatchObject({ unitId: "F1", kind: "destroyed" });
  });

  it("poddanie: brak amunicji strzeleckiej", () => {
    const ev = run("poddanie_brak_amunicji").events.find(e => e.type === "unit_defeated");
    expect(ev).toMatchObject({ unitId: "F1", kind: "surrendered" });
  });

  it("porażka strony: potencjał poniżej progu", () => {
    const ev = run("porazka_strony_prog").events.find(e => e.type === "unit_defeated");
    expect(ev).toMatchObject({ unitId: "F1", kind: "side_defeated" });
  });

  it("paliwo: zapas spada do zera w trakcie trasy", () => {
    expect(unitIn(lastFrame("wyczerpanie_paliwa"), "A1").fuel).toBe(0);
  });
});
