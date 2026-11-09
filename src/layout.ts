import { type Document, type Edge, type Group, type Item, isGroup, type Node, type Pt, walk } from "./model.ts";
import { mean, or, pyRound } from "./safe.ts";
import { box4, px } from "./style.ts";
import { hasTitleBand, nodePadding, textBlock, titlePosition } from "./styleutil.ts";
import { loadImage } from "./text.ts";

export const SUB_GAP = 3;

const SQUARISH = ["circle", "square"];

function sizeImage(n: Node, doc: Document): void {
  const href = n.attrs.image as string;
  const img = loadImage(doc.resolve ? doc.resolve(href, "image") : href);
  let { w: iw, h: ih } = img;
  if ("img-width" in n.attrs || "img-height" in n.attrs) {
    const tw = Math.max(0, px(n.attrs["img-width"]));
    const th = Math.max(0, px(n.attrs["img-height"]));
    if (tw && th) [iw, ih] = [tw, th];
    else if (tw) [iw, ih] = [tw, (ih * tw) / iw];
    else [iw, ih] = [(iw * th) / ih, th];
  } else {
    const s = Math.min(1, 96 / Math.max(iw, ih));
    [iw, ih] = [iw * s, ih * s];
  }
  n.image = { ...img, dw: iw, dh: ih };
}

export function sizeNode(n: Node, doc: Document): void {
  const st = n.style;
  const text = textBlock(n.label ?? n.id, st, 14);
  const sub = textBlock(n.attrs.sub, or(n.subStyle, st), 12);
  n.textLines = text.lines;
  n.subLines = sub.lines;
  n.subH = sub.lines.length ? sub.h + SUB_GAP : 0;
  n.textW = Math.max(text.w, sub.w);
  n.textH = text.h + n.subH;
  const [pt, pr, pb, pl] = nodePadding(st);
  let shape = n.attrs.shape;
  if ("image" in n.attrs) {
    sizeImage(n, doc);
    const { dw: iw, dh: ih } = n.image as NonNullable<Node["image"]>;
    shape ??= "image";
    const gap = n.textLines.length ? 4 : 0;
    const inner = Math.max(iw, n.textW);
    [n.w, n.h] = shape === "image" ? [inner, ih + gap + n.textH] : [inner + pl + pr, ih + gap + n.textH + pt + pb];
  } else {
    shape ??= "box";
    n.w = n.textW + pl + pr;
    n.h = n.textH + pt + pb;
    if (SQUARISH.includes(shape)) n.w = n.h = n.textLines.length ? Math.max(n.textW, n.textH) + Math.max(pl, pt) * 1.2 : 16;
    else if (shape === "ellipse") [n.w, n.h] = [n.w * 1.25, n.h * 1.3];
    else if (shape === "diamond") [n.w, n.h] = [n.w * 1.6, n.h * 1.7];
    else if (shape === "hexagon") n.w += n.h * 0.6;
    else if (shape === "cylinder") n.h += 12;
  }
  n.attrs.shape = shape;
  const bare = SQUARISH.includes(shape) && !n.textLines.length;
  const [minW, minH] = bare ? [0, 0] : [px(st["min-width"]), px(st["min-height"])];
  n.w = Math.max(n.w, minW, px(n.attrs.width));
  n.h = Math.max(n.h, minH, px(n.attrs.height));
  if (SQUARISH.includes(shape)) n.w = n.h = Math.max(n.w, n.h);
}

/** Ancestor-or-self of `item` that is a direct child of g. */
export function directChild(item: Item, g: Group): Item | undefined {
  let cur: Item | undefined = item;
  while (cur && cur.parent !== g) cur = cur.parent;
  return cur;
}

type Local = [Item, Item, Edge];

export function localEdges(g: Group, doc: Document): Local[] {
  const out: Local[] = [];
  for (const e of doc.edges) {
    if (e.attrs.constraint === "false") continue;
    const a = directChild(doc.items.get(e.src) as Item, g);
    const b = directChild(doc.items.get(e.dst) as Item, g);
    if (a && b && a !== b) out.push([a, b, e]);
  }
  return out;
}

const opt = (g: Group, key: string, def: string): string => g.attrs[key] ?? def;
const centered = (align: string, room: number): number => (align === "start" ? 0 : align === "end" ? room : room / 2);

