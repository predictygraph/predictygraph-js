import type { Seg } from "./ir.ts";
import { directChild } from "./layout.ts";
import { bump, type Document, type Edge, type Group, type Item, isGroup, type Pt, type Style, walk } from "./model.ts";
import { copysign } from "./safe.ts";
import { px } from "./style.ts";

export const LANE = 9;
export const CLEAR = 12;
const RECT_SHAPES = ["box", "square", "round", "pill", "cylinder", "note", "image", "none"];
const ROUND_SHAPES = ["circle", "ellipse", "diamond"];

const last = <T>(a: readonly T[]): T => a[a.length - 1] as T;
const shapeOf = (n: Item): string => n.attrs.shape ?? "box";
const cxOf = (n: Item): number => n.ax + n.w / 2;
const cyOf = (n: Item): number => n.ay + n.h / 2;
export const routeOf = (e: Edge): string => e.style.route ?? "curve";
export const spread = (e: Edge): boolean => (e.style.fan ?? "").trim() === "spread";

export function ancestorsOf(i: Item): Group[] {
  const out: Group[] = [];
  for (let p = i.parent; p; p = p.parent) out.push(p);
  return out;
}

export function lca(a: Item, b: Item, root: Group): Group {
  const bb = new Set<Item>([b, ...ancestorsOf(b)]);
  return [a, ...ancestorsOf(a)].find((x): x is Group => bb.has(x) && isGroup(x)) ?? root;
}

export function flowDir(g: Group): string {
  const l = g.attrs.layout ?? "layered";
  return l === "layered" ? (g.attrs.dir ?? "TB").toUpperCase() : l === "row" ? "LR" : l === "column" ? "TB" : "auto";
}

/** Intersection of ray centre->(tx,ty) with the node outline. */
function boundaryPoint(n: Item, tx: number, ty: number, shape: string): Pt {
  const [cx, cy] = [cxOf(n), cyOf(n)];
  const [dx, dy] = [tx - cx, ty - cy];
  if (dx === 0 && dy === 0) return [cx, cy];
  const [hw, hh] = [n.w / 2, n.h / 2];
  const t =
    shape === "circle" || shape === "ellipse"
      ? 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2)
      : shape === "diamond"
        ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
        : Math.min(dx ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY, dy ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY);
  return [cx + dx * t, cy + dy * t];
}

export function port(n: Item, side: string): Pt {
  switch (side) {
    case "top":
      return [cxOf(n), n.ay];
    case "bottom":
      return [cxOf(n), n.ay + n.h];
    case "left":
      return [n.ax, cyOf(n)];
    default:
      return [n.ax + n.w, cyOf(n)];
  }
}

/** Move a port shifted along a side back onto a circle/ellipse/diamond outline. */
function onOutline(n: Item, p: Pt, vert: boolean): Pt {
  const shape = shapeOf(n);
  if (isGroup(n) || !ROUND_SHAPES.includes(shape)) return p;
  const [hw, hh] = [n.w / 2, n.h / 2];
  const [cx, cy] = [cxOf(n), cyOf(n)];
  const reach = (u: number, half: number): number => half * (shape !== "diamond" ? Math.sqrt(1 - u * u) : 1 - u);
  if (vert) return [p[0], cy + copysign(reach(Math.min(Math.abs(p[0] - cx) / hw, 1), hh), p[1] - cy)];
  return [cx + copysign(reach(Math.min(Math.abs(p[1] - cy) / hh, 1), hw), p[0] - cx), p[1]];
}

/** When may a bend/ortho jog be a slant instead of a right-angle step? */
export interface Diagonal {
  legacy: boolean;
  max: number;
  angle: number;
  early: boolean;
}

export function diagonalFrom(st: Style, route: string): Diagonal {
  const dg = (st.diagonal ?? (route === "bend" ? "40" : "0")).trim();
  return {
    legacy: dg === "legacy",
    max: dg === "none" ? 0 : dg === "always" ? 1e9 : px(dg, 40),
    angle: Math.min(80, Math.max(10, px(st["diagonal-angle"], 45))),
    early: (st.fan ?? "").trim() === "spread",
  };
}

