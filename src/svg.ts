import { trackAt } from "./anim.ts";
import { type Elem, effects, type Scene, type Seg } from "./ir.ts";
import { pyRound } from "./safe.ts";

const SHADOW =
  '<filter id="pdg-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.18"/></filter>';
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c] as string);

export function num(v: number | string): string {
  if (typeof v === "string") return v;
  const s = v.toFixed(2).replace(/\.?0+$/, "");
  return s === "" || s === "-0" ? "0" : s;
}

const pathD = (segs: Seg[]): string => segs.map(([k, ...n]) => (n.length ? `${k} ${n.map(num).join(" ")}` : k)).join(" ");
const attrs = (a: Record<string, string | number>): string =>
  Object.entries(a)
    .map(([k, v]) => `${k}="${esc(String(v))}"`)
    .join(" ");
const norm = (g: Record<string, number | string | undefined>, keys: Record<string, string>): Record<string, string | number> =>
  Object.fromEntries(Object.entries(keys).map(([out, k]) => [out, num(g[k] as number | string)]));

const SHAPE_ATTRS: Record<string, Record<string, string>> = {
  ellipse: { cx: "cx", cy: "cy", rx: "rx", ry: "ry" },
  circle: { cx: "cx", cy: "cy", r: "r" },
};

function shapeAttrs(el: Elem): Record<string, string | number> | undefined {
  const g = el.geom;
  const rec = g as Record<string, number | string | undefined>;
  switch (el.kind) {
    case "rect":
      return { ...norm(rec, { x: "x", y: "y", width: "w", height: "h" }), ...(g.rx ? { rx: num(g.rx) } : {}) };
    case "polygon":
    case "polyline":
      return { points: (g.points ?? []).map(([x, y]) => `${num(x)},${num(y)}`).join(" ") };
    case "path":
      return { d: pathD(g.segs ?? []) };
    case "image": {
      const href = g.href ?? "";
      return { ...norm(rec, { x: "x", y: "y", width: "w", height: "h" }), href, "xlink:href": href, preserveAspectRatio: "xMidYMid meet" };
    }
    default:
      return SHAPE_ATTRS[el.kind] && norm(rec, SHAPE_ATTRS[el.kind] as Record<string, string>);
  }
}

function paintAttrs(el: Elem, t?: number): Record<string, string | number> {
  const a: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(el.paint)) a[k] = k === "filter" ? `url(#pdg-${v})` : num(v);
  for (const tr of el.tracks) a[tr.attr] = num(t === undefined ? (tr.values[0] as number) : trackAt(tr, t));
  return a;
}

const smil = (el: Elem, t?: number): string =>
  t === undefined
    ? el.tracks
        .map(
          (tr) =>
            `<animate attributeName="${esc(tr.attr)}" values="${tr.values.map(num).join(";")}" dur="${num(tr.dur)}s" repeatCount="indefinite"/>`,
        )
        .join("")
    : "";

function writeElem(el: Elem, t?: number): string {
  const base: Record<string, string> = { ...(el.id ? { id: el.id } : {}), ...(el.cls ? { class: el.cls } : {}) };
  const g = el.geom;
  if (el.kind === "group")
    return `<g${Object.keys(base).length ? ` ${attrs(base)}` : ""}>\n${el.children.map((c) => writeElem(c, t)).join("\n")}\n</g>`;
  if (el.kind === "text") {
    const [x, y] = [num(g.x as number), num(g.y as number)];
    const a: Record<string, string | number> = { x, y, "text-anchor": g.anchor ?? "middle" };
    if (g.rotate) a.transform = `rotate(${num(g.rotate)} ${x} ${y})`;
    return `<text ${attrs({ ...a, ...paintAttrs(el, t), ...base })}>${esc(g.text ?? "")}</text>`;
  }
  const shape = shapeAttrs(el);
  if (!shape) return "";
  const open = `<${el.kind} ${attrs({ ...shape, ...paintAttrs(el, t), ...base })}`;
  const kids = smil(el, t);
  return kids ? `${open}>${kids}</${el.kind}>` : `${open}/>`;
}

/** t undefined: animated SMIL SVG; t seconds: frozen frame. */
export function writeSvg(s: Scene, t?: number): string {
  const head = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pyRound(s.width)}" height="${pyRound(s.height)}" viewBox="0 0 ${num(s.width)} ${num(s.height)}" class="predictygraph">`,
  ];
  if (effects(s).has("shadow")) head.push(`<defs>${SHADOW}</defs>`);
  if (s.background) head.push(`<rect x="0" y="0" width="${num(s.width)}" height="${num(s.height)}" fill="${esc(s.background)}"/>`);
  return `${[...head, ...s.layers.map((l) => writeElem(l, t)), "</svg>"].join("\n")}\n`;
}
