import { pyRound } from "./safe.ts";
import { THEMES } from "./themes.gen.ts";

export interface ThemeData {
  palette?: Record<string, string>;
  roles?: Record<string, string | string[]>;
  shape?: Record<string, string | number>;
  classes?: Record<string, Record<string, string | number>>;
  utilities?: boolean;
  css?: string;
}

/** Palette values are #rrggbb or the name of another palette entry (`edge = "ink"`). */
function resolveAliases(pal: Record<string, string>, name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v0] of Object.entries(pal)) {
    let v = v0;
    const seen = new Set([k]);
    while (v in pal && !seen.has(v)) {
      seen.add(v);
      v = pal[v] as string;
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(v))
      throw new Error(`theme ${JSON.stringify(name)}: palette.${k} must be #rrggbb or a palette name, got ${JSON.stringify(v0)}`);
    out[k] = v;
  }
  return out;
}

const CLASS_KEYS = new Set(["fill", "stroke", "color", "sub", "edge", "title-fill", "font-weight", "sub-weight"]);
const BOX_KEYS = ["fill", "stroke", "color", "title-fill", "font-weight"];

/** `[classes] lime = { fill, stroke, color, title-fill, sub, edge }` -> node/group/sub/edge rules. */
function classRules(
  classes: Record<string, Record<string, string | number>>,
  pal: Record<string, string>,
  name: string,
  roles: Record<string, string> = {},
): string[] {
  const lines: string[] = [];
  for (const [cls, spec] of Object.entries(classes)) {
    if (Object.keys(spec).some((k) => !CLASS_KEYS.has(k)))
      throw new Error(`theme ${JSON.stringify(name)}: classes.${cls} keys must be among ${[...CLASS_KEYS].sort().join(", ")}`);
    const val = Object.fromEntries(
      Object.entries(spec).map(([k, v]) => [k, typeof v === "string" && (v in pal || v in roles) ? `var(--${v})` : String(v)]),
    );
    const box = Object.fromEntries(BOX_KEYS.filter((k) => k in val).map((k) => [k, val[k] as string]));
    if ("fill" in box) box.stroke ??= box.fill as string;
    if (Object.keys(box).length)
      lines.push(
        `node.${cls}, group.${cls} { ${Object.entries(box)
          .map(([k, v]) => `${k}: ${v};`)
          .join(" ")} }`,
      );
    const SUB: [string, string][] = [
      ["color", "sub"],
      ["font-weight", "sub-weight"],
    ];
    const sub = SUB.filter(([, s]) => s in val).map(([k, s]) => `${k}: ${val[s]};`);
    if (sub.length) lines.push(`node.${cls} sub { ${sub.join(" ")} }`);
    const c = val.edge ?? val.fill;
    if (c !== undefined) lines.push(`edge.${cls} { stroke: ${c}; color: ${c}; }`);
  }
  return lines;
}

const WEIGHTS: Record<string, number> = { regular: 400, bold: 700, heavy: 900 };

/** `utilities = true`: `.fill-<name> .stroke-<name> .text-<name> .sub-<name>` per palette colour, `.fill-none .stroke-none`, `.regular .bold .heavy`. */
function utilityRules(pal: Record<string, string>, roles: Record<string, string> = {}, series: string[] = []): string[] {
  const sel = (c: string): string => `node.${c}, group.${c}, edge.${c}`;
  const out = [`${sel("fill-none")} { fill: none; }`, `${sel("stroke-none")} { stroke: none; }`];
  const names = [
    ...Object.keys(pal).filter((k) => !k.startsWith("on-")),
    ...COLOUR_ROLES.filter((r) => r in roles),
    ...series.map((_, n) => `series-${n + 1}`),
  ];
  for (const k of names) {
    out.push(`node.fill-${k}, group.fill-${k} { fill: var(--${k}); }`);
    out.push(`${sel(`stroke-${k}`)} { stroke: var(--${k}); }`);
  }
  for (const k of names) {
    out.push(`${sel(`text-${k}`)} { color: var(--${k}); }`);
    out.push(`node.sub-${k} sub, group.sub-${k} sub { color: var(--${k}); }`);
  }
  for (const [w, v] of Object.entries(WEIGHTS)) out.push(`${sel(w)} { font-weight: ${v}; }`);
  return out;
}

