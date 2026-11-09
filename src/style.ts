import { ancestors, type Document, type Edge, type Group, type Item, type Style, walk } from "./model.ts";
import { last, MAX_VAR_LEN, number } from "./safe.ts";
import { BUILTIN_CSS } from "./themes.gen.ts";

export const px = (v: string | undefined, def = 0): number => number(v, def);

export function box4(v: string | undefined, def = 0): [number, number, number, number] {
  if (!v) return [def, def, def, def];
  const [a = 0, b = a, c = a, d = b] = v
    .trim()
    .split(/\s+/)
    .map((x) => px(x));
  return v.trim().split(/\s+/).length === 1 ? [a, a, a, a] : [a, b, c, d];
}

interface Rule {
  parts: Part[];
  decls: Style;
  spec: [number, number, number];
  order: number;
}
type Part = { type?: string; id?: string; classes: string[] };
type Subject = { kind: string; id?: string; classes: string[] };
type Block = { prelude: string; body: string };

const SIMPLE_RE = /^([A-Za-z*][\w-]*)?((?:[#.][\w-]+)*)$/;

function parseSelector(text: string): Part[] | undefined {
  const parts: Part[] = [];
  for (const comp of text.split(/\s+/).filter(Boolean)) {
    const m = SIMPLE_RE.exec(comp);
    if (!m) return undefined;
    const part: Part = { classes: [] };
    if (m[1] && m[1] !== "*") part.type = m[1];
    for (const [, sigil, name] of (m[2] ?? "").matchAll(/([#.])([\w-]+)/g)) {
      if (sigil === "#") part.id = name as string;
      else part.classes.push(name as string);
    }
    parts.push(part);
  }
  return parts.length ? parts : undefined;
}

const specificity = (parts: Part[]): [number, number, number] => [
  parts.filter((p) => p.id).length,
  parts.reduce((s, p) => s + p.classes.length, 0),
  parts.filter((p) => p.type).length,
];

const matchSimple = (p: Part, it: Subject): boolean =>
  (!p.type || p.type === it.kind) && (!p.id || p.id === it.id) && p.classes.every((c) => it.classes.includes(c));

function matches(parts: Part[], item: Subject, anc: Subject[]): boolean {
  if (!matchSimple(last(parts), item)) return false;
  let rest = [...anc];
  for (const part of parts.slice(0, -1).reverse()) {
    const i = rest.findIndex((a) => matchSimple(part, a));
    if (i < 0) return false;
    rest = rest.slice(i + 1);
  }
  return true;
}

/** Top-level `prelude { body }` blocks of a stylesheet, comments removed, nested braces kept in the body. */
export function splitBlocks(css: string): Block[] {
  const src = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, "");
  const out: Block[] = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  let quote = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{" && depth++ === 0) open = i;
    else if (ch === "}" && depth > 0 && --depth === 0) {
      out.push({ prelude: src.slice(start, open).trim(), body: src.slice(open + 1, i) });
      start = i + 1;
    } else if (ch === ";" && depth === 0) start = i + 1;
  }
  return out;
}

function parseDecls(body: string): Style {
  const decls: Style = {};
  let depth = 0;
  let quote = "";
  let cur = "";
  const flush = (): void => {
    const i = cur.indexOf(":");
    if (i > 0) {
      const v = cur
        .slice(i + 1)
        .replace(/\s*!\s*important\s*$/i, "")
        .trim();
      decls[cur.slice(0, i).trim().toLowerCase()] = v;
    }
    cur = "";
  };
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === ";" && depth <= 0) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return decls;
}

export class StyleSheet {
  rules: Rule[] = [];
  vars: Style = {};

  add(css: string): void {
    for (const { prelude, body } of splitBlocks(css)) {
      if (prelude.startsWith("@")) continue;
      const decls = parseDecls(body);
      for (const sel of prelude.split(",").map((s) => s.trim())) {
        if (sel === ":root" || sel === "html") {
          for (const [k, v] of Object.entries(decls)) if (k.startsWith("--")) this.vars[k] = v;
          continue;
        }
        const parts = parseSelector(sel);
        if (parts) this.rules.push({ parts, decls, spec: specificity(parts), order: this.rules.length });
      }
    }
  }

  compute(item: Subject, anc: Subject[]): Style {
    const hits = this.rules.filter((r) => matches(r.parts, item, anc));
    hits.sort((a, b) => a.spec[0] - b.spec[0] || a.spec[1] - b.spec[1] || a.spec[2] - b.spec[2] || a.order - b.order);
    return Object.assign({}, ...hits.map((h) => h.decls));
  }

  resolveVars(style: Style): Style {
    const local: Style = { ...this.vars };
    for (const [k, v] of Object.entries(style)) if (k.startsWith("--")) local[k] = v;
    const re = /var\(\s*(--[\w-]+)\s*(?:,((?:[^()]|\([^()]*\))*))?\)/g;
    const sub = (v: string, depth = 0): string =>
      depth > 8 || !v.includes("var(") || v.length > MAX_VAR_LEN
        ? v.slice(0, MAX_VAR_LEN)
        : sub(
            v.replace(re, (_, name: string, fb?: string) => local[name] ?? fb?.trim() ?? ""),
            depth + 1,
          );
    return Object.fromEntries(Object.entries(style).map(([k, v]) => [k, sub(v)]));
  }
}

const BOX_KEYS = [
  "fill",
  "stroke",
  "color",
  "font-size",
  "stroke-width",
  "border-radius",
  "font-weight",
  "stroke-dasharray",
  "padding",
  "border",
  "border-speed",
  "accent-bar",
  "accent-side",
  "title-fill",
  "corner-marks",
];
const EDGE_KEYS = [
  "arrow",
  "head",
  "head-start",
  "head-size",
  "route",
  "radius",
  "stub",
  "flow",
  "flow-speed",
  "flow-dot",
  "diagonal",
  "diagonal-angle",
  "fan",
];
const INHERITED_EDGE_KEYS = EDGE_KEYS.filter((k) => k !== "flow" && k !== "head-start");
const TEXT_KEYS = ["font-family", "font-size", "color", "font-weight", "font-style", "text-align"];
const EDGE_OVERRIDES = [...EDGE_KEYS, "stroke", "color", "stroke-dasharray", "font-size"];

/** Style for a text part (`label`, `sub`, `step`, `caption`, `legend`): owner's text keys, then CSS for `kind`.
 * Subtitles drop the owner's weight; `em`/`%` font sizes are relative to the owner's. */
function partStyle(sheet: StyleSheet, kind: string, owner: Subject, anc: Subject[], inherit: Style): Style {
  const base: Style = {};
  for (const k of TEXT_KEYS) if (k in inherit && !(kind === "sub" && k === "font-weight")) base[k] = inherit[k] as string;
  const st = sheet.resolveVars({ ...base, ...sheet.compute({ kind, classes: [...owner.classes] }, [owner, ...anc]) });
  const fs = (st["font-size"] ?? "").trim();
  const rel = px(inherit["font-size"], 14);
  if (fs.endsWith("em")) st["font-size"] = `${(rel * number(fs.slice(0, -2), 1, 0.1, 10)).toFixed(2)}px`;
  else if (fs.endsWith("%")) st["font-size"] = `${((rel * number(fs.slice(0, -1), 100, 10, 1000)) / 100).toFixed(2)}px`;
  return st;
}

/** `graph steps=auto`: number every edge without its own `step=` in file order. */
function numberSteps(doc: Document): void {
  if (doc.root.attrs.steps !== "auto") return;
  let n = 0;
  for (const e of doc.edges) if (!("step" in e.attrs)) e.attrs.step = String(++n);
}

export function applyStyles(doc: Document): void {
  const sheet = new StyleSheet();
  for (const css of [BUILTIN_CSS, ...doc.stylesheets]) sheet.add(css);
  const root = doc.root;
  numberSteps(doc);
  root.style = sheet.resolveVars(sheet.compute(root, []));
  root.partStyles = Object.fromEntries(["caption", "legend"].map((k) => [k, partStyle(sheet, k, root, [], root.style)]));
  const rootFont = root.style["font-family"] ?? "sans-serif";
  for (const b of doc.brackets) b.style = sheet.resolveVars({ "font-family": rootFont, ...sheet.compute(b, [root]) });
  for (const item of [...walk(root), ...doc.legend] as Item[]) {
    const anc = ancestors(item);
    const parent = item.parent?.style ?? root.style;
    const st: Style = parent["font-family"] ? { "font-family": parent["font-family"] } : {};
    Object.assign(st, sheet.compute(item, anc));
    for (const k of BOX_KEYS) if (k in item.attrs) st[k] = item.attrs[k] as string;
    item.style = sheet.resolveVars(st);
    if ("sub" in item.attrs) item.subStyle = partStyle(sheet, "sub", item, anc, item.style);
  }
  for (const e of doc.edges) styleEdge(sheet, doc, e);
}

function styleEdge(sheet: StyleSheet, doc: Document, e: Edge): void {
  const root = doc.root;
  const ge = root.attrs;
  const anc: Group[] = e.scope !== root ? [e.scope, ...ancestors(e.scope)] : [root];
  const st: Style = { "font-family": root.style["font-family"] ?? "sans-serif", ...sheet.compute(e, anc) };
  if ("edge-width" in ge) st["stroke-width"] = ge["edge-width"] as string;
  const chain = [
    ge,
    ...anc
      .filter((g) => g !== root)
      .reverse()
      .map((g) => g.attrs),
  ];
  for (const k of INHERITED_EDGE_KEYS) for (const attrs of chain) if (k in attrs) st[k] = attrs[k] as string;
  for (const [k, v] of Object.entries(e.attrs)) {
    if (k === "width") st["stroke-width"] = v;
    else if (EDGE_OVERRIDES.includes(k)) st[k] = v;
  }
  e.style = sheet.resolveVars(st);
  e.labelStyle = partStyle(sheet, "label", e, anc, e.style);
  if ("step" in e.attrs) e.stepStyle = partStyle(sheet, "step", e, anc, e.style);
}
