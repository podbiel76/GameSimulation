/**
 * Deterministyczny generator liczb losowych (mulberry32) dla symulacji.
 *
 * Ziarno żyje w stanie symulacji, więc ten sam scenariusz przeliczony tą samą
 * liczbą kroków daje te same straty — warunek przebiegów referencyjnych (faza 3).
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