/** Gap needed after child i so what sits on the edges between neighbours i and i+1 fits. */
function labelGaps(g: Group, doc: Document, horizontal: boolean): Map<number, number> {
  const index = new Map(g.children.map((k, i) => [k.id, i]));
  const need = new Map<number, number>();
  for (const e of doc.edges) {
    if (!(horizontal ? e.label : e.attrs.step)) continue;
    const a = directChild(doc.items.get(e.src) as Item, g);
    const b = directChild(doc.items.get(e.dst) as Item, g);
    if (!a || !b || a === b) continue;
    const [i, j] = [index.get(a.id) as number, index.get(b.id) as number].sort((x, y) => x - y) as [number, number];
    if (j !== i + 1) continue;
    let step = 0;
    if (e.attrs.step) {
      const s = textBlock(e.attrs.step.slice(0, 3), or(e.stepStyle, e.style), 11, true);
      step = Math.max(s.w, s.h) + 6;
    }
    const want = horizontal ? textBlock(e.label, or(e.labelStyle, e.style), 11, false).w + (step ? step + 6 : 0) + 34 : step + 14;
    need.set(i, Math.max(need.get(i) ?? 0, want));
  }
  return need;
}

function lineLayout(g: Group, doc: Document): Pt {
  const horizontal = opt(g, "layout", "row") === "row";
  const gap = px(opt(g, "gap", "24"));
  const align = opt(g, "align", "center");
  const cross = Math.max(...g.children.map((k) => (horizontal ? k.h : k.w)));
  const need = labelGaps(g, doc, horizontal);
  let pos = 0;
  let lastStep = 0;
  g.children.forEach((k, idx) => {
    if (align === "stretch") {
      if (horizontal) k.h = cross;
      else {
        const grow = cross - k.w;
        k.w = cross;
        if (isGroup(k) && opt(k, "justify", "start") === "center") k.ox += grow / 2;
      }
    }
    const off = centered(align, cross - (horizontal ? k.h : k.w));
    const step = Math.max(4, Math.max(gap, need.get(idx) ?? 0) + (g.lineExtra.get(idx) ?? 0));
    [k.x, k.y] = horizontal ? [pos, off] : [off, pos];
    pos += (horizontal ? k.w : k.h) + step;
    lastStep = step;
  });
  pos -= lastStep;
  return horizontal ? [pos, cross] : [cross, pos];
}

function gridLayout(g: Group): Pt {
  const kids = g.children;
  const n = kids.length;
  const cols =
    "rows" in g.attrs && !("cols" in g.attrs)
      ? Math.ceil(n / Number.parseInt(g.attrs.rows as string, 10))
      : Number.parseInt(opt(g, "cols", String(Math.max(1, pyRound(Math.sqrt(n))))), 10);
  const gap = px(opt(g, "gap", "24"));
  const align = opt(g, "align", "center");
  const slots = new Map<string, [number, number]>();
  const taken = new Set<string>();
  const auto: Item[] = [];
  for (const k of kids) {
    if ("row" in k.attrs && "col" in k.attrs) {
      const rc: [number, number] = [Number.parseInt(k.attrs.row as string, 10), Number.parseInt(k.attrs.col as string, 10)];
      slots.set(k.id, rc);
      taken.add(String(rc));
    } else auto.push(k);
  }
  let i = 0;
  for (const k of auto) {
    while (taken.has(String([Math.floor(i / cols), i % cols]))) i++;
    slots.set(k.id, [Math.floor(i / cols), i % cols]);
    i++;
  }
  const all = [...slots.values()];
  const nrows = Math.max(...all.map(([r]) => r)) + 1;
  const ncols = Math.max(...all.map(([, c]) => c)) + 1;
  let cw: number[];
  let rh: number[];
  if (opt(g, "uniform", "true") === "true") {
    cw = Array(ncols).fill(Math.max(...kids.map((k) => k.w)));
    rh = Array(nrows).fill(Math.max(...kids.map((k) => k.h)));
  } else {
    cw = Array(ncols).fill(0);
    rh = Array(nrows).fill(0);
    for (const k of kids) {
      const [r, c] = slots.get(k.id) as [number, number];
      cw[c] = Math.max(cw[c] as number, k.w);
      rh[r] = Math.max(rh[r] as number, k.h);
    }
  }
  const offs = (sizes: number[]): number[] => sizes.map((_, j) => sizes.slice(0, j).reduce((s, x) => s + x, 0) + gap * j);
  const [xs, ys] = [offs(cw), offs(rh)];
  for (const k of kids) {
    const [r, c] = slots.get(k.id) as [number, number];
    k.x = (xs[c] as number) + centered(align, (cw[c] as number) - k.w);
    k.y = (ys[r] as number) + ((rh[r] as number) - k.h) / 2;
  }
  return [(xs.at(-1) as number) + (cw.at(-1) as number), (ys.at(-1) as number) + (rh.at(-1) as number)];
}