/** Route between two ports with horizontal/vertical runs and at most one diagonal; the jog is centred on `mid` if given. */
export function octilinear(p0: Pt, p1: Pt, axis: string, mid: number | undefined, stubIn: number, diag: Diagonal): Pt[] {
  const v = axis === "v";
  const [a0, a1] = v ? [p0[1], p1[1]] : [p0[0], p1[0]];
  const [c0, c1] = v ? [p0[0], p1[0]] : [p0[1], p1[1]];
  const [main, cross] = [a1 - a0, c1 - c0];
  const sgn = main >= 0 ? 1 : -1;
  const P = (a: number, c: number): Pt => (v ? [c, a] : [a, c]);
  if (Math.abs(cross) < 0.5) return [p0, p1];
  let angle = diag.angle;
  let stub = Math.min(stubIn, Math.abs(main) / 2);
  if (mid !== undefined) stub = Math.max(2, Math.min(stub, Math.abs(mid - a0), Math.abs(a1 - mid)));
  let room = Math.abs(main) - 2 * stub;
  if (diag.early) room = Math.abs(main) - stub - Math.min(stub, 8);
  if (diag.max >= 1e9 && room > 1) angle = Math.max(angle, (Math.atan2(Math.abs(cross), room) * 180) / Math.PI);
  const dlen = Math.abs(cross) / Math.tan((angle * Math.PI) / 180);
  const centre = mid ?? (a0 + a1) / 2;
  if (Math.abs(cross) <= diag.max && dlen <= room) {
    const s = diag.early
      ? a0 + sgn * stub
      : sgn > 0
        ? Math.max(a0 + stub, Math.min(centre - dlen / 2, a1 - (stub + dlen)))
        : Math.min(a0 - stub, Math.max(centre + dlen / 2, a1 + (stub + dlen)));
    return [p0, P(s, c0), P(s + sgn * dlen, c1), p1];
  }
  const m = sgn > 0 ? Math.max(a0 + stub, Math.min(centre, a1 - stub)) : Math.min(a0 - stub, Math.max(centre, a1 + stub));
  return [p0, P(m, c0), P(m, c1), p1];
}

/** Polyline -> path segments with rounded corners (quadratic). */
export function rounded(pts: Pt[], r: number): Seg[] {
  const first = pts[0] as Pt;
  if (pts.length < 3) return [["M", ...first], ...pts.slice(1).map((p): Seg => ["L", ...p])];
  const segs: Seg[] = [["M", ...first]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [p0, p1, p2] = [pts[i - 1] as Pt, pts[i] as Pt, pts[i + 1] as Pt];
    const v1: Pt = [p1[0] - p0[0], p1[1] - p0[1]];
    const v2: Pt = [p2[0] - p1[0], p2[1] - p1[1]];
    const [l1, l2] = [Math.hypot(...v1), Math.hypot(...v2)];
    if (l1 === 0 || l2 === 0) continue;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    segs.push(
      ["L", p1[0] - (v1[0] / l1) * rr, p1[1] - (v1[1] / l1) * rr],
      ["Q", ...p1, p1[0] + (v2[0] / l2) * rr, p1[1] + (v2[1] / l2) * rr],
    );
  }
  segs.push(["L", ...(last(pts) as Pt)]);
  return segs;
}

interface Run {
  e: Edge;
  axis: string;
  level: number;
  lo: number;
  hi: number;
  c0: number;
  c1: number;
  a0: number;
  a1: number;
}

type Geo = [pts: Pt[], axis: string];
const gk = (a: string, b: number): string => `${a}\u0000${b}`;
const byNum = (a: number, b: number): number => a - b;

export class Router {
  offset: Map<string, number> = new Map();
  portShift: Map<string, number> = new Map();
  bendLevel: Map<string, number> = new Map();
  channel: Map<string, Pt> = new Map();
  gapkey: Map<string, [string, number]> = new Map();
  needs: Map<string, [string, number, number]> = new Map();

  readonly doc: Document;
  constructor(doc: Document) {
    this.doc = doc;
  }

  route(): this {
    this.parallelOffsets();
    this.spreadPorts();
    this.sharedBends();
    this.separateChannels();
    return this;
  }

  level(e: Edge): number | undefined {
    const b = this.bendLevel.get(e.id);
    if (b !== undefined) return b;
    const ch = this.channel.get(e.id);
    return ch && (ch[0] + ch[1]) / 2;
  }

