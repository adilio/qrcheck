export const DEFAULT_FALSE_POSITIVE_RATE: number;
export function fnv1a(str: string, seed: number): number;
export function bloomIndices(value: string, m: number, k: number): number[];
export function buildBloomFilter(
  items: string[],
  falsePositiveRate?: number
): { m: number; k: number; bytes: Uint8Array };
export function bloomHas(value: string, m: number, k: number, bytes: Uint8Array): boolean;
