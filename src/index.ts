import { PdgSyntaxError } from "./parser.ts";
import { type BuildOptions, buildFromText, runWith } from "./pipeline.ts";
import { writeSvg } from "./svg.ts";
import { defaultMeasurer, fixedMeasurer, type Measurer } from "./text.ts";
import { listThemes } from "./theme.ts";

export interface RenderOptions extends BuildOptions {
  t?: number;
}

export interface RunOptions {
  selector?: string;
  nodes?: Iterable<Element>;
}

export interface InitOptions extends RenderOptions {
  startOnLoad?: boolean;
}

const SELECTOR = "pre.pdg, code.language-pdg, div.pdg";
let defaults: InitOptions = {};
let measurer: Measurer | undefined;

export const initialize = (opts: InitOptions = {}): void => {
  defaults = { ...defaults, ...opts };
};

export function render(source: string, opts: RenderOptions = {}): string {
  const o = { ...defaults, ...opts };
  measurer ??= defaultMeasurer();
  return runWith(o.measurer ?? measurer, () => writeSvg(buildFromText(source, o), o.t));
}

const errorBox = (msg: string): HTMLElement => {
  const pre = document.createElement("pre");
  pre.className = "pdg-error";
  pre.style.cssText = "color:#b91c1c;white-space:pre-wrap";
  pre.textContent = msg;
  return pre;
};

export function run(opts: RunOptions = {}): void {
  const nodes = opts.nodes ?? document.querySelectorAll(opts.selector ?? SELECTOR);
  for (const el of nodes) {
    const target = el.parentElement?.tagName === "PRE" && el.tagName === "CODE" ? el.parentElement : el;
    try {
      const holder = document.createElement("div");
      holder.className = "pdg-rendered";
      holder.innerHTML = render(el.textContent ?? "");
      target.replaceWith(holder);
    } catch (e) {
      target.replaceWith(errorBox(e instanceof Error ? e.message : String(e)));
    }
  }
}

export type { Measurer };
export { fixedMeasurer, listThemes, PdgSyntaxError };

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const start = (): void => {
    if (defaults.startOnLoad !== false) run();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else setTimeout(start);
}