function fixedLayout(g: Group): Pt {
  for (const k of g.children) {
    const [x = "0", y = "0"] = (k.attrs.at ?? "0,0").split(",");
    [k.x, k.y] = [Number(x), Number(y)];
  }
  return [Math.max(...g.children.map((k) => k.x + k.w)), Math.max(...g.children.map((k) => k.y + k.h))];
}

function radialLayout(g: Group): Pt {
  const kids = g.children;
  const center = kids.find((k) => k.id === opt(g, "center", (kids[0] as Item).id)) ?? (kids[0] as Item);
  const ring = kids.filter((k) => k !== center);
  const need = ring.reduce((s, k) => s + Math.max(k.w, k.h) + 20, 0);
  const smallest = ring.length ? Math.min(...ring.map((k) => Math.min(k.w, k.h))) : 0;
  let rAuto = Math.max(need / (2 * Math.PI), Math.max(center.w, center.h) / 2 + smallest / 2 + 36);
  const start = (px(opt(g, "start-angle", "-90"), -90) * Math.PI) / 180;
  const angles = ring.map((_, i) => start + (2 * Math.PI * i) / Math.max(1, ring.length));
  const support = (k: Item, a: number): number => (Math.abs(Math.cos(a)) * k.w) / 2 + (Math.abs(Math.sin(a)) * k.h) / 2;
  if (ring.length)
    rAuto = Math.max(rAuto, ...ring.map((k, i) => support(center, angles[i] as number) + support(k, angles[i] as number) + 24));
  const r = px(opt(g, "radius", "auto")) || rAuto;
  const pts: [Item, number, number][] = [
    ...ring.map((k, i): [Item, number, number] => [k, r * Math.cos(angles[i] as number), r * Math.sin(angles[i] as number)]),
    [center, 0, 0],
  ];
  const minx = Math.min(...pts.map(([k, x]) => x - k.w / 2));
  const miny = Math.min(...pts.map(([k, , y]) => y - k.h / 2));
  for (const [k, x, y] of pts) [k.x, k.y] = [x - k.w / 2 - minx, y - k.h / 2 - miny];
  return [Math.max(...pts.map(([k]) => k.x + k.w)), Math.max(...pts.map(([k]) => k.y + k.h))];
}

/** Cross-axis offset of `item`'s centre from the centre of `child` (its ancestor-or-self). */
function innerOff(item: Item, child: Item, horizontal: boolean): number {
  if (item === child) return 0;
  let c = horizontal ? item.y + item.h / 2 : item.x + item.w / 2;
  let cur = item.parent;
  while (cur && cur !== child) {
    c += horizontal ? cur.oy + cur.y : cur.ox + cur.x;
    cur = cur.parent;
  }
  if (!cur || !isGroup(child)) return 0;
  return c + (horizontal ? child.oy : child.ox) - (horizontal ? child.h : child.w) / 2;
}

type Adj = Map<string, [string, number][]>;
const key = (a: string, b: string): string => `${a}\u0000${b}`;
const push = <V>(m: Map<string, V[]>, k: string, v: V): void => void m.set(k, [...(m.get(k) ?? []), v]);
const isVirtual = (u: string): boolean => u.startsWith("__v");

function breakCycles(kids: Item[], edges: [string, string, number][]): [string, string, number][] {
  const succ: Adj = new Map();
  for (const [a, b, w] of edges) push(succ, a, [b, w]);
  const state = new Map<string, number>();
  const dag = new Map<string, [string, string, number]>();
  const add = (t: [string, string, number]): void => void dag.set(t.join("\u0000"), t);
  const dfs = (u: string): void => {
    state.set(u, 1);
    for (const [v, w] of succ.get(u) ?? []) {
      if (state.get(v) === 1) add([v, u, w]);
      else {
        add([u, v, w]);
        if (!state.has(v)) dfs(v);
      }
    }
    state.set(u, 2);
  };
  for (const k of kids) if (!state.has(k.id)) dfs(k.id);
  return [...dag.values()];
}

