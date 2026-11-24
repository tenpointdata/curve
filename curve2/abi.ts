// The JavaScript ABI of a checked module: from the same book and selected
// exports that write the .mjs, a typed schema of what crosses the edge. It
// renders the .d.mts companion and the guard the .mjs calls through, so the
// declared types and the runtime values cannot drift apart.
//
// Supported, by Curve type (after normalization):
//   Nat            number, a safe integer >= 0 (arithmetic past 2^48-1
//                  fail-stops inside the runtime)
//   U32            number, an integer from 0 to 2^32-1
//   F32            number, exactly a float32 (NaN and +-Infinity included)
//   Bool           boolean
//   Char, String   string, well-formed UTF-16 (a Char is one code point)
//   Array<T>       T[], length a power of two, passed without a copy
//   A -> B         a unary function (curried), as an export's parameter or
//                  result, or a callback's argument or result
//   any other datatype, Unit, Maybe and List included:
//                  {$: "Ctor", field: value, ...}, erased fields absent.
//                  A family whose parameters are all quantities or types is
//                  a generic alias; one indexed otherwise is inlined per use.
// Refused with an error when the ABI is derived: polymorphic or
// value-dependent types, types as values, equalities, erased binders in a
// function value, functions inside a datatype or array, and recursion
// through a value-indexed family. The guard refuses, with a TypeError naming
// the export and the path, any value outside its declared type: no number
// is rounded, no string repaired, no extra key dropped, no arity curried.

import * as Curve from "./curve.ts";
import * as Comp from "./comp.ts";

// An export's book name, how many live parameters its call takes and the
// raw call (no host conversion), read from js_lib's export block.
export type LibSig = { k: Name; live: number; call: string };

type HTerm = Curve.HTerm;
type Name = Curve.Name;

export type AbiType =
  | { $: "nat" } | { $: "u32" } | { $: "f32" } | { $: "bool" }
  | { $: "char" } | { $: "string" }
  | { $: "array"; of: AbiType }
  | { $: "fn"; arg: AbiType; ret: AbiType }
  | { $: "ref"; fam: number; args: AbiType[] }
  | { $: "sum"; ctrs: AbiCtr[] }
  | { $: "param"; i: number };
export type AbiCtr = { tag: string; fields: Array<[Name, AbiType]> };
export type AbiFamily = { k: Name; ts: string; params: string[]; ctrs: AbiCtr[] };
export type AbiExport = { key: Name; params: Array<[Name, AbiType]>; ret: AbiType };
export type Abi = { families: AbiFamily[]; exports: AbiExport[] };

// names maps a datatype's book name ("resolve:Bind") to its TypeScript name.
export type AbiNames = ReadonlyMap<Name, string>;

const NATIVE: Record<Name, AbiType> = Object.setPrototypeOf({
  Nat: { $: "nat" }, U32: { $: "u32" }, F32: { $: "f32" }, Bool: { $: "bool" },
  Char: { $: "char" }, String: { $: "string" },
}, null);

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export class AbiError extends Error {}

// Derive
// ======

type Probe = { kind: "param"; i: number } | { kind: "value"; k: Name };

type Deriver = {
  book: Curve.Book;
  fams: AbiFamily[];
  index: Map<Name, number>;
  probes: Map<string, Probe>;
  inline: Name[];
  where: string;
};

function fail(d: Deriver, why: string): never {
  throw new AbiError("ABI of " + d.where + ": " + why);
}

// A probe stands for a family's parameter or a binder's value while a type
// is read; meeting a value probe means the type depends on a value.
function probe(d: Deriver, p: Probe): HTerm {
  const name = "\u0000abi" + String(d.probes.size);
  d.probes.set(name, p);
  return Curve.Var<Curve.HBody>(name, -1 - d.probes.size);
}

function wnf(d: Deriver, T: HTerm): HTerm {
  const t = Curve.term_wnf(d.book, T);
  return t.$ === "Rwt" ? wnf(d, t.f) : t.$ === "Ann" ? wnf(d, t.x) : t;
}

function show(d: Deriver, T: HTerm): string {
  return Curve.expr_show(d.book, T);
}

