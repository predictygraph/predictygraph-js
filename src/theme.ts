import { pyRound } from "./safe.ts";
import { THEMES } from "./themes.gen.ts";

export interface ThemeData {
  palette?: Record<string, string>;
  roles?: Record<string, string>;
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
function classRules(classes: Record<string, Record<string, string | number>>, pal: Record<string, string>, name: string): string[] {
  const lines: string[] = [];
  for (const [cls, spec] of Object.entries(classes)) {
    if (Object.keys(spec).some((k) => !CLASS_KEYS.has(k)))
      throw new Error(`theme ${JSON.stringify(name)}: classes.${cls} keys must be among ${[...CLASS_KEYS].sort().join(", ")}`);
    const val = Object.fromEntries(
      Object.entries(spec).map(([k, v]) => [k, typeof v === "string" && v in pal ? `var(--${v})` : String(v)]),
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
function utilityRules(pal: Record<string, string>): string[] {
  const sel = (c: string): string => `node.${c}, group.${c}, edge.${c}`;
  const out = [`${sel("fill-none")} { fill: none; }`, `${sel("stroke-none")} { stroke: none; }`];
  for (const k of Object.keys(pal)) {
    out.push(`node.fill-${k}, group.fill-${k} { fill: var(--${k}); }`);
    out.push(`${sel(`stroke-${k}`)} { stroke: var(--${k}); }`);
  }
  for (const k of Object.keys(pal)) {
    out.push(`${sel(`text-${k}`)} { color: var(--${k}); }`);
    out.push(`node.sub-${k} sub, group.sub-${k} sub { color: var(--${k}); }`);
  }
  for (const [w, v] of Object.entries(WEIGHTS)) out.push(`${sel(w)} { font-weight: ${v}; }`);
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
};
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

export function themeCss(name: string): string {
  const t = THEMES[name];
  if (!t) throw new Error(`unknown theme ${JSON.stringify(name)} (available: ${listThemes().join(", ")})`);
  const pal = resolveAliases({ ...t.palette }, name);
  const missing = REQUIRED.filter((k) => !(k in pal));
  if (missing.length) throw new Error(`theme ${JSON.stringify(name)} palette missing: ${missing.join(", ")}`);
  const at = (k: string): string => pal[k] as string;
  pal["bg-alt"] ??= mix(at("surface"), at("bg"), 0.45);
  for (const h of HUES) pal[`${h}-soft`] ??= mix(at(h), at("bg"), 0.22);
  const roles = { ...ROLE_DEFAULTS, ...t.roles };
  const shape = t.shape ?? {};
  const ref = (v: string): string => (v in pal ? `var(--${v})` : v);
  const lines = [
    ":root {",
    ...Object.entries(pal).map(([k, v]) => `  --${k}: ${v};`),
    ...Object.entries(roles).map(([k, v]) => `  --${k}: ${ref(v)};`),
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
  lines.push(...classRules(t.classes ?? {}, pal, name));
  if (t.css) lines.push(t.css);
  if (t.utilities) lines.push(...utilityRules(pal)); // last, so a utility class wins over the theme's own rules
  return `${lines.join("\n")}\n`;
}