function assignRanks(kids: Item[], dag: [string, string, number][]): Map<string, number> {
  const rank = new Map<string, number>();
  for (const k of kids) if ("rank" in k.attrs) rank.set(k.id, Number.parseInt(k.attrs.rank as string, 10));
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const [a, b] of dag) {
    push(preds, b, a);
    push(succs, a, b);
  }
  const getRank = (u: string, seen: string[] = []): number => {
    const known = rank.get(u);
    if (known !== undefined) return known;
    let r = 0;
    for (const p of preds.get(u) ?? []) if (!seen.includes(p)) r = Math.max(r, getRank(p, [...seen, u]) + 1);
    rank.set(u, r);
    return r;
  };
  for (const k of kids) getRank(k.id);
  for (const k of kids) {
    const next = succs.get(k.id);
    if (!preds.get(k.id)?.length && next?.length && !("rank" in k.attrs))
      rank.set(k.id, Math.min(...next.map((s) => rank.get(s) as number)) - 1);
  }
  return rank;
}

interface Ordering {
  order: string[][];
  up: Adj;
  down: Adj;
  lo: number;
  size: Map<string, Pt>;
  vpos: Map<string, Pt>;
}

const pos0 = (layer: string[]): Map<string, number> => new Map(layer.map((u, i) => [u, i]));

function crossings(order: string[][], down: Adj): number {
  let c = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const p2 = pos0(order[i + 1] as string[]);
    const es: Pt[] = [];
    (order[i] as string[]).forEach((u, j) => {
      for (const [v] of down.get(u) ?? []) if (p2.has(v)) es.push([j, p2.get(v) as number]);
    });
    for (let x = 0; x < es.length; x++)
      for (let y = x + 1; y < es.length; y++) if (((es[x] as Pt)[0] - (es[y] as Pt)[0]) * ((es[x] as Pt)[1] - (es[y] as Pt)[1]) < 0) c++;
  }
  return c;
}

function reduceCrossings(order: string[][], up: Adj, down: Adj, idx: Map<string, number>): string[][] {
  let best = order.map((r) => [...r]);
  let bestC = crossings(order, down);
  for (let it = 0; it < 8; it++) {
    const fwd = it % 2 === 0;
    const range = fwd
      ? order.map((_, i) => i).slice(1)
      : order
          .map((_, i) => i)
          .slice(0, -1)
          .reverse();
    for (const i of range) {
      const ref = pos0(order[fwd ? i - 1 : i + 1] as string[]);
      const nb = fwd ? up : down;
      const cur = order[i] as string[];
      const bary = (u: string): number => {
        const ns = (nb.get(u) ?? []).filter(([v]) => ref.has(v)).map(([v]) => ref.get(v) as number);
        return ns.length ? mean(ns) : cur.indexOf(u);
      };
      const keyed = cur.map((u) => [u, bary(u), idx.get(u) ?? 1e9] as const);
      order[i] = keyed.sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((k) => k[0]);
    }
    const c = crossings(order, down);
    if (c < bestC) [best, bestC] = [order.map((r) => [...r]), c];
  }
  return best;
}

function weightedMedian(ns: Pt[]): number {
  ns.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const tot = ns.reduce((s, [, w]) => s + w, 0);
  const first = ns[0] as Pt;
  if (ns.length % 2 === 0 && ns.every(([, w]) => w === first[1]))
    return ((ns[ns.length / 2 - 1] as Pt)[0] + (ns[ns.length / 2] as Pt)[0]) / 2;
  let acc = 0;
  for (const [p, w] of ns) {
    acc += w;
    if (acc >= tot / 2) return p;
  }
  return first[0];
}

