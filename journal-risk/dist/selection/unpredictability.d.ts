/**
 * Deterministic pseudo-random selection for Layer 3 unpredictable sampling.
 * Uses Mulberry32 PRNG seeded from engagement-specific data to ensure
 * reproducible but unpredictable journal selection.
 */
/**
 * Simple string hash producing a 32-bit numeric seed.
 * Uses the djb2 algorithm variant (xor).
 */
export declare function hashSeed(input: string): number;
/**
 * Deterministic sampling using Fisher-Yates shuffle with Mulberry32 PRNG.
 * Returns `count` items from `items` in a reproducibly shuffled order.
 * Does not mutate the original array.
 */
export declare function deterministicSample<T>(items: T[], count: number, seed: number): T[];
//# sourceMappingURL=unpredictability.d.ts.map