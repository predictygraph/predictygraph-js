import {
  ancestors,
  type Document,
  type Edge,
  type Group,
  type Item,
  isGroup,
  type Node,
  newGroup,
  newNode,
  type Resolver,
} from "./model.ts";
import { last, MAX_EDGES } from "./safe.ts";

const MAX_ANNOTATIONS = 64;
const MAX_USE_DEPTH = 16;
const MAX_DEPTH = 256;
const W = String.raw`\p{L}\p{N}_`;
const VAR_RE = new RegExp(String.raw`\$(?:\{([A-Za-z_][${W}]*)\}|([A-Za-z_][${W}]*))`, "gu");
const LET_RE = new RegExp(String.raw`^let\s+([A-Za-z_][${W}]*)\s*=\s*(.+)$`, "u");
const DEF_RE = new RegExp(String.raw`^def\s+([A-Za-z_][${W}-]*)\b(.*)\{\s*$`, "u");
const BARE_RE = /^[^\s"{};,]+$/;
const STR = String.raw`"(?:[^"\\]|\\.)*"`;
const KINDS = ["ws", "string", "arrow", "attr", "cls", "ident", "punct"];
const PATTERNS = [
  String.raw`[ \t]+`,
  STR,
  "<?[-=.]{1,64}>|<[-=.]{1,64}|[-=.]{2,64}",
  String.raw`[A-Za-z_][${W}-]*=(?:${STR}|[^\s{}]+)`,
  String.raw`\.[A-Za-z_][${W}-]*`,
  `[A-Za-z_][${W}-]*`,
  "[{},;]",
];
const TOKEN_RE = new RegExp(PATTERNS.map((p, i) => `(?<${KINDS[i]}>${p})`).join("|"), "uy");
const BODIES: Record<string, string> = { "-": "solid", "=": "thick", ".": "dashed" };

export class PdgSyntaxError extends Error {
  readonly line: number;
  constructor(msg: string, line: number) {
    super(`line ${line}: ${msg}`);
    this.line = line;
  }
}

type Tok = [kind: string, val: string];
type Line = [no: number, text: string];
interface Def {
  params: Map<string, string | null>;
  body: Line[];
}

const q = JSON.stringify;
const words = (s = ""): string[] => s.split(/\s+/).filter(Boolean);
const isP = (t: Tok | undefined, v: string): boolean => t?.[0] === "punct" && t[1] === v;
const escapeStr = (v: string): string => v.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

export const unquote = (s: string): string =>
  s.length > 1 && s.startsWith('"') && s.endsWith('"')
    ? s.slice(1, -1).replace(/\\([\s\S])/g, (_, c: string) => (c === "n" ? "\n" : c))
    : s;

export function stripComment(line: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (ch === "#" && (!out || " \t".includes(out.slice(-1))) && (i + 1 === line.length || " \t#!".includes(line[i + 1] as string)))
      break;
    else out += ch;
  }
  return out;
}

function tokenize(text: string, lineno: number): Tok[] {
  const toks: Tok[] = [];
  for (let pos = 0; pos < text.length; pos = TOKEN_RE.lastIndex) {
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(text);
    if (!m) throw new PdgSyntaxError(`unexpected ${q(text.slice(pos, pos + 12))}`, lineno);
    const kind = KINDS.find((k) => m.groups?.[k] !== undefined) as string;
    if (kind !== "ws") toks.push([kind, m[0]]);
  }
  return toks;
}

