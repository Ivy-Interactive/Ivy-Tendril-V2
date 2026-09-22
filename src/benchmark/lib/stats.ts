// Statistics for the report. Everything is deterministic (seeded PRNG, no locale-dependent
// formatting) because the same results must regenerate a byte-identical benchmark.md.

export interface Summary {
  n: number;
  min: number;
  max: number;
  mean: number;
  /** Sample standard deviation (n - 1). 0 for n = 1. */
  sd: number;
  median: number;
  p5: number;
  p25: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  iqr: number;
  /** sd / mean. */
  cv: number;
}

function sortedCopy(xs: readonly number[]): Float64Array {
  // Typed-array sort is numeric (a plain array would sort lexicographically).
  return Float64Array.from(xs).sort();
}

/**
 * Quantile of an ascending-sorted array, linear interpolation between order statistics (Hyndman and
 * Fan type 7, the default in R and NumPy): h = (n - 1) p.
 */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (p <= 0) return sorted[0]!;
  if (p >= 1) return sorted[n - 1]!;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

export function quantile(xs: readonly number[], p: number): number {
  return quantileSorted(sortedCopy(xs), p);
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

export function mean(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function summarize(samples: readonly number[]): Summary {
  const s = sortedCopy(samples.filter((x) => Number.isFinite(x)));
  const n = s.length;
  if (n === 0) {
    return { n: 0, min: NaN, max: NaN, mean: NaN, sd: NaN, median: NaN, p5: NaN, p25: NaN, p75: NaN, p90: NaN, p95: NaN, p99: NaN, iqr: NaN, cv: NaN };
  }
  let sum = 0;
  for (const x of s) sum += x;
  const m = sum / n;
  let ss = 0;
  for (const x of s) ss += (x - m) * (x - m);
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const q = (p: number) => quantileSorted(s, p);
  const p25 = q(0.25);
  const p75 = q(0.75);
  return {
    n,
    min: s[0]!,
    max: s[n - 1]!,
    mean: m,
    sd,
    median: q(0.5),
    p5: q(0.05),
    p25,
    p75,
    p90: q(0.9),
    p95: q(0.95),
    p99: q(0.99),
    iqr: p75 - p25,
    cv: m !== 0 ? sd / m : NaN,
  };
}

// ---------------------------------------------------------------------------------------------
// Seeded randomness

/** mulberry32: small, fast, good enough for resampling, and identical on every platform. */
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

/** Stable 32-bit seed from a string (FNV-1a), so each metric gets its own reproducible stream. */
export function seedFrom(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export const DEFAULT_SEED = 0x5eed1234;

// Quickselect keeps a bootstrap of 5000-sample latency arrays cheap (O(n) per resample, no sort).
function selectKth(a: Float64Array, k: number, lo = 0, hi = a.length - 1): number {
  while (hi > lo) {
    const pivot = a[(lo + hi) >>> 1]!;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (a[i]! < pivot) i++;
      while (a[j]! > pivot) j--;
      if (i <= j) {
        const t = a[i]!;
        a[i] = a[j]!;
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k]!;
  }
  return a[k]!;
}

/** Median of a scratch buffer (reordered in place); same value as the type 7 median. */
function medianInPlace(a: Float64Array): number {
  const n = a.length;
  const mid = n >>> 1;
  const hi = selectKth(a, mid);
  if (n % 2 === 1) return hi;
  // After selecting `mid`, everything left of it is <= a[mid]; the other middle value is their max.
  let lo = -Infinity;
  for (let i = 0; i < mid; i++) if (a[i]! > lo) lo = a[i]!;
  return (lo + hi) / 2;
}

function resampleMedian(src: readonly number[], rand: () => number, scratch: Float64Array): number {
  const n = src.length;
  for (let i = 0; i < n; i++) scratch[i] = src[Math.floor(rand() * n)]!;
  return medianInPlace(scratch);
}

export interface CI {
  estimate: number;
  lo: number;
  hi: number;
  iters: number;
  alpha: number;
}

export interface BootstrapOptions {
  iters?: number;
  alpha?: number;
  seed?: number;
}

/** Percentile bootstrap CI of the median. With n < 2 the interval collapses to the point. */
export function bootstrapMedianCI(samples: readonly number[], opts: BootstrapOptions = {}): CI {
  const iters = opts.iters ?? 2000;
  const alpha = opts.alpha ?? 0.05;
  const xs = samples.filter((x) => Number.isFinite(x));
  const est = median(xs);
  if (xs.length < 2) return { estimate: est, lo: est, hi: est, iters: 0, alpha };
  const rand = mulberry32(opts.seed ?? DEFAULT_SEED);
  const scratch = new Float64Array(xs.length);
  const meds = new Float64Array(iters);
  for (let b = 0; b < iters; b++) meds[b] = resampleMedian(xs, rand, scratch);
  meds.sort();
  return { estimate: est, lo: quantileSorted(meds, alpha / 2), hi: quantileSorted(meds, 1 - alpha / 2), iters, alpha };
}

/**
 * Ratio of medians b / a (V2 over V1 by convention) with a percentile bootstrap CI, resampling each
 * group independently. Resamples whose `a` median is 0 are skipped; `iters` is the number kept.
 */
export function ratioCI(a: readonly number[], b: readonly number[], opts: BootstrapOptions = {}): CI {
  const iters = opts.iters ?? 2000;
  const alpha = opts.alpha ?? 0.05;
  const xa = a.filter((x) => Number.isFinite(x));
  const xb = b.filter((x) => Number.isFinite(x));
  const ma = median(xa);
  const mb = median(xb);
  const est = ma === 0 ? NaN : mb / ma;
  if (xa.length === 0 || xb.length === 0) return { estimate: NaN, lo: NaN, hi: NaN, iters: 0, alpha };
  if (xa.length < 2 && xb.length < 2) return { estimate: est, lo: est, hi: est, iters: 0, alpha };
  const rand = mulberry32(opts.seed ?? DEFAULT_SEED);
  const sa = new Float64Array(xa.length);
  const sb = new Float64Array(xb.length);
  const ratios: number[] = [];
  for (let i = 0; i < iters; i++) {
    const ra = resampleMedian(xa, rand, sa);
    const rb = resampleMedian(xb, rand, sb);
    if (ra !== 0) ratios.push(rb / ra);
  }
  if (!ratios.length) return { estimate: est, lo: NaN, hi: NaN, iters: 0, alpha };
  const sorted = Float64Array.from(ratios).sort();
  return { estimate: est, lo: quantileSorted(sorted, alpha / 2), hi: quantileSorted(sorted, 1 - alpha / 2), iters: ratios.length, alpha };
}

// ---------------------------------------------------------------------------------------------
// Mann-Whitney U

/**
 * Complementary error function: Numerical Recipes' erfcc (Chebyshev fit, fractional error below
 * 1.2e-7 everywhere), plenty for a p-value that is only compared against 0.01.
 */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Upper tail of the standard normal, P(Z > z). */
export function normalSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2);
}

export interface MwuResult {
  /** U statistic of sample `a` (scipy's convention: U1 = R1 - n1(n1+1)/2). */
  U: number;
  U1: number;
  U2: number;
  n1: number;
  n2: number;
  /** Normal-approximation z (with tie and continuity correction); NaN for the exact method. */
  z: number;
  /** Two-sided p-value. */
  p: number;
  method: 'exact' | 'asymptotic';
  /** Probability of superiority P(a > b) + 0.5 P(a = b) = U1 / (n1 n2). */
  effect: number;
}

/** Number of arrangements of n1 + n2 items giving each U (no ties), by dynamic programming. */
function exactUCounts(n1: number, n2: number): number[] {
  // f[i][j][u]: count for i items of group 1 and j of group 2. Rolled over j to keep memory small.
  const maxU = n1 * n2;
  let prev: number[][] = [];
  for (let i = 0; i <= n1; i++) {
    prev[i] = new Array(maxU + 1).fill(0);
    prev[i]![0] = 1; // j = 0: only U = 0
  }
  for (let j = 1; j <= n2; j++) {
    const cur: number[][] = [];
    for (let i = 0; i <= n1; i++) {
      cur[i] = new Array(maxU + 1).fill(0);
      for (let u = 0; u <= maxU; u++) {
        // Largest element is from group 2 (adds 0 to U) or from group 1 (adds j to U).
        let v = prev[i]![u]!;
        if (i > 0 && u - j >= 0) v += cur[i - 1]![u - j]!;
        cur[i]![u] = v;
      }
    }
    prev = cur;
  }
  return prev[n1]!;
}

/**
 * Two-sided Mann-Whitney U test, matching scipy.stats.mannwhitneyu(method='auto'): exact
 * distribution when both samples have at most 8 values and there are no ties, otherwise the normal
 * approximation with tie correction and continuity correction. `method` forces one (exact is only
 * possible without ties).
 */
export function mannWhitneyU(a: readonly number[], b: readonly number[], opts: { method?: 'auto' | 'exact' | 'asymptotic' } = {}): MwuResult {
  const xa = a.filter((x) => Number.isFinite(x));
  const xb = b.filter((x) => Number.isFinite(x));
  const n1 = xa.length;
  const n2 = xb.length;
  if (n1 === 0 || n2 === 0) return { U: NaN, U1: NaN, U2: NaN, n1, n2, z: NaN, p: NaN, method: 'asymptotic', effect: NaN };

  const all = [...xa.map((v) => ({ v, g: 0 })), ...xb.map((v) => ({ v, g: 1 }))].sort((x, y) => x.v - y.v);
  const n = all.length;
  let r1 = 0;
  let tieTerm = 0;
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && all[j + 1]!.v === all[i]!.v) j++;
    const t = j - i + 1;
    const midrank = (i + j + 2) / 2; // ranks are 1-based
    for (let k = i; k <= j; k++) if (all[k]!.g === 0) r1 += midrank;
    if (t > 1) tieTerm += t * t * t - t;
    i = j + 1;
  }
  const U1 = r1 - (n1 * (n1 + 1)) / 2;
  const U2 = n1 * n2 - U1;
  const Umax = Math.max(U1, U2);
  const effect = U1 / (n1 * n2);

  const method = opts.method ?? 'auto';
  if (method === 'exact' && tieTerm !== 0) throw new Error('mannWhitneyU: the exact method needs samples without ties');
  if (method === 'exact' || (method === 'auto' && n1 <= 8 && n2 <= 8 && tieTerm === 0)) {
    const counts = exactUCounts(n1, n2);
    const total = counts.reduce((s, c) => s + c, 0);
    let tail = 0;
    for (let u = Math.ceil(Umax); u < counts.length; u++) tail += counts[u]!;
    return { U: U1, U1, U2, n1, n2, z: NaN, p: Math.min(1, (2 * tail) / total), method: 'exact', effect };
  }

  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieTerm / (n * (n - 1))));
  if (!(sigma > 0)) return { U: U1, U1, U2, n1, n2, z: 0, p: 1, method: 'asymptotic', effect };
  const z = (Umax - mu - 0.5) / sigma;
  const p = Math.min(1, Math.max(0, 2 * normalSf(z)));
  return { U: U1, U1, U2, n1, n2, z, p, method: 'asymptotic', effect };
}

