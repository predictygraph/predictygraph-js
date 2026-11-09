import type { Scene } from "./ir.ts";
import { layout } from "./layout.ts";
import { bump, type Document, type Group } from "./model.ts";
import { parse } from "./parser.ts";
import { Router, straighten } from "./route.ts";
import { SceneBuilder } from "./scene.ts";
import { applyStyles } from "./style.ts";
import { type Measurer, withMeasurer } from "./text.ts";
import { themeCss } from "./theme.ts";

const MAX_PASSES = 4;

export interface BuildOptions {
  theme?: string;
  css?: string | string[];
  measurer?: Measurer;
  resolve?: (path: string, kind: "css" | "image") => string;
}

/** Lay out and route; if a channel between two ranks is too narrow for its lanes, widen that gap and go again. */
function layoutAndRoute(doc: Document): Router {
  let router = new Router(doc);
  for (let i = 0; i < MAX_PASSES * 2; i++) {
    layout(doc);
    router = new Router(doc).route();
    if (!router.needs.size) {
      if (!straighten(doc, router)) break;
      continue;
    }
    for (const [gid, rank, need] of router.needs.values())
      bump(((gid === doc.root.id ? doc.root : doc.items.get(gid)) as Group).extraGap, rank, need);
  }
  return router;
}

export function buildScene(doc: Document, opts: BuildOptions = {}): Scene {
  const theme = opts.theme ?? doc.root.attrs.theme;
  if (theme) doc.stylesheets.unshift(themeCss(theme));
  doc.stylesheets.push(...[opts.css ?? []].flat());
  applyStyles(doc);
  let scene: Scene | undefined;
  for (let i = 0; i < MAX_PASSES; i++) {
    const router = layoutAndRoute(doc);
    const builder = new SceneBuilder(doc, router);
    scene = builder.build();
    if (!builder.titleNeeds.size) break;
    for (const [gid, need] of builder.titleNeeds) (doc.items.get(gid) as Group).extraW += need;
  }
  return scene as Scene;
}

export const buildFromText = (source: string, opts: BuildOptions = {}): Scene => buildScene(parse(source, opts.resolve), opts);

export const runWith = <T>(m: Measurer | undefined, fn: () => T): T => (m ? withMeasurer(m, fn) : fn());
