import type { Track } from "./anim.ts";
import type { Pt } from "./model.ts";

export type Seg = [string, ...number[]];
export type Paint = Record<string, string | number>;

export interface Geom {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rx?: number;
  ry?: number;
  cx?: number;
  cy?: number;
  r?: number;
  points?: Pt[];
  segs?: Seg[];
  text?: string;
  anchor?: string;
  rotate?: number;
  href?: string;
}

export interface Elem {
  kind: "group" | "rect" | "ellipse" | "circle" | "polygon" | "polyline" | "path" | "text" | "image";
  id?: string;
  cls?: string;
  geom: Geom;
  paint: Paint;
  tracks: Track[];
  children: Elem[];
}

export interface Scene {
  width: number;
  height: number;
  background?: string;
  layers: Elem[];
}

export const elem = (kind: Elem["kind"], o: Partial<Omit<Elem, "kind">> = {}): Elem => ({
  kind,
  geom: {},
  paint: {},
  tracks: [],
  children: [],
  ...o,
});

export function* walkElems(e: Elem): Generator<Elem> {
  yield e;
  for (const c of e.children) yield* walkElems(c);
}

export function effects(s: Scene): Set<string> {
  const out = new Set<string>();
  for (const l of s.layers) for (const e of walkElems(l)) if (e.paint.filter) out.add(String(e.paint.filter));
  return out;
}
