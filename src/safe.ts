export const MAX_NUM = 1e6;
export const MAX_EDGES = 10_000;
export const MAX_VAR_LEN = 10_000;
export const NUM: string = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const LEAD = new RegExp(`^\\s*(${NUM})`);

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function number(v: string | undefined, def: number = 0, lo: number = -MAX_NUM, hi: number = MAX_NUM): number {
  const m = v === undefined ? null : LEAD.exec(v);
  const n = m ? Number(m[1]) : Number.NaN;
  return Number.isNaN(n) ? def : clamp(n, lo, hi);
}

export const numbers = (v: string | undefined): number[] =>
  [...(v ?? "").matchAll(new RegExp(NUM, "g"))].map((m) => clamp(Number(m[0]), -MAX_NUM, MAX_NUM));

/** Python-style round(): halves go to the even neighbour. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export const copysign = (a: number, b: number): number => (b < 0 || Object.is(b, -0) ? -Math.abs(a) : Math.abs(a));

/** Python's `{:g}` for the short numbers pdg prints. */
export const fmtG = (n: number): string => String(Number.parseFloat(n.toPrecision(6)));

/** `a or b`: Python falls through on empty dicts/strings. */
export const or = <T extends object | string>(a: T | undefined, b: T): T =>
  a && (typeof a === "string" ? a : Object.keys(a).length) ? a : b;

type Key = number | string | boolean;
export function cmpTuple(a: readonly Key[], b: readonly Key[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Key;
    const y = b[i] as Key;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export const last = <T>(a: readonly T[]): T => a[a.length - 1] as T;

export const mean = (a: readonly number[]): number => a.reduce((s, x) => s + x, 0) / a.length;