/** Split on ';' and after '{' / around '}' so blocks may share a line. */
function* splitStatements(toks: Tok[]): Generator<Tok[]> {
  let cur: Tok[] = [];
  for (const t of toks) {
    if (isP(t, ";") || isP(t, "{") || isP(t, "}")) {
      if (isP(t, "{")) cur.push(t);
      if (cur.length) yield cur;
      if (isP(t, "}")) yield [t];
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) yield cur;
}

function parseArrow(tok: string): [string, string] {
  const [s, e] = [tok.startsWith("<"), tok.endsWith(">")];
  return [s ? (e ? "both" : "start") : e ? "end" : "none", BODIES[tok.replace(/[<>]/g, "")[0] as string] as string];
}

const splitAttr = (v: string): [string, string] => {
  const i = v.indexOf("=");
  return [v.slice(0, i), unquote(v.slice(i + 1))];
};

class Parser {
  root = newGroup("__root__", undefined, "graph");
  doc: Document = { root: this.root, edges: [], stylesheets: [], items: new Map(), legend: [], brackets: [] };
  stack: Group[] = [this.root];
  vars: Map<string, string>[] = [new Map()];
  defs = new Map<string, Def>();
  prefixes: string[] = [];
  expanding: string[] = [];

  constructor(resolve?: Resolver) {
    if (resolve) this.doc.resolve = resolve;
  }

  get scope(): Group {
    return last(this.stack);
  }

  q = (id: string): string => [...this.prefixes, id].join("-");

  variable(name: string, lineno: number): string {
    const scope = [...this.vars].reverse().find((s) => s.has(name));
    if (!scope) throw new PdgSyntaxError(`unknown variable $${name}`, lineno);
    return scope.get(name) as string;
  }

  subst(line: string, lineno: number): string {
    if (!line.includes("$")) return line;
    return line
      .split(new RegExp(`(${STR})`))
      .map((part, k) =>
        part.replace(VAR_RE, (...m: (string | number)[]) => {
          const v = this.variable((m[1] ?? m[2]) as string, lineno);
          const at = m.at(-2) as number;
          return k % 2 || (at && "=.".includes(part[at - 1] as string) && BARE_RE.test(v))
            ? k % 2
              ? escapeStr(v)
              : v
            : `"${escapeStr(v)}"`;
        }),
      )
      .join("");
  }

  tail(toks: Tok[], from: number, lineno: number) {
    let label: string | undefined;
    const classes: string[] = [];
    const attrs: Record<string, string> = {};
    for (const [kind, val] of toks.slice(from)) {
      if (kind === "string" && label === undefined) label = unquote(val);
      else if (kind === "cls") classes.push(val.slice(1));
      else if (kind === "attr") {
        const [k, v] = splitAttr(val);
        attrs[k] = v;
      } else if (!(kind === "punct" && val === "{")) throw new PdgSyntaxError(`unexpected token ${q(val)}`, lineno);
    }
    return { label, classes, attrs };
  }

  annotationRoom(stmt: string, count: number, what: string, lineno: number): void {
    if (this.scope !== this.root) throw new PdgSyntaxError(`'${stmt}' only allowed at top level`, lineno);
    if (count >= MAX_ANNOTATIONS) throw new PdgSyntaxError(`too many ${what} (limit ${MAX_ANNOTATIONS})`, lineno);
  }

  implicit(id: string): void {
    if (this.doc.items.has(id)) return;
    const n: Node = { ...newNode(id, this.scope), implicit: true };
    this.scope.children.push(n);
    this.doc.items.set(id, n);
  }

  declare(id: string, lineno: number, asGroup: false): Node;
  declare(id: string, lineno: number, asGroup: true): Group;
  declare(id: string, lineno: number, asGroup: boolean): Item {
    const old = this.doc.items.get(id);
    if (old) {
      if (asGroup || isGroup(old)) throw new PdgSyntaxError(`duplicate id ${q(id)}`, lineno);
      if (old.implicit) {
        const kids = (old.parent as Group).children;
        kids.splice(kids.indexOf(old), 1);
        old.parent = this.scope;
        this.scope.children.push(old);
        old.implicit = false;
      }
      return old;
    }
    const item = asGroup ? newGroup(id, this.scope) : newNode(id, this.scope);
    this.scope.children.push(item);
    this.doc.items.set(id, item);
    return item;
  }

  defaultsFor(kind: string): Record<string, string> {
    const merged: Record<string, string> = {};
    for (const g of [this.scope, ...ancestors(this.scope)].reverse()) Object.assign(merged, g.defaults[kind]);
    return merged;
  }

  applyDefaults(item: Item, kind: string): void {
    const { __classes__, ...merged } = this.defaultsFor(kind);
    const extra = words(__classes__);
    item.classes = [...extra, ...item.classes.filter((c) => !extra.includes(c))];
    item.attrs = { ...merged, ...item.attrs };
  }

  statement(toks: Tok[], lineno: number): void {
    const [first, second] = toks as [Tok, Tok?];
    const head = first[1];
    if (toks.length === 1 && isP(first, "}")) {
      if (this.stack.length === 1) throw new PdgSyntaxError("unbalanced '}'", lineno);
      this.stack.pop();
      this.vars.pop();
      return;
    }
    if (toks.some((t) => t[0] === "arrow")) {
      this.edge(toks, lineno);
      return;
    }
    if (first[0] !== "ident") throw new PdgSyntaxError(`statement cannot start with ${q(head)}`, lineno);
    const two = toks.length >= 2;
    if (head === "graph" && (!two || second?.[0] !== "string")) {
      if (this.scope !== this.root) throw new PdgSyntaxError("'graph' only allowed at top level", lineno);
      const { classes, attrs } = this.tail(toks, 1, lineno);
      this.root.classes.push(...classes);
      Object.assign(this.root.attrs, attrs);
    } else if (head === "css" && toks.length === 2 && second?.[0] === "string") {
      if (!this.doc.resolve) throw new PdgSyntaxError('css "file" needs a resolve option', lineno);
      this.doc.stylesheets.push(this.doc.resolve(unquote(second[1]), "css"));
    } else if (head === "default" && two && ["node", "edge", "group"].includes((second as Tok)[1])) {
      const { classes, attrs } = this.tail(toks, 2, lineno);
      const key = (second as Tok)[1];
      this.scope.defaults[key] ??= {};
      const d = this.scope.defaults[key];
      Object.assign(d, attrs);
      if (classes.length) d.__classes__ = classes.join(" ");
    } else if (head === "use" && toks.length >= 3 && second?.[0] === "ident" && toks[2]?.[0] === "ident") this.use(toks, lineno);
    else if (head === "bracket" && two && second?.[0] === "ident") this.bracket(toks, lineno);
    else if (head === "legend" && (!two || ["string", "cls"].includes((second as Tok)[0]))) this.legend(toks, lineno);
    else if (head === "group" && two && second?.[0] === "ident") this.group(toks, lineno);
    else {
      const n = this.declare(this.q(head), lineno, false);
      const { label, classes, attrs } = this.tail(toks, 1, lineno);
      if (label !== undefined) n.label = label;
      n.classes.push(...classes);
      Object.assign(n.attrs, attrs);
      this.applyDefaults(n, "node");
    }
  }

  group(toks: Tok[], lineno: number): void {
    if (!isP(last(toks), "{")) throw new PdgSyntaxError("group needs '{'", lineno);
    const { label, classes, attrs } = this.tail(toks.slice(0, -1), 2, lineno);
    this.openGroup(this.q((toks[1] as Tok)[1]), label, classes, attrs, lineno, new Map());
  }

  private openGroup(
    id: string,
    label: string | undefined,
    classes: string[],
    attrs: Record<string, string>,
    lineno: number,
    vars: Map<string, string>,
  ): void {
    if (this.stack.length > MAX_DEPTH) throw new PdgSyntaxError(`groups nested too deep (limit ${MAX_DEPTH})`, lineno);
    const g = this.declare(id, lineno, true);
    Object.assign(g, { classes, attrs });
    if (label !== undefined) g.label = label;
    this.applyDefaults(g, "group");
    this.stack.push(g);
    this.vars.push(vars);
  }

  bracket(toks: Tok[], lineno: number): void {
    this.annotationRoom("bracket", this.doc.brackets.length, "brackets", lineno);
    const ids: string[] = [];
    let i = 1;
    for (; i < toks.length && ["ident", "punct"].includes((toks[i] as Tok)[0]) && !isP(toks[i], "{"); i++)
      if ((toks[i] as Tok)[0] === "ident") ids.push(this.q((toks[i] as Tok)[1]));
    const { label, classes, attrs } = this.tail(toks, i, lineno);
    this.doc.brackets.push({ kind: "bracket", id: "", ids, label: label ?? "", classes, attrs, style: {} });
  }

  legend(toks: Tok[], lineno: number): void {
    const { label, classes, attrs } = this.tail(toks, 1, lineno);
    if (!classes.length) {
      this.annotationRoom("legend", 0, "", lineno);
      if (label !== undefined) this.doc.legendTitle = label;
      return;
    }
    this.annotationRoom("legend", this.doc.legend.length, "legend entries", lineno);
    this.doc.legend.push({
      ...newNode(`pdg-legend-${this.doc.legend.length}`, this.root),
      label: label ?? classes.join(" "),
      classes,
      attrs,
    });
  }

  edge(toks: Tok[], lineno: number): void {
    const chains: string[][] = [[]];
    const arrows: [string, string][] = [];
    let i = 0;
    for (; i < toks.length; i++) {
      const [kind, val] = toks[i] as Tok;
      if (kind === "ident") last(chains).push(this.q(val));
      else if (kind === "arrow") {
        if (!last(chains).length) throw new PdgSyntaxError("arrow without source", lineno);
        arrows.push(parseArrow(val));
        chains.push([]);
      } else if (!isP(toks[i], ",")) break;
    }
    if (!last(chains).length) throw new PdgSyntaxError("arrow without target", lineno);
    const { label, classes, attrs } = this.tail(toks, i, lineno);
    const { __classes__, ...defaults } = this.defaultsFor("edge");
    for (const id of chains.flat()) this.implicit(id);
    const hops = chains.slice(1).map((dsts, k) => ({ srcs: chains[k] as string[], dsts, arrow: arrows[k] as [string, string] }));
    const count = hops.reduce((s, h) => s + h.srcs.length * h.dsts.length, 0);
    if (this.doc.edges.length + count > MAX_EDGES) throw new PdgSyntaxError(`too many edges (limit ${MAX_EDGES})`, lineno);
    for (const { srcs, dsts, arrow } of hops)
      for (const src of srcs)
        for (const dst of dsts) {
          const index = this.doc.edges.length;
          const e: Edge = {
            kind: "edge",
            id: `e${index}`,
            src,
            dst,
            arrow: arrow[0],
            body: arrow[1],
            classes: [...words(__classes__), ...classes],
            attrs: { ...defaults, ...attrs },
            scope: this.scope,
            style: {},
            labelStyle: {},
            stepStyle: {},
            index,
            waypoints: [],
          };
          if (label !== undefined) e.label = label;
          this.doc.edges.push(e);
        }
  }

  /** `use NAME ID ["Label"] [.class...] [param=value...] [attrs]`: one copy of a `def` block. */
  use(toks: Tok[], lineno: number): void {
    const [name, gid] = [(toks[1] as Tok)[1], (toks[2] as Tok)[1]];
    const def = this.defs.get(name);
    if (!def) throw new PdgSyntaxError(`unknown block ${q(name)}`, lineno);
    if (this.prefixes.length >= MAX_USE_DEPTH || this.expanding.includes(name))
      throw new PdgSyntaxError(`block ${q(name)} uses itself`, lineno);
    const { label, classes, attrs } = this.tail(toks, 3, lineno);
    const args = new Map<string, string>();
    for (const k of Object.keys(attrs)) {
      if (!def.params.has(k)) continue;
      args.set(k, attrs[k] as string);
      delete attrs[k];
    }
    for (const [k, v] of def.params) if (v === null && !args.has(k)) throw new PdgSyntaxError(`use ${name}: missing ${k}=`, lineno);
    const depth = this.stack.length;
    const defaults = [...def.params].filter((p): p is [string, string] => p[1] !== null);
    this.openGroup(this.q(gid), label, classes, attrs, lineno, new Map([...defaults, ...args, ["ID", gid], ["LABEL", label ?? gid]]));
    this.prefixes.push(gid);
    this.expanding.push(name);
    try {
      this.run(def.body);
    } finally {
      this.expanding.pop();
      this.prefixes.pop();
    }
    if (this.stack.length !== depth + 1) throw new PdgSyntaxError(`unbalanced braces in block ${q(name)}`, lineno);
    this.stack.pop();
    this.vars.pop();
  }

  /** Capture a `def NAME [params] {` block's raw lines up to its closing brace. */
  define(name: string, head: string, lines: Line[], start: number, lineno: number): number {
    const params = new Map<string, string | null>();
    for (const [kind, val] of tokenize(head.trim(), lineno)) {
      if (kind === "attr") params.set(...splitAttr(val));
      else if (kind === "ident") params.set(val, null);
      else throw new PdgSyntaxError(`bad def parameter ${q(val)}`, lineno);
    }
    const body: Line[] = [];
    let depth = 1;
    for (let i = start + 1; ; i++) {
      if (i >= lines.length) throw new PdgSyntaxError(`unclosed def ${q(name)}`, lineno);
      const [ln, text] = lines[i] as Line;
      const s = stripComment(text).trim();
      if (s.startsWith("css")) depth += s.split("{").length - s.split("}").length;
      else if (s) for (const t of tokenize(s, ln)) depth += isP(t, "{") ? 1 : isP(t, "}") ? -1 : 0;
      if (depth <= 0) {
        this.defs.set(name, { params, body });
        return i;
      }
      body.push([ln, text]);
    }
  }

  /** Raw `css { ... }` block starting after its `{` on line `start`; returns [last line, css, text after the `}`]. */
  cssBlock(first: string, lines: Line[], start: number, lineno: number): [number, string, string] {
    let buf = "";
    let depth = 1;
    let rest = first;
    for (let i = start; ; ) {
      for (let j = 0; j < rest.length; j++) {
        const ch = rest[j] as string;
        if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) return [i, buf, rest.slice(j + 1)];
        buf += ch;
      }
      buf += "\n";
      if (++i >= lines.length) throw new PdgSyntaxError("unterminated css block", lineno);
      rest = (lines[i] as Line)[1];
    }
  }

  statements(text: string, lineno: number): void {
    for (const stmt of splitStatements(tokenize(this.subst(text, lineno), lineno))) this.statement(stmt, lineno);
  }

  run(lines: Line[]): void {
    for (let i = 0; i < lines.length; i++) {
      const [lineno, line] = lines[i] as Line;
      const stripped = stripComment(line).trim();
      const let_ = LET_RE.exec(stripped);
      const def = DEF_RE.exec(stripped);
      const css = /^\s*css\s*\{(.*)$/.exec(line);
      if (let_) {
        const v = this.subst((let_[2] as string).trim(), lineno);
        if (!(BARE_RE.test(v) || (v.length > 1 && v[0] === '"' && last([...v]) === '"')))
          throw new PdgSyntaxError(`let ${let_[1]}: one value expected`, lineno);
        last(this.vars).set(let_[1] as string, unquote(v));
      } else if (def) i = this.define(def[1] as string, def[2] as string, lines, i, lineno);
      else if (css) {
        const [end, sheet, rest] = this.cssBlock(css[1] as string, lines, i, lineno);
        this.doc.stylesheets.push(sheet);
        i = end;
        const tail = stripComment(rest).trim();
        if (tail) this.statements(tail, (lines[end] as Line)[0]);
      } else if (stripped) this.statements(stripped, lineno);
    }
  }

  finish(nlines: number): Document {
    if (this.stack.length !== 1) throw new PdgSyntaxError(`unclosed group ${q(this.scope.id)}`, nlines);
    for (const e of this.doc.edges)
      for (const id of [e.src, e.dst]) if (!this.doc.items.has(id)) throw new PdgSyntaxError(`unknown id ${q(id)}`, 0);
    for (const b of this.doc.brackets) {
      const missing = b.ids.find((i) => !this.doc.items.has(i));
      if (missing !== undefined) throw new PdgSyntaxError(`bracket: unknown id ${q(missing)}`, 0);
      if (!b.ids.length) throw new PdgSyntaxError("bracket needs ids", 0);
    }
    return this.doc;
  }
}

export function parse(text: string, resolve?: Resolver): Document {
  const p = new Parser(resolve);
  const lines = text.split(/\r\n|\r|\n/);
  p.run(lines.map((l, i): Line => [i + 1, l]));
  return p.finish(lines.length);
}
