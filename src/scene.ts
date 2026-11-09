import { BORDER_MODES, borderTracks, dashLen, drawTracks, flowTracks, seconds, shifted, type Track } from "./anim.ts";
import { type Elem, elem, type Geom, type Paint, type Scene, type Seg } from "./ir.ts";
import { SUB_GAP } from "./layout.ts";
import {
  type Box,
  cx,
  cy,
  type Document,
  type Edge,
  type Group,
  type Item,
  isGroup,
  type Node,
  type Pt,
  type Style,
  walk,
} from "./model.ts";
import { type Diagonal, diagonalFrom, flowDir, lca, type Router, routeOf } from "./route.ts";
import { or } from "./safe.ts";
import { box4, px } from "./style.ts";
import { accent, fontSize, hasTitleBand, LINE_H, nodePadding, textBlock, titlePosition } from "./styleutil.ts";

const TITLE_PAD = 6;
const ER_HEADS = ["one", "many", "zero-one", "zero-many", "one-many"];
const STEP_ROOM = 3;
const last = <T>(a: readonly T[]): T => a[a.length - 1] as T;
const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pairs = (pts: readonly Pt[]): [Pt, Pt][] => pts.slice(1).map((p, i) => [pts[i] as Pt, p]);
const polyLen = (pts: readonly Pt[]): number => pairs(pts).reduce((s, [a, b]) => s + dist(a, b), 0);
const cls = (first: string, rest: string[] = []): string => [first, ...rest].join(" ");
const g = (o: Geom, p: Paint = {}, k: Elem["kind"] = "rect", extra: Partial<Elem> = {}): Elem => elem(k, { geom: o, paint: p, ...extra });
const fmtG = (n: number): string => String(Number.parseFloat(n.toPrecision(6)));
const fixed = (n: number, d: number): string => n.toFixed(d);