/** Differences with p >= this are flagged "not significant" in the report. */
export const SIGNIFICANCE_P = 0.01;

// ---------------------------------------------------------------------------------------------
// Sampling helpers

/**
 * At most `max` values taken at evenly spaced positions (no randomness, so reruns of the report on
 * the same raw data are identical). Keeps order, so time structure in the samples survives.
 */
export function systematicSubsample(xs: readonly number[], max: number): number[] {
  if (xs.length <= max) return xs.slice();
  const out: number[] = [];
  const step = xs.length / max;
  for (let i = 0; i < max; i++) out.push(xs[Math.floor(i * step)]!);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Formatting (fixed-format, locale-independent)

/** 1234567.8 -> "1,234,568" (thousands separators, rounded to `digits`). */
export function fmtInt(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return 'n/a';
  const neg = x < 0;
  const fixed = Math.abs(x).toFixed(digits);
  const [int, frac] = fixed.split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** Significant-looking precision for a value: 3 decimals below 1, then 2, 1 and 0. */
function autoDigits(x: number): number {
  const a = Math.abs(x);
  if (a < 1) return 3;
  if (a < 10) return 2;
  if (a < 100) return 1;
  return 0;
}

/** Milliseconds: "0.412 ms", "4.20 ms", "42.0 ms", "420 ms", "4,200 ms"; `seconds` switches >= 10 s to "12.3 s". */
export function fmtMs(ms: number, opts: { digits?: number; seconds?: boolean } = {}): string {
  if (!Number.isFinite(ms)) return 'n/a';
  if (opts.seconds && Math.abs(ms) >= 10_000) return `${fmtInt(ms / 1000, 1)} s`;
  return `${fmtInt(ms, opts.digits ?? autoDigits(ms))} ms`;
}

export const MIB = 1024 * 1024;
export const MB = 1_000_000;

/** Memory is reported in MiB (2^20). */
export function fmtMiB(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes)) return 'n/a';
  return `${fmtInt(bytes / MIB, digits)} MiB`;
}

