/**
 * Deterministic seedable RNG (mulberry32). The engine's entire state,
 * including this generator's cursor, is serializable so a restarted
 * simulation continues exactly where it left off.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Serialize/restore the generator position. */
  get state(): number {
    return this.s;
  }
  set state(v: number) {
    this.s = v >>> 0;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Pick n distinct elements (or fewer if the array is small). */
  sample<T>(arr: readonly T[], n: number): T[] {
    const copy = arr.slice();
    const out: T[] = [];
    while (out.length < n && copy.length > 0) {
      out.push(copy.splice(Math.floor(this.next() * copy.length), 1)[0]);
    }
    return out;
  }

  /** Weighted pick: entries of [value, weight]. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = this.next() * total;
    for (const [v, w] of entries) {
      r -= w;
      if (r <= 0) return v;
    }
    return entries[entries.length - 1][0];
  }

  /** Approximately normal value via central limit, clamped. */
  gauss(mean: number, sd: number, min: number, max: number): number {
    const u = (this.next() + this.next() + this.next() + this.next() - 2) / 2; // ~N(0, 0.29)
    const v = mean + u * sd * 3.46;
    return Math.max(min, Math.min(max, v));
  }
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