// conv reads type T; data is whether it sits inside a datatype or array.
function conv(d: Deriver, T: HTerm, data: boolean): AbiType {
  const t = wnf(d, T);
  switch (t.$) {
    case "ADT": {
      const native = NATIVE[t.k];
      if (native) {
        return native;
      }
      if (t.k === "Array") {
        return { $: "array", of: conv(d, t.x[0], true) };
      }
      return family(d, t.k, t.x);
    }
    case "All": {
      if (data) {
        fail(d, "a function inside a datatype or array cannot cross");
      }
      if (t.q.$ === "None") {
        fail(d, "a function value with an erased binder cannot cross: " + show(d, t));
      }
      return { $: "fn", arg: conv(d, t.A, false),
        ret: conv(d, t.B(probe(d, { kind: "value", k: t.k })), false) };
    }
    case "Var": {
      const p = d.probes.get(t.k);
      if (p?.kind === "param") {
        return { $: "param", i: p.i };
      }
      return fail(d, p ? "the type depends on the value " + p.k
        : "a polymorphic type " + t.k + " cannot cross");
    }
    case "Typ":
    case "Qnt":
      return fail(d, "a type or quantity cannot cross as a value");
    case "Eql":
      return fail(d, "an equality cannot cross as a value");
    default:
      return fail(d, "unsupported type " + show(d, t));
  }
}

type Kind = "quant" | "type" | "value";

function param_kinds(d: Deriver, adt: Curve.ADT): Array<[Name, Kind]> {
  return Curve.tele_unbind(d.book, adt.T).doms.map(([, k, A]) => {
    const t = wnf(d, A);
    return [k, t.$ === "Qnt" ? "quant" : t.$ === "Typ" ? "type" : "value"];
  });
}

function ctrs(d: Deriver, adt: Curve.ADT, xs: HTerm[], data: boolean): AbiCtr[] {
  return adt.c.map((c) => {
    const doms = Curve.tele_unbind(d.book,
      Curve.tele_fill(d.book, c.T, xs, Curve.ctx_nil())).doms;
    const fields = doms.slice(doms.length - c.n).filter(([q]) => q.$ !== "None");
    return { tag: c.k.slice(c.k.indexOf(":") + 1),
      fields: fields.map(([, k, A]): [Name, AbiType] => [k, conv(d, A, data)]) };
  });
}

function family(d: Deriver, k: Name, xs: HTerm[]): AbiType {
  const adt = d.book.tlds[k];
  if (adt?.$ !== "ADT") {
    return fail(d, "unsupported type " + k);
  }
  const kinds = param_kinds(d, adt);
  if (kinds.some(([, q]) => q === "value")) {
    if (d.inline.includes(k)) {
      fail(d, "recursion through the value-indexed family " + k);
    }
    d.inline.push(k);
    const sum: AbiType = { $: "sum", ctrs: ctrs(d, adt, xs, true) };
    d.inline.pop();
    return sum;
  }
  let fam = d.index.get(k);
  if (fam === undefined) {
    fam = d.fams.length;
    d.index.set(k, fam);
    const ts: string[] = [];
    const probes = kinds.map(([n, q]) => {
      if (q === "type") {
        const p = IDENT.test(n) && !ts.includes(n) ? n : "T" + String(ts.length);
        ts.push(p);
        return probe(d, { kind: "param", i: ts.length - 1 });
      }
      return probe(d, { kind: "value", k: n });
    });
    const entry: AbiFamily = { k, ts: "", params: ts, ctrs: [] };
    d.fams.push(entry);
    const at = d.where;
    d.where = "datatype " + k;
    entry.ctrs = ctrs(d, adt, probes, true);
    d.where = at;
  }
  const args = xs.filter((_, i) => kinds[i]?.[1] === "type").map((x) => conv(d, x, true));
  return { $: "ref", fam, args };
}

function ts_default(k: Name): string {
  const bare = k.slice(k.indexOf(":") + 1);
  return "Curve" + bare.split(/[^A-Za-z0-9]+/).filter((s) => s !== "")
    .map((s) => s[0].toUpperCase() + s.slice(1)).join("");
}

