// Function-style ("LeetCode") questions: the participant writes a method and
// the judge feeds it arguments. This module is the format shared by the
// importer and the wrappers (see README, "Function-style questions"):
//
//   test input   one compact JSON value per parameter, one per line, in order
//   test output  the expected return value as compact JSON
//
// Values arrive as Python/JSON-like literals ("nums = [3,3], target = 6"), so
// everything here works on text: numbers keep their exact lexeme, which keeps
// 64-bit integers intact.

export interface FunctionParam {
  name: string;
  /** The type as written in the signature, e.g. "List[List[int]]". */
  type: string;
}

export interface FunctionSpec {
  className: string;
  name: string;
  params: FunctionParam[];
  returnType: string;
  /** Why the wrappers cannot drive this question, or null when they can. */
  unsupported: string | null;
}

class LiteralError extends Error {}

/** Parses one Python- or JSON-style literal at `pos`; returns compact JSON text. */
function readLiteral(src: string, start: number): { json: string; end: number } {
  let i = start;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };
  const fail = (what: string): never => {
    throw new LiteralError(`${what} at ${i}`);
  };

  const value = (): string => {
    ws();
    const c = src[i];
    if (c === '[' || c === '(') return sequence(c === '[' ? ']' : ')');
    if (c === '{') return mapping();
    if (c === '"' || c === "'") return string(c);
    const word = /^[A-Za-z_]\w*/.exec(src.slice(i))?.[0];
    if (word) {
      i += word.length;
      if (word === 'True' || word === 'true') return 'true';
      if (word === 'False' || word === 'false') return 'false';
      if (word === 'None' || word === 'null') return 'null';
      return fail(`unsupported value "${word}"`);
    }
    const num = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))?.[0];
    if (!num) return fail('expected a value');
    i += num.length;
    // JSON forbids a leading "+" and a bare trailing or leading dot.
    let out = num.replace(/^\+/, '');
    out = out.replace(/^(-?)\./, '$10.').replace(/\.(?=[eE]|$)/, '.0');
    return out;
  };

  const sequence = (close: string): string => {
    i++;
    const items: string[] = [];
    ws();
    while (src[i] !== close) {
      items.push(value());
      ws();
      if (src[i] === ',') {
        i++;
        ws();
      } else if (src[i] !== close) fail(`expected "," or "${close}"`);
    }
    i++;
    return `[${items.join(',')}]`;
  };

  const mapping = (): string => {
    i++;
    const entries: string[] = [];
    ws();
    while (src[i] !== '}') {
      const key = value();
      ws();
      if (src[i] !== ':') fail('expected ":"');
      i++;
      const val = value();
      entries.push(`${key.startsWith('"') ? key : JSON.stringify(key)}:${val}`);
      ws();
      if (src[i] === ',') {
        i++;
        ws();
      } else if (src[i] !== '}') fail('expected "," or "}"');
    }
    i++;
    return `{${entries.join(',')}}`;
  };

  const string = (quote: string): string => {
    i++;
    let out = '';
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') {
        const e = src[i + 1];
        i += 2;
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'r') out += '\r';
        else if (e === '0') out += '\0';
        else if (e === 'x' || e === 'u') {
          const len = e === 'x' ? 2 : 4;
          const hex = src.slice(i, i + len);
          if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(hex)) fail('bad escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += len;
        } else out += e ?? '';
      } else out += src[i++];
    }
    if (src[i] !== quote) fail('unterminated string');
    i++;
    return JSON.stringify(out);
  };

  const json = value();
  return { json, end: i };
}

/** One literal, as compact JSON text. Throws on anything that is not a plain value. */
export function literalToJson(text: string): string {
  const { json, end } = readLiteral(text, 0);
  if (text.slice(end).trim()) throw new LiteralError('unexpected text after the value');
  return json;
}

/** "nums = [3,3], target = 6" → { nums: "[3,3]", target: "6" } (JSON text per name). */
export function parseNamedArgs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    const m = /^\s*([A-Za-z_]\w*)\s*=\s*/.exec(text.slice(i));
    if (!m) {
      if (!text.slice(i).trim()) break;
      throw new LiteralError(`expected "name = value" at ${i}`);
    }
    i += m[0].length;
    const { json, end } = readLiteral(text, i);
    out[m[1]!] = json;
    i = end;
    const comma = /^\s*,?/.exec(text.slice(i))![0];
    i += comma.length;
  }
  return out;
}

/**
 * A test in the canonical stdin form for a spec, from the source's
 * "a = 1, b = 2" and result text. `rawText` says the result is the bare text
 * of a string (some sources store str results unquoted, e.g. `abc`).
 */
export function toStdinTest(
  spec: Pick<FunctionSpec, 'params'>,
  input: string,
  output: string,
  options: { rawText?: boolean } = {},
): { input: string; output: string } {
  const args = parseNamedArgs(input);
  const lines = spec.params.map((p) => {
    const v = args[p.name];
    if (v === undefined) throw new LiteralError(`missing argument "${p.name}"`);
    return v;
  });
  return { input: `${lines.join('\n')}\n`, output: `${options.rawText ? JSON.stringify(output) : literalToJson(output)}\n` };
}

const SCALARS = new Set(['int', 'float', 'str', 'bool']);
const LINKED = new Set(['ListNode', 'TreeNode']);

/** Why a Python type annotation cannot be driven by the wrappers, or null. */
export function unsupportedType(type: string): string | null {
  const t = type.trim();
  if (SCALARS.has(t) || LINKED.has(t)) return null;
  const inner = /^(?:List|list|Optional)\[(.+)\]$/.exec(t)?.[1];
  if (inner) return unsupportedType(inner);
  return `the type "${t}" is not supported`;
}

/** Splits "a: int, b: List[int] = None" at top-level commas. */
function splitParams(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * The method a Python starter template asks for: the first `def` inside
 * `class Solution`. Null when there is no such method (design questions with
 * their own class, for instance).
 */
export function parsePythonSignature(starter: string): FunctionSpec | null {
  const cls = /^class\s+(\w+)/m.exec(starter);
  const def = /^\s+def\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->\s*([^:]+?))?\s*:/m.exec(starter);
  if (!cls || !def || cls[1] !== 'Solution' || def[1] === '__init__') return null;
  const params: FunctionParam[] = [];
  for (const raw of splitParams(def[2]!)) {
    const p = raw.trim();
    if (p === 'self') continue;
    const m = /^(\w+)\s*:\s*([^=]+?)\s*(?:=.*)?$/.exec(p);
    if (!m) return null;
    params.push({ name: m[1]!, type: m[2]!.trim() });
  }
  const returnType = (def[3] ?? 'None').trim().replace(/^["']|["']$/g, '');
  let unsupported: string | null = null;
  for (const p of params) unsupported ??= unsupportedType(p.type);
  if (returnType === 'None') unsupported ??= 'it modifies its input in place instead of returning a value';
  else unsupported ??= unsupportedType(returnType);
  return { className: 'Solution', name: def[1]!, params, returnType, unsupported };
}
