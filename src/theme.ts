import { pyRound } from "./safe.ts";
import { THEMES } from "./themes.gen.ts";

export interface ThemeData {
  palette?: Record<string, string>;
  roles?: Record<string, string>;
  shape?: Record<string, string | number>;
  css?: string;
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
  const pal = { ...t.palette };
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
  if (t.css) lines.push(t.css);
  return `${lines.join("\n")}\n`;
}