  item = (id: string): Item => this.doc.items.get(id) as Item;

  /** Edges between the same two nodes get side-by-side lanes. */
  private parallelOffsets(): void {
    const pairs = new Map<string, Edge[]>();
    for (const e of this.doc.edges) {
      const k = [e.src, e.dst].sort().join("\u0000");
      pairs.set(k, [...(pairs.get(k) ?? []), e]);
    }
    for (const es of pairs.values()) for (const [i, e] of es.entries()) this.offset.set(e.id, (i - (es.length - 1) / 2) * 12);
  }

  /** Several curved/bent edges on one side of a node: spread them symmetrically, ordered by where they go. */
  private spreadPorts(): void {
    const sides = new Map<string, { node: string; list: [number, string, number, boolean][] }>();
    const saved = this.offset;
    this.offset = new Map();
    try {
      for (const e of this.doc.edges) {
        if (e.attrs.exit || e.attrs.enter) continue;
        const [pts, axis] = this.geometry(e);
        if (axis !== "v" && axis !== "h") continue;
        const [a, b] = [this.item(e.src), this.item(e.dst)];
        const sp = spread(e);
        if (flowDir(lca(a, b, this.doc.root)) === "auto" || (["straight", "ortho"].includes(routeOf(e)) && !sp)) continue;
        const i = axis === "v" ? 0 : 1;
        const [p0, pn] = [pts[0] as Pt, last(pts)];
        const ends: [number, Item, Pt, Pt][] = [
          [0, a, p0, pts.length > 2 ? (pts[1] as Pt) : pn],
          [1, b, pn, pts.length > 2 ? (pts[pts.length - 2] as Pt) : p0],
        ];
        for (const [end, node, here, there] of ends) {
          const side = axis === "v" ? (there[1] > here[1] ? "bottom" : "top") : there[0] > here[0] ? "right" : "left";
          const k = gk(node.id, side as unknown as number);
          const slot = sides.get(k) ?? { node: node.id, list: [] };
          slot.list.push([there[i] as number, e.id, end, sp]);
          sides.set(k, slot);
        }
      }
    } finally {
      this.offset = saved;
    }
    for (const [k, { node, list }] of sides) {
      if (list.length < 2) continue;
      const side = k.split("\u0000")[1] as string;
      const n = this.item(node);
      let span = side === "top" || side === "bottom" ? n.w : n.h;
      if (ROUND_SHAPES.includes(shapeOf(n)) && !isGroup(n)) span *= 0.6;
      const cap = list.every((x) => x[3]) ? span : 18;
      const step = span > 12 ? Math.min(cap, (span - 12) / (list.length - 1)) : 0;
      list.sort((x, y) => x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0) || x[2] - y[2]);
      for (const [j, [, eid, end]] of list.entries()) this.portShift.set(`${eid}:${end}`, (j - (list.length - 1) / 2) * step);
    }
  }

  /** Ortho fan-in/fan-out: edges sharing a target (or source) turn at one common level. */
  private sharedBends(): void {
    const geo = new Map<string, Geo>();
    for (const e of this.doc.edges) if (routeOf(e) === "ortho" && !spread(e)) geo.set(e.id, this.geometry(e));
    for (const key of ["dst", "src"] as const) {
      const buckets = new Map<string, Edge[]>();
      for (const e of this.doc.edges) {
        const g = geo.get(e.id);
        if (g && (g[1] === "v" || g[1] === "h") && g[0].length === 2) buckets.set(e[key], [...(buckets.get(e[key]) ?? []), e]);
      }
      for (const es of buckets.values()) {
        if (es.length < 2 || es.some((e) => this.bendLevel.has(e.id))) continue;
        const gs = es.map((e) => geo.get(e.id) as Geo);
        const i = (gs[0] as Geo)[1] === "v" ? 1 : 0;
        const hub = gs.map(([p]) => (key === "dst" ? last(p) : (p[0] as Pt))[i] as number);
        const far = gs.map(([p]) => (key === "dst" ? (p[0] as Pt) : last(p))[i] as number);
        if (new Set(hub.map(Math.round)).size !== 1 || new Set(gs.map((g) => g[1])).size !== 1) continue;
        const chans = new Set(es.map((e) => this.channel.get(e.id)).map((c) => (c ? `${c[0]},${c[1]}` : "")));
        const only = this.channel.get((es[0] as Edge).id);
        let level: number;
        if (chans.size === 1 && only) level = (only[0] + only[1]) / 2;
        else {
          const h = hub[0] as number;
          const nearest = far.reduce((best, f) => (Math.abs(f - h) < Math.abs(best - h) ? f : best));
          level = h + (nearest - h) / 2;
        }
        for (const e of es) this.bendLevel.set(e.id, level);
      }
    }
  }

  /** Distinct edges whose sideways runs overlap on one level get their own lanes; narrow channels are reported in `needs`. */
  private separateChannels(): void {
    const runs: Run[] = [];
    for (const e of this.doc.edges) {
      if (!["bend", "ortho"].includes(routeOf(e)) || e.attrs.exit || e.attrs.enter) continue;
      const [pts, axis] = this.geometry(e);
      if ((axis !== "v" && axis !== "h") || pts.length !== 2) continue;
      const [[x0, y0], [x1, y1]] = pts as [Pt, Pt];
      const v = axis === "v";
      const [a0, a1] = v ? [y0, y1] : [x0, x1];
      const [c0, c1] = v ? [x0, x1] : [y0, y1];
      if (Math.abs(c1 - c0) < 0.5) continue;
      runs.push({ e, axis, level: this.level(e) ?? (a0 + a1) / 2, lo: Math.min(c0, c1), hi: Math.max(c0, c1), c0, c1, a0, a1 });
    }
    const lanesAt = new Map<string, number>();
    for (const r of runs) {
      const k = this.gapkey.get(r.e.id);
      if (k) lanesAt.set(gk(...k), Math.max(lanesAt.get(gk(...k)) ?? 0, 1));
    }
    const look = (ed: Edge): string => JSON.stringify([ed.body, ed.style["stroke-dasharray"], ed.style.stroke, [...ed.classes].sort()]);
    runs.sort((a, b) => (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : a.level - b.level));
    const used = new Set<number>();
    runs.forEach((r, i) => {
      if (used.has(i)) return;
      const cl = [i];
      for (let j = i + 1; j < runs.length; j++) {
        const s = runs[j] as Run;
        if (used.has(j) || s.axis !== r.axis || Math.abs(s.level - r.level) > LANE) continue;
        if (cl.some((k) => Math.min(s.hi, (runs[k] as Run).hi) - Math.max(s.lo, (runs[k] as Run).lo) > 1)) cl.push(j);
      }
      if (cl.length < 2) return;
      const lanes: number[][] = [];
      for (const k of cl) {
        const ek = (runs[k] as Run).e;
        const lane = lanes.find((ln) =>
          ln.some((m) => ((runs[m] as Run).e.src === ek.src || (runs[m] as Run).e.dst === ek.dst) && look((runs[m] as Run).e) === look(ek)),
        );
        if (lane) lane.push(k);
        else lanes.push([k]);
      }
      if (lanes.length < 2) return;
      for (const k of cl) used.add(k);
      const key = (ln: number[]): number => ln.reduce((s, m) => s + (runs[m] as Run).c0 - (runs[m] as Run).c1, 0) / ln.length;
      lanes.sort((x, y) => key(x) - key(y));
      const base = cl.reduce((s, m) => s + (runs[m] as Run).level, 0) / cl.length;
      const n = lanes.length;
      lanes.forEach((ln, idx) => {
        const lvl = base + (idx - (n - 1) / 2) * LANE;
        for (const m of ln) {
          const rr = runs[m] as Run;
          const ch = this.channel.get(rr.e.id);
          let lvlC: number;
          if (ch && ch[1] - ch[0] >= 2 * CLEAR) lvlC = Math.min(Math.max(lvl, ch[0] + CLEAR), ch[1] - CLEAR);
          else {
            const [loA, hiA] = [rr.a0, rr.a1].sort(byNum) as [number, number];
            lvlC = Math.min(Math.max(lvl, loA + 4), hiA - 4);
          }
          this.bendLevel.set(rr.e.id, lvlC);
          const k = this.gapkey.get(rr.e.id);
          if (k) lanesAt.set(gk(...k), Math.max(lanesAt.get(gk(...k)) ?? 0, n));
        }
      });
    });
    for (const e of this.doc.edges) {
      const k = this.gapkey.get(e.id);
      const ch = this.channel.get(e.id);
      if (!k || !ch || !lanesAt.has(gk(...k))) continue;
      const need = ((lanesAt.get(gk(...k)) as number) - 1) * LANE + 2 * CLEAR - (ch[1] - ch[0]);
      const key = gk(...k);
      if (need > 0.5) this.needs.set(key, [k[0], k[1], Math.max(this.needs.get(key)?.[2] ?? 0, need)]);
    }
  }

  private ports(a: Item, b: Item, vert: boolean): [Pt, Pt] {
    if (vert) {
      const down = cyOf(b) > cyOf(a);
      return [port(a, down ? "bottom" : "top"), port(b, down ? "top" : "bottom")];
    }
    const right = cxOf(b) > cxOf(a);
    return [port(a, right ? "right" : "left"), port(b, right ? "left" : "right")];
  }

  /** Free band between the two outer boxes on the flow axis (where runs belong). */
  private recordChannel(e: Edge, owner: Group, da: Item, db: Item, vert: boolean): void {
    let lo: number;
    let hi: number;
    if (vert) [lo, hi] = db.ay >= da.ay + da.h ? [da.ay + da.h, db.ay] : [db.ay + db.h, da.ay];
    else [lo, hi] = db.ax >= da.ax + da.w ? [da.ax + da.w, db.ax] : [db.ax + db.w, da.ax];
    this.channel.set(e.id, [lo, hi]);
    const ri = owner.layout?.rankIndex;
    const [ra, rb] = [ri?.get(da.id), ri?.get(db.id)];
    if (ra !== undefined && rb !== undefined && Math.abs(ra - rb) === 1) this.gapkey.set(e.id, [owner.id, Math.min(ra, rb)]);
  }

  /** Leaf nodes overlapping the band between a and b, plus a and b: what a same-side C-shaped edge must go around. */
  private spanItems(a: Item, b: Item): Item[] {
    const [x0, x1] = [Math.min(a.ax, b.ax), Math.max(a.ax + a.w, b.ax + b.w)];
    const [y0, y1] = [Math.min(a.ay, b.ay), Math.max(a.ay + a.h, b.ay + b.h)];
    const out = [a, b];
    for (const it of walk(this.doc.root))
      if (!isGroup(it) && it !== a && it !== b && it.ay < y1 && it.ay + it.h > y0 && it.ax < x1 && it.ax + it.w > x0) out.push(it);
    return out;
  }

  /** -> [points, axis]. axis: v | h (flow axis), L (explicit L port) or free. */
  geometry(e: Edge): Geo {
    const [a, b] = [this.item(e.src), this.item(e.dst)];
    const owner = lca(a, b, this.doc.root);
    const [da, db] = [directChild(a, owner) as Item, directChild(b, owner) as Item];
    const d = flowDir(owner);
    const route = routeOf(e);
    const wps = [...e.waypoints];
    const off = this.offset.get(e.id) ?? 0;
    let ex = e.attrs.exit;
    let en = e.attrs.enter;
    if (ex || en) {
      ex ||= cxOf(b) > cxOf(a) ? "right" : "left";
      en ||= cxOf(b) > cxOf(a) ? "left" : "right";
      const [p0, p1] = [port(a, ex), port(b, en)];
      const [v0, v1] = [ex === "top" || ex === "bottom", en === "top" || en === "bottom"];
      if (v0 !== v1) return [[p0, v0 ? [p0[0], p1[1]] : [p1[0], p0[1]], p1], "L"];
      if (ex === en && !wps.length) {
        const gap = e.style.stub ? px(e.style.stub, 24) : 24;
        const items = this.spanItems(a, b);
        if (ex === "left" || ex === "right") {
          const x = ex === "left" ? Math.min(...items.map((it) => it.ax)) - gap : Math.max(...items.map((it) => it.ax + it.w)) + gap;
          return [[p0, [x, p0[1]], [x, p1[1]], p1], "L"];
        }
        const y = ex === "top" ? Math.min(...items.map((it) => it.ay)) - gap : Math.max(...items.map((it) => it.ay + it.h)) + gap;
        return [[p0, [p0[0], y], [p1[0], y], p1], "L"];
      }
      return [[p0, ...wps, p1], v0 ? "v" : "h"];
    }
    if (["TB", "BT", "LR", "RL"].includes(d) && route !== "straight") {
      let vert = d === "TB" || d === "BT";
      const [k, n] = vert ? (["ay", "h"] as const) : (["ax", "w"] as const);
      const sep = da[k] + da[n] <= db[k] || db[k] + db[n] <= da[k];
      if (!sep) vert = !vert;
      else if (!wps.length) this.recordChannel(e, owner, da, db, vert);
      let [p0, p1] = this.ports(a, b, vert);
      const [s0, s1] = [this.portShift.get(`${e.id}:0`), this.portShift.get(`${e.id}:1`)];
      const spreadOn = s0 !== undefined || s1 !== undefined;
      const shiftBy = (p: Pt, s: number): Pt => (vert ? [p[0] + s, p[1]] : [p[0], p[1] + s]);
      p0 = shiftBy(p0, s0 ?? 0);
      p1 = shiftBy(p1, s1 ?? 0);
      if (spreadOn) return [[onOutline(a, p0, vert), ...wps, onOutline(b, p1, vert)], vert ? "v" : "h"];
      if (off) {
        p0 = onOutline(a, shiftBy(p0, off), vert);
        p1 = onOutline(b, shiftBy(p1, off), vert);
      }
      const boxy = [a, b].every((x) => RECT_SHAPES.includes(shapeOf(x)) || isGroup(x));
      if (!wps.length && !off && boxy) {
        const i = vert ? 0 : 1;
        const [alo, ahi] = vert ? [a.ax, a.ax + a.w] : [a.ay, a.ay + a.h];
        const [blo, bhi] = vert ? [b.ax, b.ax + b.w] : [b.ay, b.ay + b.h];
        const [lo, hi] = [Math.max(alo, blo), Math.min(ahi, bhi)];
        if (Math.abs((p0[i] as number) - (p1[i] as number)) > 0.5 && hi - lo >= 16) {
          const m = Math.min(Math.max(((p0[i] as number) + (p1[i] as number)) / 2, lo + 8), hi - 8);
          p0 = vert ? [m, p0[1]] : [p0[0], m];
          p1 = vert ? [m, p1[1]] : [p1[0], m];
        }
      }
      return [[p0, ...wps, p1], vert ? "v" : "h"];
    }
    const t0 = wps[0] ?? [cxOf(b), cyOf(b)];
    const t1 = last(wps) ?? [cxOf(a), cyOf(a)];
    const p0 = boundaryPoint(a, t0[0], t0[1], shapeOf(a));
    const p1 = boundaryPoint(b, t1[0], t1[1], shapeOf(b));
    return [[p0, ...wps, p1], Math.abs(p1[1] - p0[1]) >= Math.abs(p1[0] - p0[0]) ? "v" : "h"];
  }

  /** Corner points of the drawn path (curves: just the anchor points). */
  polyline(
    pts: Pt[],
    axis: string,
    route: string,
    radius: number,
    stub: number | undefined,
    mid: number | undefined,
    diag: Diagonal,
  ): Pt[] {
    if (axis === "L" || route === "straight" || pts.length < 2) return [...pts];
    const [first, end] = [pts[0] as Pt, last(pts)];
    if ((route === "bend" || route === "ortho") && pts.length === 2 && !diag.legacy)
      return octilinear(first, end, axis, mid, stub ?? radius * 1.5, diag);
    if (route === "bend") {
      const span = axis === "v" ? Math.abs(end[1] - first[1]) : Math.abs(end[0] - first[0]);
      const k = Math.min(stub ?? radius * 1.5, span / 2);
      const sy = copysign(k, end[1] - first[1] || 1);
      const sx = copysign(k, end[0] - first[0] || 1);
      const inner = pts.slice(1, -1);
      return axis === "v"
        ? [first, [first[0], first[1] + sy], ...inner, [end[0], end[1] - sy], end]
        : [first, [first[0] + sx, first[1]], ...inner, [end[0] - sx, end[1]], end];
    }
    if (route === "ortho") {
      const seg: Pt[] = [first];
      for (let i = 1; i < pts.length; i++) {
        const [[x0, y0], [x1, y1]] = [pts[i - 1], pts[i]] as [Pt, Pt];
        const m = mid !== undefined && pts.length === 2;
        if (axis === "v") {
          const my = m ? mid : (y0 + y1) / 2;
          seg.push([x0, my], [x1, my], [x1, y1]);
        } else {
          const mx = m ? mid : (x0 + x1) / 2;
          seg.push([mx, y0], [mx, y1], [x1, y1]);
        }
      }
      const out: Pt[] = [];
      for (const [i, p] of seg.entries()) {
        const prev = last(out);
        const kept = i === 0 || Math.abs(p[0] - (seg[i - 1] as Pt)[0]) > 0.05 || Math.abs(p[1] - (seg[i - 1] as Pt)[1]) > 0.05;
        if (kept && (!prev || Math.abs(p[0] - prev[0]) > 0.05 || Math.abs(p[1] - prev[1]) > 0.05)) out.push(p);
      }
      return out;
    }
    return [...pts];
  }

  pathSegs(
    pts: Pt[],
    axis: string,
    route: string,
    radius: number,
    stub: number | undefined,
    mid: number | undefined,
    diag: Diagonal,
  ): Seg[] {
    if (axis === "L") return rounded([...pts], Math.max(radius, 8));
    if (route === "straight" || pts.length < 2) return rounded([...pts], 0);
    if (route === "bend" || route === "ortho") return rounded(this.polyline(pts, axis, route, radius, stub, mid, diag), radius);
    const segs: Seg[] = [["M", ...(pts[0] as Pt)]];
    for (let i = 1; i < pts.length; i++) {
      const [[x0, y0], [x1, y1]] = [pts[i - 1], pts[i]] as [Pt, Pt];
      if (axis === "v") segs.push(["C", x0, y0 + (y1 - y0) / 2, x1, y1 - (y1 - y0) / 2, x1, y1]);
      else segs.push(["C", x0 + (x1 - x0) / 2, y0, x1 - (x1 - x0) / 2, y1, x1, y1]);
    }
    return segs;
  }
}

