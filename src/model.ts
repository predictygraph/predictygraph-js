import type { ImageInfo } from "./text.ts";

/** Loads what `css "file"` (kind css: returns CSS text) and `image=file` (kind image: returns a data:/http URL) point at. */
export type Resolver = (path: string, kind: "css" | "image") => string;
export type Style = Record<string, string>;
export type Pt = [number, number];

export interface Box {
  ax: number;
  ay: number;
  w: number;
  h: number;
}

interface Base extends Box {
  id: string;
  label?: string;
  classes: string[];
  attrs: Record<string, string>;
  parent?: Group;
  style: Style;
  subStyle: Style;
  x: number;
  y: number;
}

export interface Node extends Base {
  kind: "node";
  implicit: boolean;
  image?: ImageInfo;
  textLines: string[];
  textW: number;
  textH: number;
  subLines: string[];
  subH: number;
}

export interface LayoutInfo {
  rankIndex: Map<string, number>;
  waypoints: Map<string, Pt[]>;
}

export interface Group extends Base {
  kind: "group" | "graph";
  children: Item[];
  defaults: Record<string, Record<string, string>>;
  ox: number;
  oy: number;
  labelH: number;
  titleH: number;
  sideW: number;
  partStyles: Record<string, Style>;
  extraW: number;
  extraGap: Map<number, number>;
  lineExtra: Map<number, number>;
  rankShift: Map<number, number>;
  layout?: LayoutInfo;
}

export type Item = Node | Group;

export interface Edge {
  kind: "edge";
  id: string;
  src: string;
  dst: string;
  arrow: string;
  body: string;
  label?: string;
  classes: string[];
  attrs: Record<string, string>;
  scope: Group;
  style: Style;
  labelStyle: Style;
  stepStyle: Style;
  index: number;
  waypoints: Pt[];
  wpOwner?: Group;
}

export interface Bracket {
  kind: "bracket";
  id: string;
  ids: string[];
  label: string;
  classes: string[];
  attrs: Record<string, string>;
  style: Style;
}

export interface Document {
  root: Group;
  resolve?: Resolver;
  edges: Edge[];
  stylesheets: string[];
  items: Map<string, Item>;
  legend: Node[];
  legendTitle?: string;
  brackets: Bracket[];
}

const base = (id: string, parent?: Group): Base => ({
  id,
  classes: [],
  attrs: {},
  parent,
  style: {},
  subStyle: {},
  x: 0,
  y: 0,
  ax: 0,
  ay: 0,
  w: 0,
  h: 0,
});

export const newNode = (id: string, parent?: Group): Node => ({
  ...base(id, parent),
  kind: "node",
  implicit: false,
  textLines: [],
  textW: 0,
  textH: 0,
  subLines: [],
  subH: 0,
});

export const newGroup = (id: string, parent?: Group, kind: Group["kind"] = "group"): Group => ({
  ...base(id, parent),
  kind,
  children: [],
  defaults: {},
  ox: 0,
  oy: 0,
  labelH: 0,
  titleH: 0,
  sideW: 0,
  partStyles: {},
  extraW: 0,
  extraGap: new Map(),
  lineExtra: new Map(),
  rankShift: new Map(),
});

export const isGroup = (i: Item): i is Group => "children" in i;
export const cx = (b: Box): number => b.ax + b.w / 2;
export const cy = (b: Box): number => b.ay + b.h / 2;

export function ancestors(i: Item): Group[] {
  const out: Group[] = [];
  for (let p = i.parent; p; p = p.parent) out.push(p);
  return out;
}

export function* walk(g: Group): Generator<Item> {
  for (const c of g.children) {
    yield c;
    if (isGroup(c)) yield* walk(c);
  }
}

export function bump(m: Map<number, number>, key: number, by: number): void {
  m.set(key, (m.get(key) ?? 0) + by);
}
