# Security policy

Report vulnerabilities privately through [GitHub security advisories](https://github.com/predictygraph/predictygraph-js/security/advisories/new). Please don't open a public issue.

Only the latest release gets fixes.

## What the renderer guarantees

`render()` takes untrusted diagram text and returns an SVG string meant for `innerHTML`. Its guarantees:

- All text, ids, classes and attribute values are XML-escaped. Diagram text can't add elements or event handlers.
- Images are limited to `data:image/{png,jpeg,gif,webp,svg+xml}` and `http(s)` URLs, drawn through SVG `<image>`, which never runs scripts.
- No `<style>` or `<script>` element is emitted. CSS in a diagram only sets presentation attributes.
- Input size is bounded: numbers, edges, annotations, `use` depth and group nesting have fixed limits, so input can't exhaust the stack.

`resolve()` callbacks and `http(s)` image URLs are under the embedding page's control. Restrict them with your Content-Security-Policy (`img-src`) if diagrams come from untrusted users.
