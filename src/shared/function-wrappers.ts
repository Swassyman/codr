// Function-style questions: starter templates and the hidden driver that runs
// a participant's method. The participant writes only the method; the driver
// reads the arguments (one compact JSON value per line, in parameter order),
// calls it, and prints the result as one JSON value. Decoding and encoding
// follow the signature: lists, strings, numbers, booleans, and ListNode and
// TreeNode (LeetCode's level-order array for trees).
//
// Line numbers in compiler and runtime errors stay the participant's own:
// the driver goes after their code, and anything that must come before it
// (includes, imports, helper classes) is kept on their first line or behind a
// #line directive. Python runs their code through compile() for the same reason.

import { FUNCTION_LANGUAGES, parseType, type FunctionSpec, type TypeNode } from './function-spec';
import type { LanguageId } from './languages';

export type FunctionLanguage = (typeof FUNCTION_LANGUAGES)[number];

export const isFunctionLanguage = (l: string): l is FunctionLanguage => (FUNCTION_LANGUAGES as readonly string[]).includes(l);

const usesList = (t: TypeNode): boolean => t.k === 'listnode' || (t.k === 'list' && usesList(t.of));
const usesTree = (t: TypeNode): boolean => t.k === 'treenode' || (t.k === 'list' && usesTree(t.of));

function typesOf(spec: FunctionSpec) {
  const params = spec.params.map((p) => ({ name: p.name, type: parseType(p.type), written: p.type }));
  return { params, ret: parseType(spec.returnType), retWritten: spec.returnType };
}

/** The type as a small JSON descriptor the dynamic drivers walk: "int", ["list", "str"], "listnode". */
const descriptor = (t: TypeNode): unknown => (t.k === 'list' ? ['list', descriptor(t.of)] : t.k);

// ------------------------------------------------------------------ Python

const PY_PRELUDE = `from typing import *
import random, functools, collections, string, math, datetime, heapq, bisect, itertools, operator, re
from functools import *
from collections import *
from itertools import *
from heapq import *
from bisect import *
from string import *
from operator import *
from math import *
inf = float('inf')
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
`;

const PY_DRIVER = String.raw`
def __codr_dec(v, t):
    if t == 'listnode':
        head = None
        for x in reversed(v):
            head = ListNode(x, head)
        return head
    if t == 'treenode':
        if not v or v[0] is None:
            return None
        root = TreeNode(v[0])
        queue = [root]
        i = 1
        h = 0
        while h < len(queue) and i < len(v):
            node = queue[h]
            h += 1
            if i < len(v) and v[i] is not None:
                node.left = TreeNode(v[i])
                queue.append(node.left)
            i += 1
            if i < len(v) and v[i] is not None:
                node.right = TreeNode(v[i])
                queue.append(node.right)
            i += 1
        return root
    if isinstance(t, list):
        return [__codr_dec(x, t[1]) for x in v]
    return v

def __codr_enc(v, t):
    if v is None and t != 'listnode' and t != 'treenode':
        return None
    if t == 'listnode':
        out = []
        while v is not None:
            out.append(v.val)
            v = v.next
        return out
    if t == 'treenode':
        out = []
        queue = [v]
        h = 0
        while h < len(queue):
            node = queue[h]
            h += 1
            if node is None:
                out.append(None)
            else:
                out.append(node.val)
                queue.append(node.left)
                queue.append(node.right)
        while out and out[-1] is None:
            out.pop()
        return out
    if isinstance(t, list):
        return [__codr_enc(x, t[1]) for x in v]
    return v

def __codr_main():
    import sys, json
    lines = sys.stdin.buffer.read().decode('utf-8').split('\n')
    types = __CODR_TYPES__
    args = [__codr_dec(json.loads(lines[i]), t) for i, t in enumerate(types)]
    res = Solution().__CODR_NAME__(*args)
    sys.stdout.buffer.write((json.dumps(__codr_enc(res, __CODR_RET__), separators=(',', ':'), ensure_ascii=False) + '\n').encode('utf-8'))
    sys.stdout.buffer.flush()

__codr_main()
`;

