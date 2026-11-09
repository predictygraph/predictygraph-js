import { clamp, number } from "./safe.ts";

export interface Measurer {
  width(text: string, family: string, size: number, bold: boolean): number;
}

export interface Block {
  w: number;
  h: number;
  lines: string[];
}

export const fixedMeasurer: Measurer = { width: (text, _family, size) => 0.6 * size * text.length };

export function canvasMeasurer(): Measurer {
  const canvas = typeof OffscreenCanvas === "undefined" ? document.createElement("canvas") : new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return fixedMeasurer;
  return {
    width(text, family, size, bold) {
      ctx.font = `${bold ? "bold " : ""}${size}px ${family}`;
      return ctx.measureText(text).width;
    },
  };
}

export const defaultMeasurer = (): Measurer => (typeof document === "undefined" ? fixedMeasurer : canvasMeasurer());

let current: Measurer = fixedMeasurer;

export function withMeasurer<T>(m: Measurer, fn: () => T): T {
  const prev = current;
  current = m;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

export function measure(text: string | undefined, family: string, size: number, bold: boolean): Block {
  const lines = text ? text.split("\n") : [];
  if (!lines.length) return { w: 0, h: 0, lines };
  const s = Number.isNaN(size) ? 14 : clamp(size, 1, 1000);
  return { w: Math.max(...lines.map((l) => current.width(l, family, s, bold))), h: s * 1.25 * lines.length, lines };
}

export interface ImageInfo {
  href: string;
  w: number;
  h: number;
  dw: number;
  dh: number;
}

const ALLOWED = /^(?:data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,]|https?:\/\/)/i;

function svgSize(text: string): [number, number] {
  const box = /viewBox\s*=\s*"\s*[^\s,"]+[\s,]+[^\s,"]+[\s,]+([^\s,"]+)[\s,]+([^\s,"]+)/.exec(text);
  const w = box ? number(box[1]) : number(/<svg[^>]*\swidth="([^"]+)/.exec(text)?.[1]);
  const h = box ? number(box[2]) : number(/<svg[^>]*\sheight="([^"]+)/.exec(text)?.[1]);
  return [w || 64, h || 64];
}

function dataText(href: string): string {
  const [head = "", body = ""] = href.split(/,(.*)/s);
  return head.includes(";base64") ? atob(body) : decodeURIComponent(body);
}

/** Only data:image and http(s) URLs; raster sizes are unknown, so they default to 64x64. */
export function loadImage(href: string): ImageInfo {
  if (!ALLOWED.test(href.trim())) throw new Error(`image ${JSON.stringify(href)} not allowed (only data:image/... and http(s) URLs)`);
  const [w, h] = href.startsWith("data:image/svg+xml") ? svgSize(dataText(href)) : [64, 64];
  return { href, w, h, dw: w, dh: h };
}
