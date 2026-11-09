import { clamp, NUM, numbers } from "./safe.ts";

export interface Track {
  attr: string;
  values: number[];
  dur: number;
}

export const track = (attr: string, values: number[], dur: number): Track => ({
  attr,
  values: values.length > 1 ? values : [...values, ...values],
  dur: dur > 0 ? dur : 1,
});

export function trackAt(t: Track, time: number): number {
  const n = t.values.length - 1;
  const ph = ((((time % t.dur) + t.dur) % t.dur) / t.dur) * n;
  const i = Math.min(Math.floor(ph), n - 1);
  const [a, b] = [t.values[i] as number, t.values[i + 1] as number];
  return a + (b - a) * (ph - i);
}

export const shifted = (t: Track, delta: number): Track =>
  track(
    t.attr,
    t.values.map((v) => v + delta),
    t.dur,
  );

export function seconds(v: string | undefined, def = 1): number {
  const m = v === undefined ? null : new RegExp(`^\\s*(${NUM})\\s*(ms|s)?\\s*$`).exec(v);
  if (!m) return def;
  const n = Number(m[1]) / (m[2] === "ms" ? 1000 : 1);
  return Number.isNaN(n) ? def : clamp(n, 0.05, 3600);
}

export function dashLen(dash: string | undefined): number {
  const nums = numbers(dash).map(Math.abs);
  return (nums.length % 2 ? [...nums, ...nums] : nums).reduce((s, x) => s + x, 0);
}

export const flowTracks = (dash: string, dur: number, reverse: boolean): Track[] => {
  const L = dashLen(dash) || 10;
  return [track("stroke-dashoffset", reverse ? [0, L] : [L, 0], dur)];
};

export const drawTracks = (length: number, dur: number): Track[] => [track("stroke-dashoffset", [0, 0, -length, -2 * length], dur)];

export const BORDER_MODES: string[] = ["march", "pulse", "glow"];

export function borderTracks(mode: string, sw: number, dash: string | undefined, dur: number): Track[] {
  if (mode === "march") return [track("stroke-dashoffset", [dashLen(dash) || 10, 0], dur)];
  if (mode === "pulse") return [track("stroke-opacity", [1, 0.35, 1], dur), track("stroke-width", [sw, sw * 2.2, sw], dur)];
  if (mode === "glow") return [track("stroke-width", [sw, sw + 10, sw + 10], dur), track("stroke-opacity", [0.7, 0, 0], dur)];
  return [];
}