function wrapPython(spec: FunctionSpec, code: string) {
  const { params, ret } = typesOf(spec);
  const driver = PY_DRIVER.replace('__CODR_TYPES__', JSON.stringify(params.map((p) => descriptor(p.type))))
    .replace('__CODR_NAME__', spec.name)
    .replace('__CODR_RET__', JSON.stringify(descriptor(ret)));
  // The participant's code is compiled on its own, so its line numbers are untouched.
  return `${PY_PRELUDE}__codr_src = ${JSON.stringify(code)}\nexec(compile(__codr_src, "main.py", "exec"))\n${driver}`;
}

// ------------------------------------------------------------------ JavaScript and TypeScript

const JS_DRIVER = String.raw`
function __codr_dec(v, t) {
  if (t === 'listnode') {
    let head = null;
    for (let i = v.length - 1; i >= 0; i--) head = new ListNode(v[i], head);
    return head;
  }
  if (t === 'treenode') {
    if (!v.length || v[0] === null) return null;
    const root = new TreeNode(v[0]);
    const queue = [root];
    let h = 0, i = 1;
    while (h < queue.length && i < v.length) {
      const node = queue[h++];
      if (i < v.length && v[i] !== null) { node.left = new TreeNode(v[i]); queue.push(node.left); }
      i++;
      if (i < v.length && v[i] !== null) { node.right = new TreeNode(v[i]); queue.push(node.right); }
      i++;
    }
    return root;
  }
  if (Array.isArray(t)) return v.map((x) => __codr_dec(x, t[1]));
  return v;
}
function __codr_enc(v, t) {
  if ((v === null || v === undefined) && t !== 'listnode' && t !== 'treenode') return null;
  if (t === 'listnode') {
    const out = [];
    while (v) { out.push(v.val); v = v.next; }
    return out;
  }
  if (t === 'treenode') {
    const out = [];
    const queue = [v];
    let h = 0;
    while (h < queue.length) {
      const node = queue[h++];
      if (!node) { out.push(null); continue; }
      out.push(node.val);
      queue.push(node.left, node.right);
    }
    while (out.length && out[out.length - 1] === null) out.pop();
    return out;
  }
  if (Array.isArray(t)) return v.map((x) => __codr_enc(x, t[1]));
  return v;
}
(function () {
  const lines = require("fs").readFileSync(0, "utf8").split("\n");
  const types = __CODR_TYPES__;
  const args = types.map((t, i) => __codr_dec(JSON.parse(lines[i]), t));
  const res = __CODR_NAME__(...args);
  console.log(JSON.stringify(__codr_enc(res, __CODR_RET__)));
})();
`;

const JS_CLASSES = `class ListNode { constructor(val, next) { this.val = val === undefined ? 0 : val; this.next = next === undefined ? null : next; } } class TreeNode { constructor(val, left, right) { this.val = val === undefined ? 0 : val; this.left = left === undefined ? null : left; this.right = right === undefined ? null : right; } } `;
const TS_CLASSES = `class ListNode { val: number; next: ListNode | null; constructor(val?: number, next?: ListNode | null) { this.val = val === undefined ? 0 : val; this.next = next === undefined ? null : next; } } class TreeNode { val: number; left: TreeNode | null; right: TreeNode | null; constructor(val?: number, left?: TreeNode | null, right?: TreeNode | null) { this.val = val === undefined ? 0 : val; this.left = left === undefined ? null : left; this.right = right === undefined ? null : right; } } `;

function wrapScript(spec: FunctionSpec, code: string, language: 'javascript' | 'typescript') {
  const { params, ret } = typesOf(spec);
  // The helper classes share the participant's first line, so their line numbers do not move.
  const classes = language === 'typescript' ? TS_CLASSES : JS_CLASSES;
  // TypeScript type-checks the driver too (loosely typed, bare tsc is not strict); spreading any[] needs a cast.
  const driver = (language === 'typescript' ? JS_DRIVER.replace('__CODR_NAME__(...args)', '(__CODR_NAME__ as any)(...args)') : JS_DRIVER)
    .replace('__CODR_TYPES__', JSON.stringify(params.map((p) => descriptor(p.type))))
    .replace('__CODR_NAME__', spec.name)
    .replace('__CODR_RET__', JSON.stringify(descriptor(ret)));
  return `${classes}${code}\n${driver}`;
}