function names_apply(fams: AbiFamily[], names: AbiNames): void {
  const known = new Set(fams.map((f) => f.k));
  for (const [k, ts] of names) {
    if (!known.has(k)) {
      throw new AbiError("--type " + k + "=" + ts + ": no exported value uses "
        + k + " (declared: " + [...known].join(", ") + ")");
    }
    if (!IDENT.test(ts)) {
      throw new AbiError("--type " + k + "=" + ts + ": not a TypeScript identifier");
    }
  }
  const taken = new Map<string, Name>();
  for (const f of fams) {
    f.ts = names.get(f.k) ?? ts_default(f.k);
    const other = taken.get(f.ts);
    if (other !== undefined) {
      throw new AbiError(other + " and " + f.k + " are both " + f.ts
        + ": rename one with --type <name>=<TypeScriptName>");
    }
    taken.set(f.ts, f.k);
  }
}

// abi_derive reads each export's binders up to its last live parameter, and
// the erased ones after it, as js_lib's arity does: live ones are its
// parameters, the rest of its type its result.
export function abi_derive(book: Curve.Book, sigs: readonly LibSig[],
  names: AbiNames = new Map()): Abi {
  const d: Deriver = { book, fams: [], index: new Map(), probes: new Map(),
    inline: [], where: "" };
  const exports = sigs.map(({ k, live }): AbiExport => {
    const tld = book.tlds[k];
    d.where = "export " + k;
    const params: Array<[Name, AbiType]> = [];
    let T = tld.T;
    for (let t = Curve.tele_open(book, T); t !== null; t = Curve.tele_open(book, T)) {
      if (t.q.$ !== "None" && params.length === live) {
        break;
      }
      if (t.q.$ !== "None") {
        params.push([t.k, conv(d, t.A, false)]);
      }
      T = t.B(probe(d, { kind: "value", k: t.k }));
    }
    if (params.length !== live) {
      fail(d, "fewer binders than its arity");
    }
    return { key: k, params, ret: conv(d, T, false) };
  });
  names_apply(d.fams, names);
  return { families: d.fams, exports };
}

// Declarations
// ============

function ts_key(k: Name): string {
  return IDENT.test(k) ? k : JSON.stringify(k);
}

function ts_type(abi: Abi, t: AbiType, params: string[]): string {
  switch (t.$) {
    case "nat":
    case "u32":
    case "f32":
      return "number";
    case "bool":
      return "boolean";
    case "char":
    case "string":
      return "string";
    case "array":
      return ts_wrap(abi, t.of, params) + "[]";
    case "fn":
      return "(x: " + ts_type(abi, t.arg, params) + ") => " + ts_type(abi, t.ret, params);
    case "param":
      return params[t.i];
    case "ref": {
      const f = abi.families[t.fam];
      return f.ts + (t.args.length === 0 ? ""
        : "<" + t.args.map((a) => ts_type(abi, a, params)).join(", ") + ">");
    }
    case "sum":
      return ts_sum(abi, t.ctrs, params, "");
  }
}

function ts_wrap(abi: Abi, t: AbiType, params: string[]): string {
  const s = ts_type(abi, t, params);
  return t.$ === "fn" || (t.$ === "sum" && t.ctrs.length !== 1) ? "(" + s + ")" : s;
}

function ts_sum(abi: Abi, cs: AbiCtr[], params: string[], pad: string): string {
  if (cs.length === 0) {
    return "never";
  }
  const arms = cs.map((c) => "{ $: " + JSON.stringify(c.tag) + c.fields.map(([k, t]) =>
    "; " + ts_key(k) + ": " + ts_type(abi, t, params)).join("") + " }");
  return arms.length === 1 ? arms[0] : arms.map((a) => "\n" + pad + "  | " + a).join("");
}

function ts_param(k: Name, i: number, seen: Set<string>): string {
  const base = IDENT.test(k) && !k.startsWith("$") ? k : "a" + String(i);
  let p = base;
  for (let j = 2; seen.has(p); j++) {
    p = base + String(j);
  }
  seen.add(p);
  return p;
}

// abi_dts renders the .d.mts companion of the module source names.
export function abi_dts(abi: Abi, source: string): string {
  const fams = abi.families.map((f) => "export type " + f.ts
    + (f.params.length === 0 ? "" : "<" + f.params.join(", ") + ">")
    + " =" + (f.ctrs.length > 1 ? "" : " ") + ts_sum(abi, f.ctrs, f.params, "") + ";\n");
  const sigs = abi.exports.map((e) => {
    const seen = new Set<string>();
    return "  " + JSON.stringify(e.key) + "(" + e.params.map(([k, t], i) =>
      ts_param(k, i, seen) + ": " + ts_type(abi, t, [])).join(", ") + "): "
      + ts_type(abi, e.ret, []) + ";\n";
  });
  return "// Generated by curve from " + source + " with its module; do not edit.\n"
    + "// The module's guard throws a TypeError for any value outside these types.\n\n"
    + fams.join("") + (fams.length === 0 ? "" : "\n")
    + "declare const module: {\n" + sigs.join("") + "};\n\nexport default module;\n";
}