const STRAIGHT_TOL = 24;

/** `fan=spread`: snap each source's near-level branch straight on the next layout pass. */
export function straighten(doc: Document, router: Router): boolean {
  const best = new Map<string, [number, Edge, boolean]>();
  for (const e of doc.edges) {
    const [pts, axis] = router.geometry(e);
    if (!spread(e) || (axis !== "v" && axis !== "h")) continue;
    const i = axis === "h" ? 1 : 0;
    const d = (last(pts)[i] as number) - ((pts[0] as Pt)[i] as number);
    if (Math.abs(d) < STRAIGHT_TOL && Math.abs(d) < Math.abs(best.get(e.src)?.[0] ?? STRAIGHT_TOL)) best.set(e.src, [d, e, i === 1]);
  }
  const src = (t: [number, Edge, boolean]): Item => doc.items.get(t[1].src) as Item;
  const sorted = [...best.values()].sort((a, b) => src(a).ay - src(b).ay || src(a).ax - src(b).ax);
  const groups = new Map<string, [number, Edge, boolean][]>();
  for (const t of sorted) groups.set((src(t).parent as Group).id, [...(groups.get((src(t).parent as Group).id) ?? []), t]);
  let changed = false;
  for (const lst of groups.values()) {
    const [ref, e, horiz] = lst[0] as [number, Edge, boolean];
    const g = src(lst[0] as [number, Edge, boolean]).parent as Group;
    if (g.attrs.layout === (horiz ? "column" : "row"))
      for (const [d, o] of lst.slice(1)) {
        const k = g.children.indexOf(doc.items.get(o.src) as Item);
        if (k && Math.abs(d - ref) > 0.05) {
          bump(g.lineExtra, k - 1, d - ref);
          changed = true;
        }
      }
    const top = lca(doc.items.get(e.src) as Item, doc.items.get(e.dst) as Item, doc.root);
    const tgt = directChild(doc.items.get(e.dst) as Item, top);
    const ri = tgt && top.layout?.rankIndex.get(tgt.id);
    if (Math.abs(ref) > 0.05 && ri !== undefined) {
      bump(top.rankShift, ri, -ref);
      changed = true;
    }
  }
  return changed;
}