// ------------------------------------------------------------------ C++

const CPP_PRELUDE = `#include <bits/stdc++.h>
using namespace std;
struct ListNode { int val; ListNode *next; ListNode() : val(0), next(nullptr) {} ListNode(int x) : val(x), next(nullptr) {} ListNode(int x, ListNode *next) : val(x), next(next) {} };
struct TreeNode { int val; TreeNode *left; TreeNode *right; TreeNode() : val(0), left(nullptr), right(nullptr) {} TreeNode(int x) : val(x), left(nullptr), right(nullptr) {} TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {} };
#line 1
`;

const CPP_RUNTIME = String.raw`
struct CodrJ { char t = 'n'; bool b = false; string s; vector<CodrJ> a; };
static void codr_ws(const string& x, size_t& i) { while (i < x.size() && isspace((unsigned char)x[i])) i++; }
static void codr_utf8(string& o, unsigned c) {
  if (c < 0x80) o += (char)c;
  else if (c < 0x800) { o += (char)(0xC0 | (c >> 6)); o += (char)(0x80 | (c & 63)); }
  else if (c < 0x10000) { o += (char)(0xE0 | (c >> 12)); o += (char)(0x80 | ((c >> 6) & 63)); o += (char)(0x80 | (c & 63)); }
  else { o += (char)(0xF0 | (c >> 18)); o += (char)(0x80 | ((c >> 12) & 63)); o += (char)(0x80 | ((c >> 6) & 63)); o += (char)(0x80 | (c & 63)); }
}
static CodrJ codr_val(const string& x, size_t& i) {
  codr_ws(x, i);
  CodrJ j;
  char c = x[i];
  if (c == '[') {
    i++; j.t = 'a'; codr_ws(x, i);
    if (x[i] == ']') { i++; return j; }
    for (;;) { j.a.push_back(codr_val(x, i)); codr_ws(x, i); if (x[i] == ',') { i++; continue; } i++; break; }
    return j;
  }
  if (c == '"') {
    i++; j.t = 's';
    while (x[i] != '"') {
      if (x[i] == '\\') {
        i++; char e = x[i++];
        if (e == 'n') j.s += '\n'; else if (e == 't') j.s += '\t'; else if (e == 'r') j.s += '\r'; else if (e == 'b') j.s += '\b'; else if (e == 'f') j.s += '\f';
        else if (e == 'u') {
          unsigned u = stoul(x.substr(i, 4), nullptr, 16); i += 4;
          if (u >= 0xD800 && u < 0xDC00 && x[i] == '\\' && x[i + 1] == 'u') { unsigned lo = stoul(x.substr(i + 2, 4), nullptr, 16); i += 6; u = 0x10000 + ((u - 0xD800) << 10) + (lo - 0xDC00); }
          codr_utf8(j.s, u);
        } else j.s += e;
      } else j.s += x[i++];
    }
    i++; return j;
  }
  if (x.compare(i, 4, "true") == 0) { i += 4; j.t = 'b'; j.b = true; return j; }
  if (x.compare(i, 5, "false") == 0) { i += 5; j.t = 'b'; return j; }
  if (x.compare(i, 4, "null") == 0) { i += 4; return j; }
  size_t st = i;
  while (i < x.size() && (isdigit((unsigned char)x[i]) || x[i] == '-' || x[i] == '+' || x[i] == '.' || x[i] == 'e' || x[i] == 'E')) i++;
  j.t = 'd'; j.s = x.substr(st, i - st);
  return j;
}
static void codr_dec(const CodrJ& j, int& v) { v = (int)stoll(j.s); }
static void codr_dec(const CodrJ& j, long long& v) { v = stoll(j.s); }
static void codr_dec(const CodrJ& j, double& v) { v = stod(j.s); }
static void codr_dec(const CodrJ& j, bool& v) { v = j.b; }
static void codr_dec(const CodrJ& j, string& v) { v = j.s; }
template <class T> static void codr_dec(const CodrJ& j, vector<T>& v) { v.clear(); for (auto& e : j.a) { T t; codr_dec(e, t); v.push_back(std::move(t)); } }
static void codr_dec(const CodrJ& j, ListNode*& p) { p = nullptr; for (size_t k = j.a.size(); k-- > 0;) { ListNode* n = new ListNode((int)stoll(j.a[k].s)); n->next = p; p = n; } }
static void codr_dec(const CodrJ& j, TreeNode*& root) {
  root = nullptr;
  if (j.a.empty() || j.a[0].t == 'n') return;
  root = new TreeNode((int)stoll(j.a[0].s));
  queue<TreeNode*> q; q.push(root);
  size_t i = 1;
  while (!q.empty() && i < j.a.size()) {
    TreeNode* n = q.front(); q.pop();
    if (i < j.a.size()) { if (j.a[i].t != 'n') { n->left = new TreeNode((int)stoll(j.a[i].s)); q.push(n->left); } i++; }
    if (i < j.a.size()) { if (j.a[i].t != 'n') { n->right = new TreeNode((int)stoll(j.a[i].s)); q.push(n->right); } i++; }
  }
}
static void codr_enc(string& o, bool v) { o += v ? "true" : "false"; }
static void codr_enc(string& o, int v) { o += to_string(v); }
static void codr_enc(string& o, long long v) { o += to_string(v); }
static void codr_enc(string& o, double v) { char b[40]; for (int p = 15; p <= 17; p++) { snprintf(b, sizeof b, "%.*g", p, v); if (strtod(b, nullptr) == v) break; } o += b; }
static void codr_enc(string& o, const string& v) {
  o += '"';
  for (unsigned char c : v) {
    if (c == '"') o += "\\\""; else if (c == '\\') o += "\\\\"; else if (c == '\n') o += "\\n"; else if (c == '\r') o += "\\r"; else if (c == '\t') o += "\\t"; else if (c == '\b') o += "\\b"; else if (c == '\f') o += "\\f";
    else if (c < 0x20) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += (char)c;
  }
  o += '"';
}
template <class T> static void codr_enc(string& o, const vector<T>& v) { o += '['; for (size_t k = 0; k < v.size(); k++) { if (k) o += ','; codr_enc(o, v[k]); } o += ']'; }
static void codr_enc(string& o, ListNode* p) { o += '['; for (bool first = true; p; p = p->next, first = false) { if (!first) o += ','; o += to_string(p->val); } o += ']'; }
static void codr_enc(string& o, TreeNode* root) {
  vector<TreeNode*> q{root};
  vector<string> out;
  for (size_t h = 0; h < q.size(); h++) {
    if (!q[h]) { out.push_back("null"); continue; }
    out.push_back(to_string(q[h]->val));
    q.push_back(q[h]->left); q.push_back(q[h]->right);
  }
  while (!out.empty() && out.back() == "null") out.pop_back();
  o += '[';
  for (size_t k = 0; k < out.size(); k++) { if (k) o += ','; o += out[k]; }
  o += ']';
}
`;

