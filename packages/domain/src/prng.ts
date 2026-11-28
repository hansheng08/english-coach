/** Seeded PRNG (mulberry32); returns values in [0, 1). The seed is coerced with `>>> 0`. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Partial Fisher–Yates: the first min(n, length) items of a seeded shuffle. Does not modify `items`. */
export function sampleWithSeed<T>(items: readonly T[], n: number, seed: number): T[] {
  const copy = items.map((value) => ({ value }));
  const k = Math.min(Math.max(0, Math.floor(n)), copy.length);
  const next = mulberry32(seed);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(next() * (copy.length - i));
    const a = copy[i];
    const b = copy[j];
    if (a === undefined || b === undefined) continue;
    copy[i] = b;
    copy[j] = a;
  }
  return copy.slice(0, k).map((w) => w.value);
}

function utf8Bytes(s: string): number[] {
  const bytes: number[] = [];
  for (const ch of s) {
    // Lone surrogates become U+FFFD, like TextEncoder.
    const cp = ch.codePointAt(0) ?? 0xfffd;
    const c = cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp;
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return bytes;
}

/** FNV-1a 32-bit over the UTF-8 bytes of `s`; returns an integer from 0 to 4294967295. */
export function seedFromString(s: string): number {
  let hash = 0x811c9dc5;
  for (const byte of utf8Bytes(s)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
}