// Generic classes every theme gets, written against the required palette names.
const GENERIC: [string, string][] = [
  ["label", "fill: none; stroke: none; font-weight: 400; color: var(--label-text);"],
  ["plain", "font-weight: 400; color: var(--fg);"],
  ["strong", "font-weight: 700; color: var(--fg);"],
  ["quiet", "font-weight: 400; color: var(--muted);"],
  ["chip", "fill: var(--surface); stroke: none; font-weight: 400; color: var(--fg);"],
  ["card", "fill: var(--bg); stroke: var(--border);"],
  ["frame", "fill: var(--bg); stroke: var(--frame-stroke);"],
  ["outline", "fill: none;"],
  ["placeholder", "fill: var(--placeholder-fill); stroke: var(--placeholder-stroke);"],
  ["ghost", "fill: var(--bg); stroke: var(--muted); stroke-width: 1.2; stroke-dasharray: 4 3; color: var(--muted); font-weight: 400;"],
  ["band", "fill: var(--band-fill); stroke: none;"],
  ["open", "fill: none; stroke: none;"],
];
const BOXES = ["chip", "card", "frame", "placeholder", "band"];

const luminance = (hex: string): number => {
  const ch = (i: number): number => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Follow a role/palette reference to [hex, palette entry or undefined]. */
function hexOf(pal: Record<string, string>, roles: Record<string, string>, v0: string): [string, string | undefined] {
  let v = v0;
  const seen = new Set<string>();
  while (v in roles && !seen.has(v) && !(v in pal)) {
    seen.add(v);
    v = roles[v] as string;
  }
  return v in pal ? [pal[v] as string, v] : [v, undefined];
}

/** Text colour on a `name` fill (palette entry or role): palette `on-<entry>` if set, else whichever of fg/bg contrasts more (bg on a tie). */
function onColour(pal: Record<string, string>, name: string, roles: Record<string, string> = {}): string {
  const [hex, entry] = hexOf(pal, roles, name);
  if (entry && `on-${entry}` in pal) return `on-${entry}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return "fg";
  return contrast(hex, pal.fg as string) > contrast(hex, pal.bg as string) ? "fg" : "bg";
}

function genericRules(pal: Record<string, string>, roles: Record<string, string> = {}, series: string[] = []): string[] {
  const out = GENERIC.map(([c, decl]) => `node.${c}, group.${c} { ${decl} }`);
  out.push(`${BOXES.map((c) => `node.${c} sub`).join(", ")} { color: var(--muted); }`);
  const fills = [...Object.keys(pal).filter((k) => !k.startsWith("on-")), ...COLOUR_ROLES.filter((r) => r in roles)];
  for (const k of fills) {
    const t = onColour(pal, k, roles);
    out.push(`node.on-${k}, group.on-${k} { fill: var(--${k}); stroke: var(--${k}); color: var(--${t}); }`);
    out.push(`node.on-${k} sub, group.on-${k} sub { color: var(--${t}); }`);
  }
  series.forEach((c, n) => {
    const i = n + 1;
    const t = onColour(pal, c, roles);
    out.push(`node.series-${i}, group.series-${i} { fill: var(--series-${i}); stroke: var(--series-${i}); color: var(--${t}); }`);
    out.push(`node.series-${i} sub, group.series-${i} sub { color: var(--${t}); }`);
    out.push(`edge.series-${i} { stroke: var(--series-${i}); color: var(--series-${i}); }`);
  });
  return out;
}

const HUES = ["red", "orange", "yellow", "green", "cyan", "blue", "purple"];
const ROLE_DEFAULTS: Record<string, string> = {
  accent: "blue",
  danger: "red",
  "node-fill": "surface",
  "node-stroke": "border",
  "node-text": "fg",
  "group-fill": "bg-alt",
  "group-stroke": "border",
  "group-text": "muted",
  edge: "muted",
  "edge-text": "fg",
  // semantic colours: a brand theme maps them to its palette, diagrams use only these names
  highlight: "accent",
  "highlight-soft": "bg-alt",
  primary: "blue",
  secondary: "cyan",
  tertiary: "purple",
  positive: "green",
  emphasis: "fg",
  "label-text": "fg",
  "frame-stroke": "fg",
  "placeholder-fill": "surface",
  "placeholder-stroke": "border",
  "band-fill": "surface",
};
const SERIES_DEFAULT = ["blue", "green", "orange", "purple", "cyan", "red"];
const COLOUR_ROLES = ["accent", "danger", "highlight", "highlight-soft", "primary", "secondary", "tertiary", "positive", "emphasis"];
const REQUIRED = ["bg", "surface", "fg", "muted", "border", ...HUES];

export const listThemes = (): string[] => Object.keys(THEMES).sort();

const mix = (a: string, b: string, t: number): string => {
  const ch = (s: string, i: number): number => Number.parseInt(s.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) =>
      pyRound(ch(a, i) * t + ch(b, i) * (1 - t))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
};

/** The theme's roles over the defaults, and its `series` list (categorical colours). */
function themeRoles(t: ThemeData, name: string): [Record<string, string>, string[]] {
  const given: Record<string, unknown> = { ...(t.roles ?? {}) };
  const series = (given.series ?? SERIES_DEFAULT) as unknown;
  delete given.series;
  const unknown = Object.keys(given).filter((k) => !(k in ROLE_DEFAULTS));
  if (unknown.length) throw new Error(`theme ${JSON.stringify(name)}: unknown roles ${JSON.stringify(unknown.sort())}`);
  if (!Array.isArray(series) || !series.every((c) => typeof c === "string"))
    throw new Error(`theme ${JSON.stringify(name)}: roles.series must be a list of colour names`);
  return [{ ...ROLE_DEFAULTS, ...(given as Record<string, string>) }, series as string[]];
}

export function themeCss(name: string): string {
  const t = THEMES[name];
  if (!t) throw new Error(`unknown theme ${JSON.stringify(name)} (available: ${listThemes().join(", ")})`);
  const pal = resolveAliases({ ...t.palette }, name);
  const missing = REQUIRED.filter((k) => !(k in pal));
  if (missing.length) throw new Error(`theme ${JSON.stringify(name)} palette missing: ${missing.join(", ")}`);
  const at = (k: string): string => pal[k] as string;
  pal["bg-alt"] ??= mix(at("surface"), at("bg"), 0.45);
  for (const h of HUES) pal[`${h}-soft`] ??= mix(at(h), at("bg"), 0.22);
  const [roles, series] = themeRoles(t, name);
  const shape = t.shape ?? {};
  const ref = (v: string): string => (v in pal || v in roles ? `var(--${v})` : v);
  const lines = [
    ":root {",
    ...Object.entries(pal).map(([k, v]) => `  --${k}: ${v};`),
    ...Object.entries(roles).map(([k, v]) => `  --${k}: ${ref(v)};`),
    ...series.map((v, n) => `  --series-${n + 1}: ${ref(v)};`),
    "}",
  ];
  lines.push("graph { background: var(--bg); color: var(--fg); }");
  if (shape.font) lines.push(`graph { font-family: "${shape.font}", sans-serif; }`);
  lines.push(
    `node { fill: var(--node-fill); stroke: var(--node-stroke); color: var(--node-text); border-radius: ${shape.radius ?? 6}px; }`,
  );
  lines.push("group { fill: var(--group-fill); stroke: var(--group-stroke); color: var(--group-text); }");
  lines.push("edge { stroke: var(--edge); color: var(--edge-text); }");
  for (const h of [...HUES, "accent", "danger"]) {
    const role = roles[h] as string;
    const soft = HUES.includes(h) ? `var(--${h}-soft)` : HUES.includes(role) ? `var(--${role}-soft)` : "var(--surface)";
    lines.push(`node.${h}, group.${h} { fill: ${soft}; stroke: var(--${h}); }`);
    lines.push(`edge.${h} { stroke: var(--${h}); color: var(--${h}); }`);
  }
  lines.push("node.solid { fill: var(--fg); stroke: var(--fg); color: var(--bg); }");
  if (shape["edge-width"] !== undefined) lines.push(`edge { stroke-width: ${shape["edge-width"]}; }`);
  lines.push(...genericRules(pal, roles, series));
  lines.push(...classRules(t.classes ?? {}, pal, name, roles));
  if (t.css) lines.push(t.css);
  if (t.utilities) lines.push(...utilityRules(pal, roles, series)); // last, so a utility class wins over the theme's own rules
  return `${lines.join("\n")}\n`;
}