function cppType(t: TypeNode, wide: boolean): string {
  switch (t.k) {
    case 'int':
      return wide ? 'long long' : 'int';
    case 'float':
      return 'double';
    case 'str':
      return 'string';
    case 'bool':
      return 'bool';
    case 'listnode':
      return 'ListNode*';
    case 'treenode':
      return 'TreeNode*';
    case 'list':
      return `vector<${cppType(t.of, wide)}>`;
  }
}

function wrapCpp(spec: FunctionSpec, code: string) {
  const { params, ret } = typesOf(spec);
  const wide = !!spec.wide;
  const reads = params
    .map((p, i) => `  ${cppType(p.type, wide)} a${i}; { CodrJ j = codr_val(in, pos); codr_dec(j, a${i}); }`)
    .join('\n');
  const main = `
int main() {
  ios::sync_with_stdio(false);
  string in((istreambuf_iterator<char>(cin)), istreambuf_iterator<char>());
  size_t pos = 0;
${reads}
  ${cppType(ret, wide)} res = Solution().${spec.name}(${params.map((_, i) => `a${i}`).join(', ')});
  string out;
  codr_enc(out, res);
  out += '\\n';
  fwrite(out.data(), 1, out.size(), stdout);
  return 0;
}
`;
  return `${CPP_PRELUDE}${code}\n${CPP_RUNTIME}${main}`;
}