function medianPull(
  o: Ordering,
  pos: Map<string, number>,
  portoff: Map<string, number>,
  csz: (u: string) => number,
  nodeGap: number,
): void {
  const vgap = nodeGap / 2;
  const gap = (a: string, b: string): number => (isVirtual(a) || isVirtual(b) ? vgap : nodeGap);
  const po = (a: string, b: string): number => portoff.get(key(a, b)) ?? 0;
  for (let it = 0; it < 12; it++) {
    const idxs = o.order.map((_, i) => i);
    for (const li of it % 2 === 0 ? idxs : idxs.reverse()) {
      const layer = o.order[li] as string[];
      const want = new Map<string, number>();
      for (const u of layer) {
        const ns = [...(o.up.get(u) ?? []), ...(o.down.get(u) ?? [])].map(
          ([v, w]): Pt => [(pos.get(v) as number) + po(v, u) - po(u, v), w],
        );
        want.set(u, ns.length ? weightedMedian(ns) : (pos.get(u) as number));
      }
      const next = layer.map((u) => want.get(u) as number);
      for (let i = 1; i < layer.length; i++) {
        const [p, c] = [layer[i - 1] as string, layer[i] as string];
        next[i] = Math.max(next[i] as number, (next[i - 1] as number) + (csz(p) + csz(c)) / 2 + gap(p, c));
      }
      if (layer.length) {
        const res = layer.map((u, i) => (want.get(u) as number) - (next[i] as number)).sort((a, b) => a - b);
        const m = Math.floor(res.length / 2);
        const shift = res.length % 2 ? (res[m] as number) : ((res[m - 1] as number) + (res[m] as number)) / 2;
        for (const i of next.keys()) next[i] = (next[i] as number) + shift;
      }
      for (const [i, u] of layer.entries()) pos.set(u, next[i] as number);
    }
  }
}

