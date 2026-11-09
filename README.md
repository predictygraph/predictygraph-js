# predictygraph-js

Render [predictygraph](https://github.com/predictygraph/predictygraph) (`.pdg`) diagrams to SVG in the browser. No runtime dependencies.

## Script tag

```html
<script src="https://unpkg.com/predictygraph-js/dist/index.iife.js"></script>

<pre class="pdg">
graph dir=LR
a "Pod" -> b "HAMi scheduler" -> c "GPU"
</pre>
```

Every `pre.pdg`, `div.pdg` and `code.language-pdg` element is replaced with its SVG on page load. To render manually:

```js
pdg.initialize({ startOnLoad: false, theme: "hami" });
pdg.run({ selector: ".diagram" });
```

## ES module

```js
import { render } from "predictygraph-js";

const svg = render(source, { theme: "hami" });
```

## Development

```sh
npm install
make check    # biome + tsc
make test     # parity tests against the Python renderer
make build    # dist/index.mjs, dist/index.d.mts, dist/index.iife.js
```

`make themes` and `make fixtures` regenerate the themes and test fixtures from a predictygraph checkout (`PDG_SRC`, default `../predictygraph`).