// ------------------------------------------------------------------ Java

const JAVA_CLASSES = String.raw`
class ListNode { int val; ListNode next; ListNode() {} ListNode(int val) { this.val = val; } ListNode(int val, ListNode next) { this.val = val; this.next = next; } }
class TreeNode { int val; TreeNode left; TreeNode right; TreeNode() {} TreeNode(int val) { this.val = val; } TreeNode(int val, TreeNode left, TreeNode right) { this.val = val; this.left = left; this.right = right; } }
`;

const JAVA_RUNTIME = String.raw`
class CodrJ {
  char t = 'n'; boolean b; String s = ""; ArrayList<CodrJ> a = new ArrayList<>();
  static int pos;
  static void ws(String x) { while (pos < x.length() && Character.isWhitespace(x.charAt(pos))) pos++; }
  static CodrJ val(String x) {
    ws(x);
    CodrJ j = new CodrJ();
    char c = x.charAt(pos);
    if (c == '[') {
      pos++; j.t = 'a'; ws(x);
      if (x.charAt(pos) == ']') { pos++; return j; }
      for (;;) { j.a.add(val(x)); ws(x); if (x.charAt(pos) == ',') { pos++; continue; } pos++; break; }
      return j;
    }
    if (c == '"') {
      pos++; j.t = 's';
      StringBuilder sb = new StringBuilder();
      while (x.charAt(pos) != '"') {
        char ch = x.charAt(pos++);
        if (ch == '\\') {
          char e = x.charAt(pos++);
          if (e == 'n') sb.append('\n'); else if (e == 't') sb.append('\t'); else if (e == 'r') sb.append('\r'); else if (e == 'b') sb.append('\b'); else if (e == 'f') sb.append('\f');
          else if (e == 'u') { sb.append((char) Integer.parseInt(x.substring(pos, pos + 4), 16)); pos += 4; }
          else sb.append(e);
        } else sb.append(ch);
      }
      pos++; j.s = sb.toString(); return j;
    }
    if (x.startsWith("true", pos)) { pos += 4; j.t = 'b'; j.b = true; return j; }
    if (x.startsWith("false", pos)) { pos += 5; j.t = 'b'; return j; }
    if (x.startsWith("null", pos)) { pos += 4; return j; }
    int st = pos;
    while (pos < x.length() && "0123456789+-.eE".indexOf(x.charAt(pos)) >= 0) pos++;
    j.t = 'd'; j.s = x.substring(st, pos);
    return j;
  }
  static ListNode decLn(CodrJ j) { ListNode p = null; for (int k = j.a.size() - 1; k >= 0; k--) { ListNode n = new ListNode(Integer.parseInt(j.a.get(k).s)); n.next = p; p = n; } return p; }
  static TreeNode decTn(CodrJ j) {
    if (j.a.isEmpty() || j.a.get(0).t == 'n') return null;
    TreeNode root = new TreeNode(Integer.parseInt(j.a.get(0).s));
    ArrayDeque<TreeNode> q = new ArrayDeque<>(); q.add(root);
    int i = 1;
    while (!q.isEmpty() && i < j.a.size()) {
      TreeNode n = q.poll();
      if (i < j.a.size()) { if (j.a.get(i).t != 'n') { n.left = new TreeNode(Integer.parseInt(j.a.get(i).s)); q.add(n.left); } i++; }
      if (i < j.a.size()) { if (j.a.get(i).t != 'n') { n.right = new TreeNode(Integer.parseInt(j.a.get(i).s)); q.add(n.right); } i++; }
    }
    return root;
  }
  static void encLn(StringBuilder sb, ListNode p) { sb.append('['); for (boolean first = true; p != null; p = p.next, first = false) { if (!first) sb.append(','); sb.append(p.val); } sb.append(']'); }
  static void encTn(StringBuilder sb, TreeNode root) {
    ArrayList<TreeNode> q = new ArrayList<>(); q.add(root);
    ArrayList<String> out = new ArrayList<>();
    for (int h = 0; h < q.size(); h++) {
      TreeNode n = q.get(h);
      if (n == null) { out.add("null"); continue; }
      out.add(String.valueOf(n.val)); q.add(n.left); q.add(n.right);
    }
    while (!out.isEmpty() && out.get(out.size() - 1).equals("null")) out.remove(out.size() - 1);
    sb.append('[').append(String.join(",", out)).append(']');
  }
  static void encStr(StringBuilder sb, String v) {
    sb.append('"');
    for (int k = 0; k < v.length(); k++) {
      char c = v.charAt(k);
      if (c == '"') sb.append("\\\""); else if (c == '\\') sb.append("\\\\"); else if (c == '\n') sb.append("\\n"); else if (c == '\r') sb.append("\\r"); else if (c == '\t') sb.append("\\t"); else if (c == '\b') sb.append("\\b"); else if (c == '\f') sb.append("\\f");
      else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
      else sb.append(c);
    }
    sb.append('"');
  }
}
`;