/** Sugiyama-style: ranking, virtual nodes for long edges, crossing reduction, balancing. */
function layeredLayout(g: Group, doc: Document): Pt {
  const dir = opt(g, "dir", "TB").toUpperCase();
  const horizontal = dir === "LR" || dir === "RL";
  const rankGap = px(opt(g, "rank-gap", "56"));
  const nodeGap = px(opt(g, "node-gap", "28"));
  const balance = opt(g, "balance", "median");
  const kids = g.children;
  const idx = new Map(kids.map((k, i) => [k.id, i]));
  const local = localEdges(g, doc);
  const edges = local.map(([a, b, e]): [string, string, number] => [a.id, b.id, Number(e.attrs.weight ?? 1)]);
  const portoff = new Map<string, number>();
  for (const [a, b, e] of local) {
    portoff.set(key(a.id, b.id), innerOff(doc.items.get(e.src) as Item, a, horizontal));
    portoff.set(key(b.id, a.id), innerOff(doc.items.get(e.dst) as Item, b, horizontal));
  }
  const dag = breakCycles(kids, edges);
  const rank = assignRanks(kids, dag);
  const layers = new Map<number, string[]>();
  const addTo = (r: number, u: string): void => void layers.set(r, [...(layers.get(r) ?? []), u]);
  for (const k of kids) addTo(rank.get(k.id) as number, k.id);
  const size = new Map<string, Pt>(kids.map((k) => [k.id, [k.w, k.h]]));
  const adj: [string, string, number][] = [];
  const chains = new Map<string, string[]>();
  let vcount = 0;
  for (const [a, b, w] of dag) {
    const [ra, rb] = [rank.get(a) as number, rank.get(b) as number];
    if (rb - ra <= 1) {
      adj.push([a, b, w]);
      continue;
    }
    let prev = a;
    const chain: string[] = [];
    for (let r = ra + 1; r < rb; r++) {
      const vid = `__v${vcount++}`;
      addTo(r, vid);
      size.set(vid, [0, 0]);
      rank.set(vid, r);
      adj.push([prev, vid, w]);
      if (prev === a) portoff.set(key(a, vid), portoff.get(key(a, b)) ?? 0);
      chain.push(vid);
      prev = vid;
    }
    adj.push([prev, b, w]);
    portoff.set(key(b, prev), portoff.get(key(b, a)) ?? 0);
    chains.set(key(a, b), chain);
  }
  const rs = [...layers.keys()];
  const [lo, hi] = [Math.min(...rs), Math.max(...rs)];
  let order = Array.from({ length: hi - lo + 1 }, (_, i) => layers.get(lo + i) ?? []);
  const up: Adj = new Map();
  const down: Adj = new Map();
  for (const [a, b, w] of adj) {
    push(down, a, [b, w]);
    push(up, b, [a, w]);
  }
  if (opt(g, "order", "auto") !== "source") order = reduceCrossings(order, up, down, idx);

  const csz = (u: string): number => (size.get(u) as Pt)[horizontal ? 1 : 0];
  const msz = (u: string): number => (size.get(u) as Pt)[horizontal ? 0 : 1];
  const vgap = nodeGap / 2;
  const pos = new Map<string, number>();
  const widths = order.map((layer) => {
    let x = 0;
    for (const u of layer) {
      pos.set(u, x + csz(u) / 2);
      x += csz(u) + (isVirtual(u) ? vgap : nodeGap);
    }
    return layer.length ? x - nodeGap : 0;
  });
  const maxw = Math.max(...widths, 0);
  if (balance === "center" || balance === "median" || balance === "end") {
    order.forEach((layer, i) => {
      const shift = balance === "end" ? maxw - (widths[i] as number) : (maxw - (widths[i] as number)) / 2;
      for (const u of layer) pos.set(u, (pos.get(u) as number) + shift);
    });
  }
  if (balance === "median") medianPull({ order, up, down, lo, size, vpos: new Map() }, pos, portoff, csz, nodeGap);
  order.forEach((layer, ri) => {
    for (const u of layer) pos.set(u, (pos.get(u) as number) + (g.rankShift.get(ri) ?? 0));
  });

  const rankThick = order.map((layer) => Math.max(...layer.map(msz), 0));
  const extra = new Map(g.extraGap);
  for (const [a, b, e] of local) {
    if (!e.label) continue;
    const lh = px(e.style["font-size"], 11) * 1.25 * e.label.split("\n").length + 10;
    const r = Math.min(rank.get(a.id) as number, rank.get(b.id) as number) - lo;
    extra.set(r, Math.max(extra.get(r) ?? 0, lh));
  }
  let main = 0;
  const mainPos = rankThick.map((t, ri) => {
    const at = main;
    main += t + rankGap + (extra.get(ri) ?? 0);
    return at;
  });
  const totalMain = main - rankGap - (extra.get(rankThick.length - 1) ?? 0);
  const rankIndex = new Map<string, number>();
  const all = order.flat();
  const minc = all.length ? Math.min(...all.map((u) => (pos.get(u) as number) - csz(u) / 2)) : 0;
  const vpos = new Map<string, Pt>();
  order.forEach((layer, ri) => {
    for (const u of layer) {
      const c = (pos.get(u) as number) - minc;
      const m0 = (mainPos[ri] as number) + (rankThick[ri] as number) / 2;
      const m = dir === "BT" || dir === "RL" ? totalMain - m0 : m0;
      const [x, y] = horizontal ? [m, c] : [c, m];
      if (isVirtual(u)) {
        vpos.set(u, [x, y]);
        continue;
      }
      rankIndex.set(u, ri);
      const k = kids[idx.get(u) as number] as Item;
      [k.x, k.y] = [x - k.w / 2, y - k.h / 2];
    }
  });
  const crossTotal = Math.max(...order.flatMap((layer) => layer.map((u) => (pos.get(u) as number) - minc + csz(u) / 2)), 0);
  const waypoints = new Map<string, Pt[]>();
  for (const [k, chain] of chains)
    waypoints.set(
      k,
      chain.map((v) => vpos.get(v) as Pt),
    );
  g.layout = { rankIndex, waypoints };
  return horizontal ? [totalMain, crossTotal] : [crossTotal, totalMain];
}

type Algo = (g: Group, doc: Document) => Pt;
const LAYOUTS: Record<string, Algo> = {
  layered: layeredLayout,
  grid: gridLayout,
  row: lineLayout,
  column: lineLayout,
  radial: radialLayout,
  fixed: fixedLayout,
};

