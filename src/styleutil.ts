import type { Style } from "./model.ts";
import { box4, px } from "./style.ts";
import { type Block, measure } from "./text.ts";

const BOLD = ["bold", "bolder", "600", "700", "800", "900"];
export const LINE_H = 1.25;

export const fontSize = (st: Style, def: number): number => px(st["font-size"], def);
export const isBold = (st: Style): boolean => BOLD.includes(st["font-weight"] as string);

/** Measure `text` in style `st`; `bold` overrides the style's weight (step numbers, legend titles). */
export const textBlock = (text: string | undefined, st: Style, defFs: number, bold?: boolean): Block =>
  measure(text, st["font-family"] ?? "sans-serif", fontSize(st, defFs), bold ?? isBold(st));

export interface Accent {
  width: number;
  color?: string;
  side: string;
}

/** `accent-bar: 4px #16a34a` */
export function accent(st: Style): Accent | undefined {
  const [w, color] = (st["accent-bar"] ?? "").split(/\s+/);
  if (!w || w === "none") return undefined;
  return { width: px(w, 4), ...(color ? { color } : {}), side: st["accent-side"] ?? "left" };
}

export const accentWidth = (st: Style, side: string): number => {
  const a = accent(st);
  return a && a.side === side ? a.width : 0;
};

export function nodePadding(st: Style): [number, number, number, number] {
  const [pt, pr, pb, pl] = box4(st.padding, 8);
  return [pt, pr + accentWidth(st, "right"), pb, pl + accentWidth(st, "left")];
}

export const titlePosition = (st: Style): string => st["label-position"] ?? "top";
export const hasTitleBand = (st: Style): boolean =>
  st["title-fill"] !== undefined && st["title-fill"] !== "none" && titlePosition(st) === "top";