function javaType(t: TypeNode, wide: boolean): string {
  switch (t.k) {
    case 'int':
      return wide ? 'long' : 'int';
    case 'float':
      return 'double';
    case 'str':
      return 'String';
    case 'bool':
      return 'boolean';
    case 'listnode':
      return 'ListNode';
    case 'treenode':
      return 'TreeNode';
    case 'list':
      return `${javaType(t.of, wide)}[]`;
  }
}

const mangle = (t: TypeNode): string => (t.k === 'list' ? `a${mangle(t.of)}` : t.k);

/** Static decode and encode methods for a type and the types nested in it, memoised by name. */
function javaCodec(t: TypeNode, wide: boolean, out: Map<string, string>) {
  const name = mangle(t);
  if (out.has(`d_${name}`)) return;
  out.set(`d_${name}`, '');
  const jt = javaType(t, wide);
  if (t.k === 'list') {
    javaCodec(t.of, wide, out);
    const elem = javaType(t.of, wide);
    const base = elem.replace(/(\[\])+$/, '');
    const dims = elem.slice(base.length);
    out.set(
      `d_${name}`,
      `static ${jt} d_${name}(CodrJ j) { ${jt} r = new ${base}[j.a.size()]${dims}; for (int i = 0; i < r.length; i++) r[i] = d_${mangle(t.of)}(j.a.get(i)); return r; }`,
    );
    out.set(`e_${name}`, `static void e_${name}(StringBuilder sb, ${jt} v) { if (v == null) { sb.append("null"); return; } sb.append('['); for (int i = 0; i < v.length; i++) { if (i > 0) sb.append(','); e_${mangle(t.of)}(sb, v[i]); } sb.append(']'); }`);
    return;
  }
  const dec: Record<string, string> = {
    int: wide ? 'Long.parseLong(j.s)' : 'Integer.parseInt(j.s)',
    float: 'Double.parseDouble(j.s)',
    str: 'j.s',
    bool: 'j.b',
    listnode: 'CodrJ.decLn(j)',
    treenode: 'CodrJ.decTn(j)',
  };
  const enc: Record<string, string> = {
    int: 'sb.append(v);',
    float: 'sb.append(Double.toString(v));',
    str: 'if (v == null) sb.append("null"); else CodrJ.encStr(sb, v);',
    bool: 'sb.append(v ? "true" : "false");',
    listnode: 'CodrJ.encLn(sb, v);',
    treenode: 'CodrJ.encTn(sb, v);',
  };
  out.set(`d_${name}`, `static ${jt} d_${name}(CodrJ j) { return ${dec[t.k]}; }`);
  out.set(`e_${name}`, `static void e_${name}(StringBuilder sb, ${jt} v) { ${enc[t.k]} }`);
}

