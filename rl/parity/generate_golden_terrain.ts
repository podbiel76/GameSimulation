/**
 * generate_golden_terrain.ts — zrzuca golden dla klasyfikatora terenu z modelu TS
 * (src/utils/terrainClassifier.ts), by port Pythona (rl/terrain/classifier.py) odtworzył go 1:1.
 *
 * Uruchom z katalogu repo:
 *     npx tsx rl/parity/generate_golden_terrain.ts
 * Wynik: rl/parity/golden_terrain.json
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  classifyPixelColor,
  determineTerrain,
} from "../../src/utils/terrainClassifier";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Deterministyczny przemiat przestrzeni RGB (co 17 → 16^3=4096 próbek).
const pixelCases: { r: number; g: number; b: number; cls: string }[] = [];
for (let r = 0; r <= 255; r += 17) {
  for (let g = 0; g <= 255; g += 17) {
    for (let b = 0; b <= 255; b += 17) {
      pixelCases.push({ r, g, b, cls: classifyPixelColor(r, g, b) });
    }
  }
}

// Reprezentatywne rozkłady zliczeń dla determineTerrain (w tym reguła wetland).
const countCases = [
  { counts: { forest: 80, water: 5,  urban: 5,  road: 5,  open: 5  }, total: 100 },
  { counts: { forest: 10, water: 20, urban: 5,  road: 5,  open: 60 }, total: 100 }, // wetland
  { counts: { forest: 10, water: 70, urban: 5,  road: 5,  open: 10 }, total: 100 }, // water body
  { counts: { forest: 10, water: 20, urban: 30, road: 5,  open: 35 }, total: 100 }, // urban veto on wetland
  { counts: { forest: 25, water: 0,  urban: 25, road: 25, open: 25 }, total: 100 }, // tie -> first (forest)
  { counts: { forest: 0,  water: 0,  urban: 0,  road: 0,  open: 0  }, total: 0   }, // empty
].map(c => ({ ...c, terrain: determineTerrain(c.counts as any, c.total) }));

const out = { pixelCases, countCases };
const target = resolve(__dirname, "golden_terrain.json");
writeFileSync(target, JSON.stringify(out) + "\n", "utf-8");
console.log(`Zapisano ${pixelCases.length} pixel + ${countCases.length} count cases -> ${target}`);
