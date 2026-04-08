/**
 * Deterministic pseudo-random selection for Layer 3 unpredictable sampling.
 * Uses Mulberry32 PRNG seeded from engagement-specific data to ensure
 * reproducible but unpredictable journal selection.
 */

/**
 * Mulberry32 PRNG — returns a function that produces pseudo-random
 * floats in [0, 1) on each call.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simple string hash producing a 32-bit numeric seed.
 * Uses the djb2 algorithm variant (xor).
 */
export function hashSeed(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return hash >>> 0; // ensure unsigned 32-bit
}

/**
 * Deterministic sampling using Fisher-Yates shuffle with Mulberry32 PRNG.
 * Returns `count` items from `items` in a reproducibly shuffled order.
 * Does not mutate the original array.
 */
export function deterministicSample<T>(items: T[], count: number, seed: number): T[] {
  if (items.length === 0 || count <= 0) return [];

  const rng = mulberry32(seed);
  const arr = [...items]; // shallow copy to avoid mutation

  // Fisher-Yates shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.slice(0, Math.min(count, arr.length));
}
