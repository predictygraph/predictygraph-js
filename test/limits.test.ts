import assert from "node:assert/strict";
import { test } from "node:test";
import { fixedMeasurer, PdgSyntaxError, render } from "../src/index.ts";

const r = (s: string): string => render(s, { measurer: fixedMeasurer });
const nest = (n: number): string => `${Array.from({ length: n }, (_, i) => `group g${i} {`).join("\n")}\na\n${"}\n".repeat(n)}`;

test("deep nesting is a syntax error, not a stack overflow", () => {
  assert.throws(() => r(nest(5000)), PdgSyntaxError);
});

test("labels, attrs and css cannot inject markup", () => {
  const svg = r('a "<script>x</script>"\nb "B" class="x\\" onload=\\"y"\ncss { .pdg-node { fill: red" onload="x } }\na -> b');
  assert.doesNotMatch(svg, /<script|onload="/);
});

test("images only allow data:image and http(s)", () => {
  assert.throws(() => r('a "A" image="javascript:alert(1)"'));
});
