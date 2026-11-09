import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import type { Elem } from "../src/ir.ts";
import { isGroup, walk } from "../src/model.ts";
import { parse } from "../src/parser.ts";
import { buildScene } from "../src/pipeline.ts";
import { fixedMeasurer, withMeasurer } from "../src/text.ts";

const EXAMPLES = resolve(import.meta.dirname, "examples");
const FIX = resolve(import.meta.dirname, "fixtures");
const TOL = 0.5;

type Point = [number, number];
interface Fixture {
  width: number;
  height: number;
  items: { id: string; group: boolean; x: number; y: number; w: number; h: number }[];
  edges: Record<string, Point[]>;
}

const near = (a: number, b: number, what: string): void => assert.ok(Math.abs(a - b) <= TOL, `${what}: ${a} vs ${b}`);

const loader =
  (file: string) =>
  (p: string, kind: "css" | "image"): string => {
    const full = join(dirname(file), p);
    return kind === "css" ? readFileSync(full, "utf8") : `data:image/svg+xml;base64,${readFileSync(full).toString("base64")}`;
  };

function actual(name: string): Fixture {
  const file = join(EXAMPLES, `${name.replaceAll("__", "/")}.pdg`);
  return withMeasurer(fixedMeasurer, () => {
    const doc = parse(readFileSync(file, "utf8"), loader(file));
    const scene = buildScene(doc);
    const edges = scene.layers.find((l) => l.cls === "pdg-edges") as Elem;
    return {
      width: scene.width,
      height: scene.height,
      items: [...walk(doc.root)].map((i) => ({ id: i.id, group: isGroup(i), x: i.ax, y: i.ay, w: i.w, h: i.h })),
      edges: Object.fromEntries(
        edges.children.map((e) => [
          e.id as string,
          (e.children.find((c) => c.kind === "path")?.geom.segs ?? []).map((s) => s.slice(-2) as Point),
        ]),
      ),
    };
  });
}

for (const name of readdirSync(FIX)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))) {
  describe(`parity ${name}`, () => {
    const want = JSON.parse(readFileSync(join(FIX, `${name}.json`), "utf8")) as Fixture;
    const got = actual(name);

    it("canvas", () => {
      near(got.width, want.width, "width");
      near(got.height, want.height, "height");
    });

    it("boxes", () => {
      assert.deepEqual(
        got.items.map((i) => i.id),
        want.items.map((i) => i.id),
      );
      want.items.forEach((w, k) => {
        const g = got.items[k] as Fixture["items"][number];
        for (const f of ["x", "y", "w", "h"] as const) near(g[f], w[f], `${w.id}.${f}`);
      });
    });

    it("edges", { todo: name === "diagonal" ? "float tie in octilinear slant check vs Python" : undefined }, () => {
      assert.deepEqual(Object.keys(got.edges), Object.keys(want.edges));
      for (const [id, pts] of Object.entries(want.edges)) {
        const g = got.edges[id] as Point[];
        assert.equal(g.length, pts.length, `${id} point count`);
        pts.forEach((p, i) => {
          const q = g[i] as Point;
          near(q[0], p[0], `${id}[${i}].x`);
          near(q[1], p[1], `${id}[${i}].y`);
        });
      }
    });
  });
}