/** File sizes are reported in MB (10^6), optionally followed by the exact byte count. */
export function fmtMB(bytes: number, opts: { digits?: number; exact?: boolean } = {}): string {
  if (!Number.isFinite(bytes)) return 'n/a';
  const mb = `${fmtInt(bytes / MB, opts.digits ?? (bytes < MB ? 3 : bytes < 100 * MB ? 2 : 1))} MB`;
  return opts.exact ? `${mb} (${fmtInt(bytes)} B)` : mb;
}

/** Bytes with the unit convention of their kind: memory in MiB, files in MB with exact bytes. */
export function fmtBytes(bytes: number, kind: 'memory' | 'file' = 'file'): string {
  return kind === 'memory' ? fmtMiB(bytes) : fmtMB(bytes, { exact: true });
}

/**
 * A ratio b / a in words from the point of view of b: 0.31 -> "3.2x less", 1.4 -> "1.4x more",
 * within 2.5% of 1 -> "about the same". Callers pick the words ("faster"/"slower" for latency).
 */
export function fmtRatio(r: number, words: { less?: string; more?: string; same?: string } = {}): string {
  if (!Number.isFinite(r) || r <= 0) return 'n/a';
  const less = words.less ?? 'less';
  const more = words.more ?? 'more';
  if (Math.abs(r - 1) < 0.025) return words.same ?? 'about the same';
  const f = r < 1 ? 1 / r : r;
  const digits = f >= 100 ? 0 : f >= 10 ? 1 : f >= 1.1 ? 1 : 2;
  return `${f.toFixed(digits)}x ${r < 1 ? less : more}`;
}

export function fmtPercent(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return 'n/a';
  return `${x.toFixed(digits)}%`;
}

/** "12.3 [11.9, 12.8]" style interval text using a caller-supplied number formatter. */
export function fmtCI(ci: CI, fmt: (x: number) => string): string {
  if (!Number.isFinite(ci.estimate)) return 'n/a';
  if (!Number.isFinite(ci.lo) || ci.iters === 0) return fmt(ci.estimate);
  return `${fmt(ci.estimate)} [${fmt(ci.lo)}, ${fmt(ci.hi)}]`;
}