// Module
// ======

// abi_exports_js is the .mjs export block: the schema and the raw calls,
// bound through the guard.
export function abi_exports_js(abi: Abi, sigs: readonly LibSig[]): string {
  return ABI_RUNTIME + "const ABI = " + JSON.stringify(abi) + ";\n\n"
    + "export default abi_bind(ABI, {\n" + sigs.map((s) =>
      "  " + JSON.stringify(s.k) + ": " + s.call + ",\n").join("") + "});\n";
}

// js_lib ends in "export default {" and one line per export,
//   "key": run_lib((a0,a1) => <host>(run_loop($id(<host>(a0),...))), 2),
// so the raw call is $id and the arity the count; any other shape is a
// compiler change this reader must follow, and fails here.
const LIB_LINE = /^  (\S.*?|\["__proto__"\]): run_lib\(\(.*?\) => .*?run_loop\((\$[\w$]*)\(.*, (\d+)\),$/;

export function lib_sigs(js: string): { head: string; sigs: LibSig[] } {
  const at = js.lastIndexOf("export default {\n");
  const lines = js.slice(at).split("\n").slice(1, -2);
  if (at < 0 || !js.endsWith("\n};\n")) {
    throw new AbiError("ABI: the module has no export block to guard");
  }
  return { head: js.slice(0, at), sigs: lines.map((line) => {
    const m = LIB_LINE.exec(line);
    if (m === null) {
      throw new AbiError("ABI: unrecognized export line: " + line);
    }
    const k: unknown = m[1] === '["__proto__"]' ? "__proto__" : JSON.parse(m[1]);
    if (typeof k !== "string") {
      throw new AbiError("ABI: unrecognized export key: " + m[1]);
    }
    return { k, live: Number(m[3]), call: "(...a) => run_loop(" + m[2] + "(...a))" };
  }) };
}

// abi_module emits the guarded module and its declarations from one book.
export function abi_module(book: Curve.Book, exports: readonly string[] | undefined,
  names: AbiNames, source: string): { mjs: string; dts: string } {
  const { head, sigs } = lib_sigs(Comp.js_lib(book, true, exports));
  const abi = abi_derive(book, sigs, names);
  return { mjs: head + abi_exports_js(abi, sigs), dts: abi_dts(abi, source) };
}

// Guard
// =====

// The guard checks data without recursion (a long List is a deep chain) and
// wraps functions where they cross: "in" is host to Curve, "out" the other.
const ABI_RUNTIME = String.raw`
// ABI
// ===

function abi_bind(abi, calls) {
  const out = Object.create(null);
  for (const e of abi.exports) {
    const call = calls[e.key];
    const n = e.params.length;
    out[e.key] = (...a) => {
      const at = "curve abi: " + e.key;
      if (a.length !== n) {
        throw new TypeError(at + " takes " + n + " argument(s), got " + a.length);
      }
      const xs = e.params.map(([k, t], i) => abi_value(abi, t, a[i], at + " argument " + k, true));
      return abi_value(abi, e.ret, call(...xs), at + " result", false);
    };
  }
  return Object.freeze(out);
}

function abi_value(abi, t, v, at, inward) {
  if (t.$ !== "fn") {
    abi_data(abi, t, v, at);
    return v;
  }
  if (typeof v !== "function") {
    throw new TypeError(at + ": expected a function, got " + abi_show(v));
  }
  return (...a) => {
    if (a.length !== 1) {
      throw new TypeError(at + ": a Curve function takes 1 argument, got " + a.length);
    }
    const x = abi_value(abi, t.arg, a[0], at + " argument", !inward);
    return abi_value(abi, t.ret, v(x), at + " result", inward);
  };
}

function abi_show(v) {
  return typeof v === "string" ? JSON.stringify(v) : typeof v === "bigint" ? v + "n"
    : typeof v === "number" || typeof v === "boolean" || v == null ? String(v)
    : Array.isArray(v) ? "an array"
    : typeof v === "object" && typeof v.$ === "string" ? "{$: " + JSON.stringify(v.$) + "}"
    : typeof v;
}

function abi_text(v) {
  return typeof v === "string" && (typeof v.isWellFormed === "function"
    ? v.isWellFormed() : !/\p{Cs}/u.test(v));
}

const ABI_LEAF = {
  nat: ["a Nat (a safe integer >= 0)", (v) => Number.isSafeInteger(v) && v >= 0],
  u32: ["a U32 (an integer from 0 to 4294967295)",
    (v) => Number.isInteger(v) && v >= 0 && v <= 4294967295],
  f32: ["an F32 (a number float32 holds exactly)",
    (v) => typeof v === "number" && (v !== v || Math.fround(v) === v)],
  bool: ["a boolean", (v) => typeof v === "boolean"],
  string: ["a well-formed string", abi_text],
  char: ["one code point", (v) => abi_text(v) && v.length !== 0 && v.length === String.fromCodePoint(v.codePointAt(0)).length],
};

function abi_subst(t, args) {
  switch (t.$) {
    case "param": return args[t.i];
    case "array": return { $: "array", of: abi_subst(t.of, args) };
    case "ref": return { $: "ref", fam: t.fam, args: t.args.map((a) => abi_subst(a, args)) };
    case "sum": return { $: "sum", ctrs: t.ctrs.map((c) => ({ tag: c.tag,
      fields: c.fields.map(([k, f]) => [k, abi_subst(f, args)]) })) };
    default: return t;
  }
}

const ABI_ARMS = new WeakMap();

function abi_arms(abi, t) {
  let memo = ABI_ARMS.get(abi);
  if (memo === undefined) {
    ABI_ARMS.set(abi, memo = new Map());
  }
  const key = JSON.stringify(t);
  let arms = memo.get(key);
  if (arms === undefined) {
    const cs = t.$ === "sum" ? t.ctrs : abi.families[t.fam].ctrs.map((c) =>
      abi_subst({ $: "sum", ctrs: [c] }, t.args).ctrs[0]);
    arms = new Map(cs.map((c) => [c.tag, c.fields]));
    memo.set(key, arms);
  }
  return arms;
}

function abi_path(node) {
  let s = "";
  for (; node !== null; node = node.up) {
    s = node.key + s;
  }
  return s;
}

function abi_data(abi, t0, v0, at) {
  const work = [{ t: t0, v: v0, up: null, key: "" }];
  const bad = (node, what) => {
    throw new TypeError(at + abi_path(node) + ": expected " + what + ", got " + abi_show(node.v));
  };
  while (work.length !== 0) {
    const node = work.pop();
    const { t, v } = node;
    const leaf = ABI_LEAF[t.$];
    if (leaf !== undefined) {
      if (!leaf[1](v)) {
        bad(node, leaf[0]);
      }
    } else if (t.$ === "array") {
      if (!Array.isArray(v) || v.length === 0 || (v.length & (v.length - 1)) !== 0) {
        bad(node, "an Array (a JS array whose length is a power of two)");
      }
      for (let i = v.length - 1; i >= 0; i--) {
        work.push({ t: t.of, v: v[i], up: node, key: "[" + i + "]" });
      }
    } else {
      const arms = abi_arms(abi, t);
      const tags = [...arms.keys()].map((k) => JSON.stringify(k)).join(" | ");
      if (typeof v !== "object" || v === null || Array.isArray(v)
        || !Object.hasOwn(v, "$") || !arms.has(v.$)) {
        bad(node, "{$: " + (tags || "never") + "}");
      }
      const fields = arms.get(v.$);
      const lost = fields.find(([k]) => !Object.hasOwn(v, k));
      const extra = Object.keys(v).length === fields.length + 1 && lost === undefined
        ? undefined : Object.keys(v).find((k) => k !== "$" && !fields.some(([f]) => f === k));
      if (lost !== undefined || extra !== undefined) {
        throw new TypeError(at + abi_path(node) + ": " + v.$ + [extra === undefined ? ""
          : " has no field " + JSON.stringify(extra), lost === undefined ? ""
          : " is missing field " + JSON.stringify(lost[0])].filter((x) => x).join(" and"));
      }
      for (let i = fields.length - 1; i >= 0; i--) {
        const [k, f] = fields[i];
        work.push({ t: f, v: v[k], up: node, key: "." + k });
      }
    }
  }
}

`;