export function pointAlong(poly: Pt[], frac: number): Pt {
  const lens = pairs(poly).map(([a, b]) => dist(a, b));
  const goal = lens.reduce((s, x) => s + x, 0) * frac;
  let acc = 0;
  for (const [i, [a, b]] of pairs(poly).entries()) {
    const seg = lens[i] as number;
    if (seg && acc + seg >= goal) {
      const t = (goal - acc) / seg;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acc += seg;
  }
  return last(poly);
}

export function cornerRadius(st: Style, shape: string, _w: number, h: number): number {
  if (shape === "pill") return h / 2;
  const r = px(st["border-radius"]);
  return shape === "round" ? Math.max(r, 10) : r;
}

/** Strip down one side of a rounded box; the outer edge follows the corner arcs, the inner one is straight. */
export function accentSegs(x: number, y: number, w: number, h: number, bwIn: number, rIn: number, side: string): Seg[] {
  const bw = Math.min(bwIn, w / 2);
  const r = Math.min(rIn, h / 2);
  let segs: Seg[];
  if (r <= 0)
    segs = [
      ["M", 0, 0],
      ["L", bw, 0],
      ["L", bw, h],
      ["L", 0, h],
    ];
  else if (bw < r) {
    const dy = r - Math.sqrt(r * r - (r - bw) ** 2);
    segs = [
      ["M", 0, r],
      ["A", r, r, 0, 0, 1, bw, dy],
      ["L", bw, h - dy],
      ["A", r, r, 0, 0, 1, 0, h - r],
    ];
  } else
    segs = [
      ["M", 0, r],
      ["A", r, r, 0, 0, 1, r, 0],
      ["L", bw, 0],
      ["L", bw, h],
      ["L", r, h],
      ["A", r, r, 0, 0, 1, 0, h - r],
    ];
  segs.push(["Z"]);
  const flip = side !== "left";
  return segs.map((s): Seg => {
    if (s[0] === "Z") return s;
    const [k, ...n] = s as [string, ...number[]];
    const X = (v: number): number => x + (flip ? w - v : v);
    if (k === "A")
      return [
        "A",
        n[0] as number,
        n[1] as number,
        n[2] as number,
        n[3] as number,
        flip ? 1 - (n[4] as number) : (n[4] as number),
        X(n[5] as number),
        y + (n[6] as number),
      ];
    return [k, X(n[0] as number), y + (n[1] as number)];
  });
}

const textPaint = (st: Style, fs: number): Paint => ({
  fill: st.color ?? "#111827",
  "font-family": st["font-family"] ?? "sans-serif",
  "font-size": fs,
  "font-weight": st["font-weight"] ?? "normal",
  "font-style": st["font-style"] ?? "normal",
});

export function textElems(lines: string[], x: number, top: number, fs: number, st: Style, anchor = "middle"): Elem[] {
  const lh = fs * LINE_H;
  return lines.map((text, i) => elem("text", { geom: { x, y: top + lh * i + fs * 0.95, text, anchor }, paint: textPaint(st, fs) }));
}

function polyElem(tag: Elem["kind"], points: Pt[], paint: Paint, c?: string): Elem {
  return elem(tag, { geom: { points }, paint, ...(c ? { cls: c } : {}) });
}

function head(kind: string, tip: Pt, d: Pt, hl: number, color: string, width: number, bg: string): Elem {
  const [tx, ty] = tip;
  const [ux, uy] = d;
  const [nx, ny] = [-uy, ux];
  const hw = Math.max(hl * 0.42, width * 1.2);
  const P = (a: number, b: number): Pt => [tx - ux * a + nx * b, ty - uy * a + ny * b];
  const line: Paint = { fill: "none", stroke: color, "stroke-width": Math.max(1.2, width) };
  const bar = (a: number): Elem => polyElem("polyline", [P(a, hw), P(a, -hw)], line);
  const crow = polyElem("polyline", [P(0, hw), P(hl, 0), P(0, -hw)], line);
  const ringAt = P(hl * 1.5, 0);
  const ring = elem("circle", { geom: { cx: ringAt[0], cy: ringAt[1], r: hw * 0.6 }, paint: { ...line, fill: bg } });
  const er: Record<string, Elem[]> = {
    one: [bar(hl * 0.5), bar(hl * 0.9)],
    many: [crow],
    "zero-one": [bar(hl * 0.5), ring],
    "zero-many": [crow, ring],
    "one-many": [crow, bar(hl * 1.3)],
  };
  if (ER_HEADS.includes(kind)) return elem("group", { cls: "pdg-head", children: er[kind] as Elem[] });
  if (kind === "dot") {
    const c = P(hl / 2.2, 0);
    return elem("circle", { cls: "pdg-head", geom: { cx: c[0], cy: c[1], r: hl / 2.2 }, paint: { fill: color } });
  }
  if (kind === "open") return polyElem("polyline", [P(hl, hw), P(0, 0), P(hl, -hw)], { ...line, "stroke-linejoin": "miter" }, "pdg-head");
  if (kind === "diamond") return polyElem("polygon", [P(0, 0), P(hl / 2, hw), P(hl, 0), P(hl / 2, -hw)], { fill: color }, "pdg-head");
  if (kind === "bar") return polyElem("polyline", [P(0, hw), P(0, -hw)], { ...line, "stroke-width": Math.max(2, width) }, "pdg-head");
  return polyElem("polygon", [P(0, 0), P(hl, hw), P(hl, -hw)], { fill: color }, "pdg-head");
}

export class SceneBuilder {
  edgePolys: Map<string, Pt[]> = new Map();
  titleNeeds: Map<string, number> = new Map();
  titleLayer: Elem = elem("group", { cls: "pdg-titles" });
  root: Group;
  readonly doc: Document;
  readonly router: Router;

  constructor(doc: Document, router: Router) {
    this.doc = doc;
    this.router = router;
    this.root = doc.root;
  }

  private bg = (): string => this.root.style.background ?? "#ffffff";

  build(): Scene {
    const root = this.root;
    const edges = elem("group", { cls: "pdg-edges", children: this.doc.edges.map((e) => this.edge(e)) });
    const groups = elem("group", { cls: "pdg-groups", children: root.children.filter(isGroup).map((c) => this.group(c)) });
    const nodes = elem("group", {
      cls: "pdg-nodes",
      children: [...walk(root)].filter((c): c is Node => !isGroup(c)).map((c) => this.node(c)),
    });
    const layers = [groups, edges, nodes];
    const grid = this.grid();
    if (grid) layers.unshift(grid);
    if (this.titleLayer.children.length) layers.push(this.titleLayer);
    let [w, h] = [root.w, root.h];
    if (this.doc.brackets.length) {
      const [br, bw] = this.brackets(w);
      layers.push(br);
      w += bw;
    }
    const legend = this.legend(h);
    if (legend) {
      layers.push(legend.layer);
      [w, h] = [Math.max(w, legend.w), h + legend.h];
    }
    const cap = root.attrs.caption;
    if (cap) {
      const st = or(root.partStyles.caption ?? {}, root.style);
      const fs = fontSize(st, 12);
      const t = textBlock(cap, st, 12);
      w = Math.max(w, t.w + 28);
      const align = st["text-align"] ?? "center";
      const [x, anchor] = align === "left" ? [14, "start"] : align === "right" ? [w - 14, "end"] : [w / 2, "middle"];
      layers.push(elem("group", { cls: "pdg-caption", children: textElems(t.lines, x as number, h, fs, st, anchor as string) }));
      h += t.h + 14;
    }
    return { width: w, height: h, ...(root.style.background ? { background: root.style.background } : {}), layers };
  }

  /** `bracket a, b "note"`: curly bracket right of the diagram; overlapping brackets stack outward. */
  private brackets(right: number): [Elem, number] {
    const out = elem("group", { cls: "pdg-brackets" });
    const depth = 8;
    const spans = this.doc.brackets.map((b) => {
      const items = b.ids.map((i) => this.doc.items.get(i) as Item);
      const y0 = Math.min(...items.map((i) => i.ay));
      const y1 = Math.max(...items.map((i) => i.ay + i.h));
      return { y0, y1, b, t: textBlock(b.label, b.style, 11) };
    });
    spans.sort((a, b) => a.y1 - a.y0 - (b.y1 - b.y0));
    const cols: [number, number][][] = [];
    const colW: number[] = [];
    const placed = spans.map((s) => {
      let col = 0;
      while (col < cols.length && (cols[col] as [number, number][]).some(([a, z]) => !(s.y1 < a || s.y0 > z))) col++;
      if (col === cols.length) {
        cols.push([]);
        colW.push(0);
      }
      (cols[col] as [number, number][]).push([s.y0, s.y1]);
      colW[col] = Math.max(colW[col] as number, 2 * depth + 6 + s.t.w + 14);
      return { col, ...s };
    });
    for (const { col, y0, y1, b, t } of placed) {
      const st = b.style;
      const x = right + 4 + colW.slice(0, col).reduce((a, c) => a + c, 0);
      const ym = (y0 + y1) / 2;
      const q = Math.min(depth, (y1 - y0) / 4);
      const segs: Seg[] = [
        ["M", x, y0],
        ["Q", x + depth, y0, x + depth, y0 + q],
        ["L", x + depth, ym - q],
        ["Q", x + depth, ym, x + 2 * depth, ym],
        ["Q", x + depth, ym, x + depth, ym + q],
        ["L", x + depth, y1 - q],
        ["Q", x + depth, y1, x, y1],
      ];
      const line = g(
        { segs },
        { fill: "none", stroke: st.stroke ?? "#9ca3af", "stroke-width": px(st["stroke-width"], 1.5), "stroke-linecap": "round" },
        "path",
        { cls: "pdg-bracket-line" },
      );
      const kids = [line, ...textElems(t.lines, x + 2 * depth + 6, ym - t.h / 2, fontSize(st, 11), st, "start")];
      out.children.push(elem("group", { cls: cls("pdg-bracket", b.classes), children: kids }));
    }
    return [out, 4 + colW.reduce((a, c) => a + c, 0)];
  }

  private legend(top: number): { layer: Elem; w: number; h: number } | undefined {
    const entries = this.doc.legend;
    if (!entries.length) return undefined;
    const st: Style = { "font-family": this.root.style["font-family"] ?? "sans-serif", ...this.root.partStyles.legend };
    const fs = fontSize(st, 11);
    const [sw, gap, pad] = [14, 16, 10];
    const title = this.doc.legendTitle;
    const tw = textBlock(title, st, 11, true).w;
    let x = pad + (title ? tw + gap : 0);
    const rowH = Math.max(sw, fs * LINE_H);
    const y0 = top + pad;
    const ty = y0 + (rowH - fs * LINE_H) / 2;
    const kids: Elem[] = title ? textElems([title], 14 + pad, ty, fs, { ...st, "font-weight": "bold" }, "start") : [];
    for (const n of entries) {
      const ew = textBlock(n.label, st, 11, false).w;
      const ns = n.style;
      kids.push(
        g(
          { x: 14 + x, y: y0 + (rowH - sw) / 2, w: sw, h: sw, rx: Math.min(px(ns["border-radius"], 3), 4) },
          { fill: ns.fill ?? "#ffffff", stroke: ns.stroke ?? "#9ca3af", "stroke-width": 1.2 },
          "rect",
          { cls: cls("pdg-legend-swatch", n.classes) },
        ),
        ...textElems([n.label ?? ""], 14 + x + sw + 6, ty, fs, st, "start"),
      );
      x += sw + 6 + ew + gap;
    }
    const [bw, bh] = [x - gap + pad, rowH + 2 * pad];
    const box = g(
      { x: 14, y: top, w: bw, h: bh, rx: 6 },
      { fill: st.fill ?? "#ffffff", stroke: st.stroke ?? "#d1d5db", "stroke-width": 1 },
      "rect",
      { cls: "pdg-legend-box" },
    );
    return { layer: elem("group", { cls: "pdg-legend", children: [box, ...kids] }), w: bw + 28, h: bh + 14 };
  }

  private shape(n: Box, shape: string, st: Style): Elem[] {
    const { ax: x, ay: y, w, h } = n;
    const [mx, my] = [cx(n), cy(n)];
    const stroke = st.stroke ?? "none";
    const sw = px(st["stroke-width"], 1);
    const paint: Paint = { fill: st.fill ?? "#fff", stroke, "stroke-width": sw };
    if (st["stroke-dasharray"]) paint["stroke-dasharray"] = st["stroke-dasharray"];
    if (st.opacity) paint.opacity = st.opacity;
    if (st.shadow === "soft") paint.filter = "shadow";
    let el: Elem;
    if (["box", "round", "pill", "note", "square"].includes(shape)) el = g({ x, y, w, h, rx: cornerRadius(st, shape, w, h) }, paint);
    else if (shape === "circle" || shape === "ellipse") el = g({ cx: mx, cy: my, rx: w / 2, ry: h / 2 }, paint, "ellipse");
    else if (shape === "diamond")
      el = polyElem(
        "polygon",
        [
          [mx, y],
          [x + w, my],
          [mx, y + h],
          [x, my],
        ],
        paint,
      );
    else if (shape === "hexagon") {
      const k = (h / 2) * 0.6;
      el = polyElem(
        "polygon",
        [
          [x + k, y],
          [x + w - k, y],
          [x + w, my],
          [x + w - k, y + h],
          [x + k, y + h],
          [x, my],
        ],
        paint,
      );
    } else if (shape === "cylinder") {
      const e = 6;
      const body = g(
        {
          segs: [
            ["M", x, y + e],
            ["A", w / 2, e, 0, 0, 1, x + w, y + e],
            ["L", x + w, y + h - e],
            ["A", w / 2, e, 0, 0, 1, x, y + h - e],
            ["Z"],
          ],
        },
        paint,
        "path",
      );
      const lid = g(
        {
          segs: [
            ["M", x, y + e],
            ["A", w / 2, e, 0, 0, 0, x + w, y + e],
          ],
        },
        { fill: "none", stroke, "stroke-width": sw },
        "path",
      );
      return [body, lid];
    } else return [];
    const mode = st.border ?? "none";
    if (!BORDER_MODES.includes(mode) || stroke === "none") return [el];
    const dur = seconds(st["border-speed"], 1.6);
    let dash = st["stroke-dasharray"];
    if (mode === "march" && !dash) {
      dash = `${fmtG(Math.max(4, sw * 4))} ${fmtG(Math.max(3, sw * 3))}`;
      el.paint["stroke-dasharray"] = dash;
    }
    if (mode === "glow") {
      const halo = elem(el.kind, {
        cls: "pdg-border-glow",
        geom: { ...el.geom },
        paint: { fill: "none", stroke, "stroke-width": sw },
        tracks: borderTracks("glow", sw, dash, dur),
      });
      return [halo, el];
    }
    el.tracks = borderTracks(mode, sw, dash, dur);
    return [el];
  }

  private node(n: Node): Elem {
    const st = n.style;
    const shape = n.attrs.shape ?? "box";
    const out = elem("group", { id: n.id, cls: cls("pdg-node", n.classes), children: this.shape(n, shape, st) });
    out.children.push(...this.accent(n, st), ...this.cornerMarks(n, st));
    const fs = fontSize(st, 14);
    if (n.image) {
      const img = n.image;
      const gap = n.textLines.length ? 4 : 0;
      const block = img.dh + gap + n.textH;
      const iy = shape !== "image" ? n.ay + (n.h - block) / 2 : n.ay;
      out.children.push(elem("image", { geom: { x: cx(n) - img.dw / 2, y: iy, w: img.dw, h: img.dh, href: img.href } }));
      out.children.push(...textElems(n.textLines, cx(n), iy + img.dh + gap, fs, st));
    } else out.children.push(...this.nodeText(n, st, fs));
    return out;
  }

  private nodeText(n: Node, st: Style, fs: number): Elem[] {
    const align = st["text-align"] ?? "center";
    const [, pr, , pl] = nodePadding(st);
    const top = cy(n) - n.textH / 2;
    const [x, anchor] = align === "left" ? [n.ax + pl, "start"] : align === "right" ? [n.ax + n.w - pr, "end"] : [cx(n), "middle"];
    const out = textElems(n.textLines, x as number, top, fs, st, anchor);
    if (n.subLines.length) {
      const sst = or(n.subStyle, st);
      out.push(...textElems(n.subLines, x as number, top + n.textH - n.subH + SUB_GAP, fontSize(sst, 12), sst, anchor));
    }
    return out;
  }

  /** `accent-bar: 4px #22c55e`: strip along one side, clipped to the box's own rounded corners. */
  private accent(it: Item, st: Style): Elem[] {
    const a = accent(st);
    if (!a) return [];
    const r = Math.min(cornerRadius(st, it.attrs.shape ?? "box", it.w, it.h), it.h / 2);
    return [
      g({ segs: accentSegs(it.ax, it.ay, it.w, it.h, a.width, r, a.side) }, { fill: a.color ?? st.stroke ?? "#22c55e" }, "path", {
        cls: "pdg-accent",
      }),
    ];
  }

  private group(gr: Group): Elem {
    const st = gr.style;
    const pos = titlePosition(st);
    const frame: Box = pos === "above" && gr.label ? { ax: gr.ax, ay: gr.ay + gr.labelH, w: gr.w, h: gr.h - gr.labelH } : gr;
    const out = elem("group", { id: gr.id, cls: cls("pdg-group", gr.classes), children: this.shape(frame, gr.attrs.shape ?? "box", st) });
    out.children.push(...this.accent(gr, st));
    if (gr.label && pos === "left") out.children.push(this.sideTitle(gr, st));
    else if (gr.label) {
      if (hasTitleBand(st) && pos !== "above") out.children.push(this.titleBand(gr, st));
      this.topTitle(gr, st, out);
    }
    for (const c of gr.children) if (isGroup(c)) out.children.push(this.group(c));
    return out;
  }

  private titleBand(gr: Group, st: Style): Elem {
    const bh = box4(st.padding, 14)[0] + gr.labelH - 3;
    const r = Math.min(cornerRadius(st, gr.attrs.shape ?? "box", gr.w, gr.h), bh);
    const { ax, ay, w } = gr;
    const segs: Seg[] = [
      ["M", ax, ay + bh],
      ["L", ax, ay + r],
      ["A", r, r, 0, 0, 1, ax + r, ay],
      ["L", ax + w - r, ay],
      ["A", r, r, 0, 0, 1, ax + w, ay + r],
      ["L", ax + w, ay + bh],
      ["Z"],
    ];
    return g({ segs }, { fill: st["title-fill"] as string }, "path", { cls: "pdg-title-band" });
  }

  private sideTitle(gr: Group, st: Style): Elem {
    const fs = fontSize(st, 12);
    const x = gr.ax + 8 + gr.sideW / 2 + fs * 0.35;
    return elem("text", {
      geom: { x, y: cy(gr), text: (gr.label ?? "").replaceAll("\n", " "), anchor: "middle", rotate: -90 },
      paint: textPaint(st, fs),
    });
  }

  private topTitle(gr: Group, st: Style, out: Elem): void {
    const fs = fontSize(st, 12);
    const [pt, pr, pb, pl] = box4(st.padding, 14);
    const label = gr.label as string;
    const t = textBlock(label, st, 12);
    const pos = titlePosition(st);
    const [bottom, above] = [pos === "bottom", pos === "above"];
    const top = bottom ? gr.ay + gr.h - pb - gr.labelH + 6 : gr.ay + (above ? 0 : pt);
    const x0 = above ? gr.ax : this.titleX(gr, st, t.w, pl, pr, top, t.h);
    const box = [x0 - TITLE_PAD, top - 2, x0 + t.w + TITLE_PAD, top + t.h + 2] as const;
    const texts = textElems(label.split("\n"), x0, top, fs, st, "start");
    if (gr.attrs.sub && !bottom) {
      const sst = or(gr.subStyle, st);
      texts.push(...textElems(gr.attrs.sub.split("\n"), x0, top + gr.titleH + SUB_GAP, fontSize(sst, 11), sst, "start"));
    }
    const xs = this.crossings(box[1], box[3], box[0], box[2]);
    if (!xs.length) {
      out.children.push(...texts);
      return;
    }
    this.titleNeeds.set(gr.id, 2 * Math.max(box[2] + 2 - Math.min(...xs), 0) + 4);
    let fill = st.fill ?? "none";
    if (fill === "none" || fill === "transparent") fill = this.bg();
    const patch = g({ x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1], rx: 3 }, { fill }, "rect", { cls: "pdg-title-bg" });
    this.titleLayer.children.push(elem("group", { cls: "pdg-group-title", children: [patch, ...texts] }));
  }

  private titleX(gr: Group, st: Style, tw: number, pl: number, pr: number, top: number, th: number): number {
    const align = st["text-align"] ?? "left";
    const [lo, hi] = [gr.ax + pl, gr.ax + gr.w - pr - tw];
    const pref = align === "center" ? cx(gr) - tw / 2 : align === "right" ? hi : lo;
    if (hi <= lo) return lo;
    const blocked = this.crossings(top - 2, top + th + 2, gr.ax, gr.ax + gr.w).sort((a, b) => a - b);
    const hits = (c: number): boolean => blocked.some((x) => c - TITLE_PAD < x && x < c + tw + TITLE_PAD);
    if (!hits(pref)) return pref;
    const cands = [lo, hi, ...blocked.map((x) => x + TITLE_PAD + 2), ...blocked.map((x) => x - tw - TITLE_PAD - 2)];
    const ok = cands.filter((c) => lo <= c && c <= hi && !hits(c));
    return ok.length ? ok.reduce((best, c) => (Math.abs(c - pref) < Math.abs(best - pref) ? c : best)) : pref;
  }

  private crossings(y0: number, y1: number, xa: number, xb: number): number[] {
    const xs: number[] = [];
    for (const poly of this.edgePolys.values())
      for (const [[ax, ay], [bx, by]] of pairs(poly)) {
        if (ay === by || !(Math.min(ay, by) <= y1 && Math.max(ay, by) >= y0)) continue;
        for (const yy of [Math.max(y0, Math.min(ay, by)), Math.min(y1, Math.max(ay, by))]) {
          const x = ax + (bx - ax) * ((yy - ay) / (by - ay));
          if (xa <= x && x <= xb) xs.push(x);
        }
      }
    return xs;
  }

  private edge(e: Edge): Elem {
    const st = e.style;
    const R = this.router;
    const [pts0, axis] = R.geometry(e);
    const route = routeOf(e);
    const color = st.stroke ?? "#4b5563";
    let width = px(st["stroke-width"], 1.5);
    if (e.body === "thick" && !("width" in e.attrs)) width *= 2.5;
    let dash = st["stroke-dasharray"];
    if (e.body === "dashed" && !dash) dash = `${fixed(width * 3, 0)} ${fixed(width * 2.5, 0)}`;
    let arrow = e.attrs.arrow ?? (e.arrow !== "none" || !("arrow" in st) ? e.arrow : (st.arrow as string));
    if ("arrow" in st && !("arrow" in e.attrs) && e.arrow === "end") arrow = st.arrow as string;
    const pts = [...pts0];
    const hl = px(st["head-size"], Math.min(18, 6 + width * 2.2));
    const free =
      route === "straight" || flowDir(lca(this.doc.items.get(e.src) as Item, this.doc.items.get(e.dst) as Item, this.root)) === "auto";
    const endDir = (tip: Pt, prev: Pt): Pt => {
      const [dx, dy] =
        free || axis === "L" ? [tip[0] - prev[0], tip[1] - prev[1]] : axis === "v" ? [0, tip[1] - prev[1]] : [tip[0] - prev[0], 0];
      const n = Math.hypot(dx, dy) || 1;
      return [dx / n, dy / n];
    };
    const heads: [string, Pt, Pt][] = [];
    for (const [end, nb, want, key] of [
      [-1, -2, ["end", "both"], "head"],
      [0, 1, ["start", "both"], "head-start"],
    ] as const) {
      if (!want.some((w) => w === arrow)) continue;
      const kind = st[key] ?? st.head ?? "triangle";
      const tip = pts.at(end) as Pt;
      const dv = endDir(tip, pts.at(nb) as Pt);
      heads.push([kind, tip, dv]);
      if (!ER_HEADS.includes(kind)) pts[end < 0 ? pts.length + end : end] = [tip[0] - dv[0] * hl * 0.9, tip[1] - dv[1] * hl * 0.9];
    }
    let stub = "stub" in st ? px(st.stub) : undefined;
    if (stub !== undefined && heads.length) stub += hl;
    const radius = px(st.radius, route === "bend" ? 12 : 6);
    const diag: Diagonal = diagonalFrom(st, route);
    const level = R.level(e);
    let segs = R.pathSegs(pts, axis, route, radius, stub, level, diag);
    const poly = R.polyline(pts, axis, route, radius, stub, level, diag);
    this.edgePolys.set(e.id, poly);

    let flow = st.flow ?? "none";
    if (flow === "auto") flow = ({ end: "forward", start: "reverse", both: "both" } as Record<string, string>)[arrow] ?? "forward";
    const flowing = ["forward", "reverse", "both"].includes(flow);
    let klass = cls("pdg-edge", e.classes);
    if (flowing) klass += ` pdg-flow pdg-flow-${flow}`;
    if (flow === "draw") klass += " pdg-draw";
    const out = elem("group", { id: e.id, cls: klass });
    const base: Paint = { fill: "none", stroke: color, "stroke-linejoin": "round" };
    const line = (paint: Paint, extra: Partial<Elem> = {}, c = "pdg-line"): Elem =>
      g({ segs }, { ...base, ...paint }, "path", { cls: c, ...extra });
    const cap = heads.length ? "butt" : "round";
    if (flow === "draw") {
      const L = polyLen(poly) + 2;
      const d = `${fixed(L, 1)} ${fixed(L, 1)}`;
      out.children.push(
        line(
          { "stroke-width": width, "stroke-linecap": cap, "stroke-dasharray": d },
          { tracks: drawTracks(L, seconds(st["flow-speed"], 3)) },
        ),
      );
    } else if (!flowing)
      out.children.push(line({ "stroke-width": width, "stroke-linecap": cap, ...(dash ? { "stroke-dasharray": dash } : {}) }));
    else {
      let fdash = dash ?? `0.1 ${fmtG(Math.max(6, width * 4))}`;
      let fwidth = dash ? width : Math.max(width * 1.8, 2.5);
      const dur = seconds(st["flow-speed"], 1.2);
      if (!dash) out.children.push(line({ "stroke-width": Math.max(0.75, width * 0.5), "stroke-opacity": 0.3 }));
      const dirs = flow === "both" ? ["forward", "reverse"] : [flow];
      const ring = !dash && (st["flow-dot"] ?? "dot").trim() === "ring";
      if (ring) {
        fwidth = Math.max(fwidth, 8);
        fdash = `0.1 ${fmtG(Math.max(24, width * 10))}`;
        const rp = [...pts];
        for (const [i, j] of [
          [0, 1],
          [rp.length - 1, rp.length - 2],
        ] as const) {
          const dv = endDir(rp[i] as Pt, rp[j] as Pt);
          const p = rp[i] as Pt;
          rp[i] = [p[0] - dv[0] * fwidth, p[1] - dv[1] * fwidth];
        }
        segs = R.pathSegs(rp, axis, route, radius, stub, level, diag);
      }
      dirs.forEach((fd, k) => {
        let tracks: Track[] = flowTracks(fdash, dur, fd === "reverse");
        if (flow === "both" && k === 1) tracks = tracks.map((t) => shifted(t, dashLen(fdash) / 2));
        out.children.push(
          line({ "stroke-width": fwidth, "stroke-dasharray": fdash, "stroke-linecap": "round" }, { tracks }, `pdg-line pdg-flow-${fd}`),
        );
        if (ring)
          out.children.push(
            line(
              { stroke: this.bg(), "stroke-width": fwidth - 4, "stroke-dasharray": fdash, "stroke-linecap": "round" },
              { tracks },
              "pdg-line pdg-flow-ring",
            ),
          );
      });
    }
    for (const [kind, tip, dv] of heads) out.children.push(head(kind, tip, dv, hl, color, width, this.bg()));
    let lab: Elem[] = [];
    if (e.label) {
      lab = this.edgeLabel(e, poly);
      out.children.push(...lab);
    }
    if (e.attrs.step) out.children.push(...this.stepBadge(e, poly, e.label ? (lab[0] as Elem).geom : undefined));
    return out;
  }

  private cornerMarks(n: Item, st: Style): Elem[] {
    const k = px(st["corner-marks"]);
    if (k <= 0) return [];
    const o = 4;
    const [x0, y0, x1, y1] = [n.ax - o, n.ay - o, n.ax + n.w + o, n.ay + n.h + o];
    const segs: Seg[] = [];
    for (const [x, y, dx, dy] of [
      [x0, y0, 1, 1],
      [x1, y0, -1, 1],
      [x0, y1, 1, -1],
      [x1, y1, -1, -1],
    ] as const)
      segs.push(["M", x + dx * k, y], ["L", x, y], ["L", x, y + dy * k]);
    return [
      g({ segs }, { fill: "none", stroke: st.stroke || st["--border"] || "#888888", "stroke-width": 1 }, "path", { cls: "pdg-corners" }),
    ];
  }

  private grid(): Elem | undefined {
    const root = this.root;
    const n = px(root.attrs.grid || root.style.grid);
    if (n < 4) return undefined;
    const segs: Seg[] = [];
    for (let i = 1; i <= Math.floor(root.w / n); i++) segs.push(["M", i * n, 0], ["L", i * n, root.h]);
    for (let j = 1; j <= Math.floor(root.h / n); j++) segs.push(["M", 0, j * n], ["L", root.w, j * n]);
    const col = root.style["grid-color"] || root.style["--border"] || "#888888";
    return elem("group", {
      cls: "pdg-grid",
      children: [g({ segs }, { fill: "none", stroke: col, "stroke-width": 1, "stroke-opacity": 0.35 }, "path")],
    });
  }

  /** Numbered circle: beside the label, a third along a long edge, or beside the middle of a short one. */
  private stepBadge(e: Edge, poly: Pt[], label?: Geom): Elem[] {
    const base = or(e.stepStyle, e.style);
    const st: Style = { ...base, "font-weight": base["font-weight"] ?? "bold" };
    const fs = fontSize(st, 11);
    const txt = (e.attrs.step as string).slice(0, 3);
    const t = textBlock(txt, st, 11);
    const r = Math.max(t.w, t.h) / 2 + 3;
    const [x, y] = label ? [(label.x as number) - r - 3, (label.y as number) + (label.h as number) / 2] : this.stepSpot(poly, r);
    const circ = elem("circle", {
      cls: "pdg-step",
      geom: { cx: x, cy: y, r },
      paint: { fill: st.fill ?? "#374151", stroke: this.bg(), "stroke-width": 1.5 },
    });
    return [circ, ...textElems([txt], x, y - (fs * LINE_H) / 2, fs, st)];
  }

  private stepSpot(poly: Pt[], r: number): Pt {
    const length = polyLen(poly);
    const onLine = pointAlong(poly, 1 / 3);
    if (length >= STEP_ROOM * 2 * r && !this.onABox(onLine, r)) return onLine;
    const [mx, my] = pointAlong(poly, 1 / 2);
    let [[ax, ay], [bx, by]] = [poly[0] as Pt, last(poly)];
    let acc = 0;
    for (const [a, b] of pairs(poly)) {
      const seg = dist(a, b);
      if (acc + seg >= length / 2) {
        [[ax, ay], [bx, by]] = [a, b];
        break;
      }
      acc += seg;
    }
    const d = Math.hypot(bx - ax, by - ay) || 1;
    const [nx, ny] = [-(by - ay) / d, (bx - ax) / d];
    const off = r + 4;
    const sides: Pt[] = [
      [mx - nx * off, my - ny * off],
      [mx + nx * off, my + ny * off],
    ];
    sides.sort((p, q) => (Math.abs(by - ay) >= Math.abs(bx - ax) ? p[0] - q[0] : p[1] - q[1]));
    return sides.find((p) => !this.onABox(p, r)) ?? (sides[0] as Pt);
  }

  private onABox([x, y]: Pt, r: number): boolean {
    for (const n of walk(this.root))
      if (!isGroup(n) && n.ax - r - 2 < x && x < n.ax + n.w + r + 2 && n.ay - r - 2 < y && y < n.ay + n.h + r + 2) return true;
    return false;
  }

  private edgeLabel(e: Edge, poly: Pt[]): Elem[] {
    const st = or(e.labelStyle, e.style);
    const fs = fontSize(st, 11);
    const { w, h, lines } = textBlock(e.label, st, 11, false);
    const segs = pairs(poly);
    const lastSeg = last(segs);
    const fits = segs.length > 1 && dist(...lastSeg) >= h + 4;
    const [[ax, ay], [bx, by]] = fits ? lastSeg : segs.reduce((best, s) => (dist(s[0], s[1]) > dist(best[0], best[1]) ? s : best));
    let t = 0.5;
    const R = this.router;
    const lvl = this.doc.edges.some((o) => o !== e && o.src === e.src && R.bendLevel.get(o.id) !== undefined)
      ? R.bendLevel.get(e.id)
      : undefined;
    if (segs.length === 1 && lvl !== undefined) {
      const [a0, a1] = Math.abs(bx - ax) < Math.abs(by - ay) ? [ay, by] : [ax, bx];
      if (Math.min(a0, a1) < lvl && lvl < Math.max(a0, a1)) t = ((lvl + a1) / 2 - a0) / (a1 - a0);
    }
    const [mx, my] = [ax + (bx - ax) * t, ay + (by - ay) * t];
    const box = g(
      { x: mx - w / 2 - 3, y: my - h / 2 - 1, w: w + 6, h: h + 2, rx: 3 },
      { fill: st.background ?? this.bg(), "fill-opacity": 0.9 },
      "rect",
      { cls: "pdg-label-bg" },
    );
    return [box, ...textElems(lines, mx, my - h / 2, fs, st)];
  }
}