function wrapJava(spec: FunctionSpec, code: string) {
  const { params, ret } = typesOf(spec);
  const wide = !!spec.wide;
  const methods = new Map<string, string>();
  for (const t of [...params.map((p) => p.type), ret]) javaCodec(t, wide, methods);
  const reads = params.map((p, i) => `    ${javaType(p.type, wide)} a${i} = d_${mangle(p.type)}(CodrJ.val(in));`).join('\n');
  const main = `public class Main {
  ${[...methods.values()].join('\n  ')}
  public static void main(String[] args) throws Exception {
    String in = new String(System.in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
${reads}
    ${javaType(ret, wide)} res = new Solution().${spec.name}(${params.map((_, i) => `a${i}`).join(', ')});
    StringBuilder sb = new StringBuilder();
    e_${mangle(ret)}(sb, res);
    sb.append('\\n');
    java.io.PrintStream ps = new java.io.PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.out), false, "UTF-8");
    ps.print(sb);
    ps.flush();
  }
}
`;
  // The runner (java Main.java) starts the first class in the file, so Main comes first. All of it shares the
  // participant's first line (nothing here has a line comment), so their line numbers do not move.
  const oneLine = `${main}${JAVA_RUNTIME}${JAVA_CLASSES}`.replace(/\s*\n\s*/g, ' ');
  return `import java.util.*; ${oneLine} ${code}`;
}

// ------------------------------------------------------------------ Public API

/** The complete program for a participant's (or the reference) code, ready for the runner. */
export function wrapSource(spec: FunctionSpec, language: LanguageId, code: string): string {
  switch (language) {
    case 'python':
      return wrapPython(spec, code);
    case 'javascript':
    case 'typescript':
      return wrapScript(spec, code, language);
    case 'cpp':
      return wrapCpp(spec, code);
    case 'java':
      return wrapJava(spec, code);
    default:
      throw new Error(`Function-style questions do not support ${language}.`);
  }
}

/** What the runner executes: the code itself, or for function-style questions the code inside its driver. */
export function programSource(spec: FunctionSpec | null | undefined, language: LanguageId, code: string): string {
  return spec ? wrapSource(spec, language, code) : code;
}

// ------------------------------------------------------------------ Starter code

const RESERVED = new Set([
  'abstract', 'assert', 'auto', 'bool', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'delete', 'do', 'double',
  'else', 'enum', 'export', 'extends', 'extern', 'final', 'finally', 'float', 'for', 'function', 'goto', 'if', 'implements', 'import', 'inline', 'instanceof',
  'int', 'interface', 'let', 'long', 'namespace', 'native', 'new', 'package', 'private', 'protected', 'public', 'register', 'return', 'short', 'signed', 'sizeof',
  'static', 'struct', 'super', 'switch', 'synchronized', 'template', 'this', 'throw', 'throws', 'try', 'typedef', 'union', 'unsigned', 'var', 'virtual', 'void',
  'volatile', 'while', 'with', 'yield',
]);
const safe = (name: string) => (RESERVED.has(name) ? `${name}_` : name);

const CPP_LIST_DOC = `/**
 * Definition for singly-linked list.
 * struct ListNode {
 *     int val;
 *     ListNode *next;
 *     ListNode() : val(0), next(nullptr) {}
 *     ListNode(int x) : val(x), next(nullptr) {}
 *     ListNode(int x, ListNode *next) : val(x), next(next) {}
 * };
 */
`;
const CPP_TREE_DOC = `/**
 * Definition for a binary tree node.
 * struct TreeNode {
 *     int val;
 *     TreeNode *left;
 *     TreeNode *right;
 *     TreeNode() : val(0), left(nullptr), right(nullptr) {}
 *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
 *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
 * };
 */
`;
const JAVA_LIST_DOC = `/**
 * Definition for singly-linked list.
 * public class ListNode {
 *     int val;
 *     ListNode next;
 *     ListNode() {}
 *     ListNode(int val) { this.val = val; }
 *     ListNode(int val, ListNode next) { this.val = val; this.next = next; }
 * }
 */
`;
const JAVA_TREE_DOC = `/**
 * Definition for a binary tree node.
 * public class TreeNode {
 *     int val;
 *     TreeNode left;
 *     TreeNode right;
 *     TreeNode() {}
 *     TreeNode(int val) { this.val = val; }
 *     TreeNode(int val, TreeNode left, TreeNode right) { this.val = val; this.left = left; this.right = right; }
 * }
 */
`;
const JS_LIST_DOC = `/**
 * Definition for singly-linked list.
 * function ListNode(val, next) {
 *     this.val = (val===undefined ? 0 : val)
 *     this.next = (next===undefined ? null : next)
 * }
 */
`;
const JS_TREE_DOC = `/**
 * Definition for a binary tree node.
 * function TreeNode(val, left, right) {
 *     this.val = (val===undefined ? 0 : val)
 *     this.left = (left===undefined ? null : left)
 *     this.right = (right===undefined ? null : right)
 * }
 */
`;

