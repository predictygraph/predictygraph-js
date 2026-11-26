import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { render } from "../src/index.ts";
import { fixedMeasurer } from "../src/text.ts";

const EXAMPLES = resolve(import.meta.dirname, "examples");
const SNAPS = resolve(import.meta.dirname, "snapshots");

const files = (readdirSync(EXAMPLES, { recursive: true }) as string[]).filter((f) => f.endsWith(".pdg")).sort();

const resolver =
  (file: string) =>
  (p: string, kind: "css" | "image"): string => {
    const full = join(dirname(file), p);
    return kind === "css" ? readFileSync(full, "utf8") : `data:image/svg+xml;base64,${readFileSync(full).toString("base64")}`;
  };

describe("svg output snapshots", () => {
  for (const f of files) {
    const name = f.replaceAll("/", "__").replace(/\.pdg$/, "");
    it(name, () => {
      const file = join(EXAMPLES, f);
      const svg = render(readFileSync(file, "utf8"), { measurer: fixedMeasurer, resolve: resolver(file) });
      const snap = join(SNAPS, `${name}.svg`);
      if (process.env.UPDATE_SNAPSHOTS || !existsSync(snap)) {
        mkdirSync(SNAPS, { recursive: true });
        writeFileSync(snap, svg);
      }
      assert.equal(svg, readFileSync(snap, "utf8"));
    });
  }
});

describe("via and layer", () => {
  it("rejects a malformed via=", () => {
    assert.throws(() => render('graph layout=fixed\na "A" at=0,0\nb "B" at=99,0\na -- b via="10;x"', { measurer: fixedMeasurer }), /via/);
  });
  it("layer=back from CSS draws the node before the edges", () => {
    const svg = render(
      'graph layout=fixed\ncss { node.bg { layer: back; } }\nbg "" .bg at=0,0 width=99 height=40\na "A" at=0,60\nb "B" at=80,60\na -> b',
      {
        measurer: fixedMeasurer,
      },
    );
    assert.ok(svg.indexOf("pdg-back") < svg.indexOf("pdg-edges"));
  });
});
