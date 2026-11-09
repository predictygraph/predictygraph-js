# predictygraph-js

[![npm](https://img.shields.io/npm/v/predictygraph-js)](https://www.npmjs.com/package/predictygraph-js)
[![ci](https://github.com/predictygraph/predictygraph-js/actions/workflows/ci.yml/badge.svg)](https://github.com/predictygraph/predictygraph-js/actions/workflows/ci.yml)

Render [predictygraph](https://github.com/predictygraph/predictygraph) (`.pdg`) diagrams to SVG in the browser. A TypeScript port of the Python renderer with the same layout, routing and themes, and no runtime dependencies (27 kB gzipped).

Docs: [predictygraph.github.io](https://predictygraph.github.io/reference/javascript/). Diagram language: [spec](https://predictygraph.github.io/reference/spec/).

## Script tag

```html
<script src="https://cdn.jsdelivr.net/npm/predictygraph-js"></script>

<pre class="pdg">
graph dir=LR
pod "Pod" -> sched "HAMi scheduler" -> gpu "GPU"
</pre>
```

On page load every `pre.pdg`, `div.pdg` and `code.language-pdg` element is replaced with its SVG, so fenced ```` ```pdg ```` blocks from Markdown renderers work as-is. Diagrams with errors are replaced with the error message.

## ES module

```sh
npm install predictygraph-js
```

```js
import { render } from "predictygraph-js";

element.innerHTML = render(source, { theme: "hami" });
```

API, options and themes: [predictygraph.github.io/reference/javascript](https://predictygraph.github.io/reference/javascript/).

## Development

```sh
npm install
make check    # biome + tsc
make test     # parity tests against layouts from the Python renderer
make build    # dist/index.mjs, dist/index.d.mts, dist/index.iife.js
```

`make themes` and `make fixtures` regenerate the themes and test fixtures from a predictygraph checkout (`PDG_SRC`, default `../predictygraph`).

## Releasing

```sh
make release            # patch: 0.1.0 -> 0.1.1
make release V=minor    # or major, or an exact version like V=1.2.0
```

This runs the checks, bumps `package.json`, tags `vX.Y.Z` and pushes. The release workflow then tests, publishes to npm with provenance, and creates a GitHub release with notes generated from the merged PRs and commits since the last tag.

## License

Apache-2.0