function tsType(t: TypeNode): string {
  switch (t.k) {
    case 'int':
    case 'float':
      return 'number';
    case 'str':
      return 'string';
    case 'bool':
      return 'boolean';
    case 'listnode':
      return 'ListNode | null';
    case 'treenode':
      return 'TreeNode | null';
    case 'list':
      return t.of.k === 'listnode' || t.of.k === 'treenode' ? `(${tsType(t.of)})[]` : `${tsType(t.of)}[]`;
  }
}

/** The method stub shown in the editor for a function-style question; null for languages the wrappers cannot drive. */
export function starterFor(spec: FunctionSpec, language: LanguageId): string | null {
  if (!isFunctionLanguage(language)) return null;
  const { params, ret } = typesOf(spec);
  const all = [...params.map((p) => p.type), ret];
  const list = all.some(usesList);
  const tree = all.some(usesTree);
  switch (language) {
    case 'python': {
      const docs = [
        list ? '# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\n' : '',
        tree ? '# Definition for a binary tree node.\n# class TreeNode:\n#     def __init__(self, val=0, left=None, right=None):\n#         self.val = val\n#         self.left = left\n#         self.right = right\n' : '',
      ].join('');
      const args = ['self', ...params.map((p) => `${p.name}: ${p.written}`)].join(', ');
      return `${docs}class Solution:\n    def ${spec.name}(${args}) -> ${spec.returnType}:\n        \n`;
    }
    case 'cpp': {
      const args = params.map((p) => `${cppType(p.type, !!spec.wide)}${p.type.k === 'list' ? '&' : ''} ${safe(p.name)}`).join(', ');
      return `${list ? CPP_LIST_DOC : ''}${tree ? CPP_TREE_DOC : ''}class Solution {\npublic:\n    ${cppType(ret, !!spec.wide)} ${spec.name}(${args}) {\n        \n    }\n};\n`;
    }
    case 'java': {
      const args = params.map((p) => `${javaType(p.type, !!spec.wide)} ${safe(p.name)}`).join(', ');
      return `${list ? JAVA_LIST_DOC : ''}${tree ? JAVA_TREE_DOC : ''}class Solution {\n    public ${javaType(ret, !!spec.wide)} ${spec.name}(${args}) {\n        \n    }\n}\n`;
    }
    case 'javascript':
      return `${list ? JS_LIST_DOC : ''}${tree ? JS_TREE_DOC : ''}/**\n${params.map((p) => ` * @param {${jsDocType(p.type)}} ${p.name}\n`).join('')} * @return {${jsDocType(ret)}}\n */\nvar ${spec.name} = function(${params.map((p) => p.name).join(', ')}) {\n    \n};\n`;
    case 'typescript':
      return `${list ? JS_LIST_DOC : ''}${tree ? JS_TREE_DOC : ''}function ${spec.name}(${params.map((p) => `${safe(p.name)}: ${tsType(p.type)}`).join(', ')}): ${tsType(ret)} {\n    \n};\n`;
  }
}

function jsDocType(t: TypeNode): string {
  switch (t.k) {
    case 'int':
    case 'float':
      return 'number';
    case 'str':
      return 'string';
    case 'bool':
      return 'boolean';
    case 'listnode':
      return 'ListNode';
    case 'treenode':
      return 'TreeNode';
    case 'list':
      return `${jsDocType(t.of)}[]`;
  }
}