export function layoutGroup(g: Group, doc: Document): void {
  for (const c of g.children) isGroup(c) ? layoutGroup(c, doc) : sizeNode(c, doc);
  if (!("layout" in g.attrs)) g.attrs.layout = localEdges(g, doc).length || g.kind === "graph" ? "layered" : "row";
  const [pt, pr, pb, pl] = box4(g.style.padding, 14);
  delete g.layout;
  const algo = LAYOUTS[g.attrs.layout as string];
  if (!algo) throw new Error(`unknown layout ${JSON.stringify(g.attrs.layout)}`);
  let [cw, ch]: Pt = g.children.length ? algo(g, doc) : [40, 20];
  g.labelH = g.titleH = g.sideW = 0;
  let lw = 0;
  const pos = titlePosition(g.style);
  if (g.label && g.kind === "group" && pos === "left") {
    const t = textBlock(g.label, g.style, 12);
    g.titleH = t.h;
    g.sideW = t.h + 12;
    ch = Math.max(ch, t.w - pt - pb + 20);
  } else if (g.label && g.kind === "group") {
    const t = textBlock(g.label, g.style, 12);
    const s = textBlock(g.attrs.sub, or(g.subStyle, g.style), 11);
    g.titleH = t.h;
    lw = Math.max(t.w, s.w);
    g.labelH = t.h + (s.h ? s.h + SUB_GAP : 0) + 6 + (hasTitleBand(g.style) ? 6 : 0);
  }
  const innerW = Math.max(cw, lw) + g.extraW;
  const top = pos !== "bottom" && pos !== "left";
  g.ox = pl + g.sideW + (innerW - cw) / 2;
  g.oy = pt + (top ? g.labelH : 0);
  g.w = innerW + pl + pr + g.sideW;
  g.h = ch + pt + pb + g.labelH;
}

function absolutize(g: Group, ox: number, oy: number): void {
  [g.ax, g.ay] = [ox, oy];
  for (const c of g.children) {
    [c.ax, c.ay] = [ox + g.ox + c.x, oy + g.oy + c.y];
    if (isGroup(c)) absolutize(c, c.ax, c.ay);
  }
}

/** Move an item sideways by dx after absolutize: its own x and the absolute position of everything inside it. */
function shift(item: Item, dx: number): void {
  item.x += dx;
  const move = (i: Item): void => {
    i.ax += dx;
    if (isGroup(i)) i.children.forEach(move);
  };
  move(item);
}

/** `align-x=ID`: centre an item horizontally on another; siblings on the side it moves towards travel with it. */
function alignX(doc: Document): void {
  for (const item of [...walk(doc.root)]) {
    const ref = doc.items.get(item.attrs["align-x"] ?? "");
    const p = item.parent;
    if (!ref || ref === item || !p) continue;
    const pr = box4(p.style.padding, 14)[1];
    const [loEdge, hiEdge] = [p.ax + p.ox, p.ax + p.w - pr];
    let dx = ref.ax + ref.w / 2 - (item.ax + item.w / 2);
    if (dx > 0) {
      const block = p.children.filter((s) => s === item || s.ax >= item.ax + item.w - 1e-6);
      dx = Math.min(dx, hiEdge - Math.max(...block.map((s) => s.ax + s.w)));
      if (Math.abs(dx) > 0.01) for (const s of block) shift(s, dx);
    } else {
      const block = p.children.filter((s) => s === item || s.ax + s.w <= item.ax + 1e-6);
      dx = Math.max(dx, loEdge - Math.min(...block.map((s) => s.ax)));
      if (Math.abs(dx) > 0.01) for (const s of block) shift(s, dx);
    }
  }
}

export function layout(doc: Document): void {
  const root = doc.root;
  for (const e of doc.edges)
    if (e.wpOwner) {
      e.waypoints = [];
      delete e.wpOwner;
    }
  layoutGroup(root, doc);
  absolutize(root, 0, 0);
  alignX(doc);
  const groups = [root, ...[...walk(root)].filter(isGroup)];
  for (const g of groups) {
    const wps = g.layout?.waypoints;
    if (!wps?.size) continue;
    for (const e of doc.edges) {
      const a = directChild(doc.items.get(e.src) as Item, g);
      const b = directChild(doc.items.get(e.dst) as Item, g);
      if (!a || !b) continue;
      for (const [k, rev] of [
        [key(a.id, b.id), false],
        [key(b.id, a.id), true],
      ] as const) {
        const w = wps.get(k);
        if (!w || e.waypoints.length) continue;
        const pts = w.map(([x, y]): Pt => [g.ax + g.ox + x, g.ay + g.oy + y]);
        e.waypoints = rev ? pts.reverse() : pts;
        e.wpOwner = g;
      }
    }
  }
}
