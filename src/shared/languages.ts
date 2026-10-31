// Language catalog shared by the server (runner mapping, limits) and the web
// client (labels, Monaco modes, starter templates). Engine-specific details for
// Piston live next to the generic fields so a different Runner can ignore them.

export const LANGUAGE_IDS = ['cpp', 'c', 'python', 'java', 'javascript', 'typescript', 'go', 'rust', 'zig'] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

export interface LanguageInfo {
  id: LanguageId;
  label: string;
  /** Compiler or runtime named next to the installed version, e.g. "gcc" in "C++17 (gcc 10.2.0)". */
  toolchain: string;
  /** Monaco language id used for syntax highlighting. */
  monaco: string;
  /** Default multipliers applied to a question's limits unless it overrides them. */
  timeMultiplier: number;
  memoryMultiplier: number;
  /** Fixed CPU allowance added to the limit, e.g. for start-up work counted as run time. */
  timeOverheadMs: number;
  /** Piston runtime language name and the package that provides it. */
  piston: { language: string; package: string; fileName: string };
  /** Small program that echoes "hello <first input line>", used by the runner check. */
  hello: string;
  /** Skeleton shown in the editor when a question has no starter code. */
  template: string;
}

export const LANGUAGES: Record<LanguageId, LanguageInfo> = {
  cpp: {
    id: 'cpp',
    label: 'C++17',
    toolchain: 'gcc',
    monaco: 'cpp',
    timeMultiplier: 1,
    memoryMultiplier: 1,
    timeOverheadMs: 0,
    piston: { language: 'c++', package: 'gcc', fileName: 'main.cpp' },
    hello: '#include <iostream>\n#include <string>\nint main() {\n  std::string s;\n  std::getline(std::cin, s);\n  std::cout << "hello " << s << "\\n";\n}\n',
    template:
      '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}\n',
  },
  c: {
    id: 'c',
    label: 'C11',
    toolchain: 'gcc',
    monaco: 'c',
    timeMultiplier: 1,
    memoryMultiplier: 1,
    timeOverheadMs: 0,
    piston: { language: 'c', package: 'gcc', fileName: 'main.c' },
    hello: '#include <stdio.h>\nint main(void) {\n  char s[256] = {0};\n  if (scanf("%255s", s) != 1) return 1;\n  printf("hello %s\\n", s);\n  return 0;\n}\n',
    template: '#include <stdio.h>\n\nint main(void) {\n\n    return 0;\n}\n',
  },
  python: {
    id: 'python',
    label: 'Python 3',
    toolchain: 'CPython',
    monaco: 'python',
    timeMultiplier: 3,
    memoryMultiplier: 1.5,
    timeOverheadMs: 0,
    piston: { language: 'python', package: 'python', fileName: 'main.py' },
    hello: 'print("hello " + input())\n',
    template: 'import sys\n\ndef main():\n    data = sys.stdin.read().split()\n\n\nmain()\n',
  },
  java: {
    id: 'java',
    label: 'Java',
    toolchain: 'OpenJDK',
    monaco: 'java',
    timeMultiplier: 2,
    memoryMultiplier: 2,
    timeOverheadMs: 1500,
    // Piston's Java runtime appends ".java" to the first file name itself.
    piston: { language: 'java', package: 'java', fileName: 'Main' },
    hello:
      'import java.util.Scanner;\n\npublic class Main {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    System.out.println("hello " + sc.nextLine());\n  }\n}\n',
    template:
      'import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));\n\n    }\n}\n',
  },
  javascript: {
    id: 'javascript',
    label: 'JavaScript',
    toolchain: 'Node.js',
    monaco: 'javascript',
    timeMultiplier: 2,
    memoryMultiplier: 1.5,
    timeOverheadMs: 0,
    piston: { language: 'javascript', package: 'node', fileName: 'main.js' },
    hello: 'const s = require("fs").readFileSync(0, "utf8").split("\\n")[0];\nconsole.log("hello " + s);\n',
    template: 'const input = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/);\n\n',
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    toolchain: 'tsc',
    monaco: 'typescript',
    // Compiled by tsc in its own stage (not counted against the limit), then run by Node.js like JavaScript.
    timeMultiplier: 2,
    memoryMultiplier: 1.5,
    timeOverheadMs: 0,
    // Piston's typescript package compiles with tsc and runs the output on its bundled Node.js;
    // runner/Dockerfile overrides its compile step (ES2022 target, Node.js globals declared).
    piston: { language: 'typescript', package: 'typescript', fileName: 'main' },
    hello: 'const s: string = require("fs").readFileSync(0, "utf8").split("\\n")[0];\nconsole.log("hello " + s);\n',
    template: 'const input: string[] = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/);\n\n',
  },
  go: {
    id: 'go',
    label: 'Go',
    toolchain: 'go',
    monaco: 'go',
    timeMultiplier: 1.5,
    memoryMultiplier: 1.5,
    timeOverheadMs: 0,
    piston: { language: 'go', package: 'go', fileName: 'main.go' },
    hello: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tvar s string\n\tfmt.Scan(&s)\n\tfmt.Println("hello " + s)\n}\n',
    template: 'package main\n\nimport (\n\t"bufio"\n\t"fmt"\n\t"os"\n)\n\nfunc main() {\n\tin := bufio.NewReader(os.Stdin)\n\t_ = in\n\tfmt.Println()\n}\n',
  },
  rust: {
    id: 'rust',
    label: 'Rust',
    toolchain: 'rustc',
    monaco: 'rust',
    timeMultiplier: 1,
    memoryMultiplier: 1,
    timeOverheadMs: 0,
    piston: { language: 'rust', package: 'rust', fileName: 'main.rs' },
    hello: 'use std::io;\nfn main() {\n    let mut s = String::new();\n    io::stdin().read_line(&mut s).unwrap();\n    println!("hello {}", s.trim());\n}\n',
    template: 'use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n}\n',
  },
  zig: {
    id: 'zig',
    label: 'Zig',
    toolchain: 'zig',
    monaco: 'zig',
    timeMultiplier: 1,
    memoryMultiplier: 1,
    timeOverheadMs: 0,
    piston: { language: 'zig', package: 'zig', fileName: 'main.zig' },
    hello:
      'const std = @import("std");\n\npub fn main() !void {\n    var buf: [256]u8 = undefined;\n    const line = (try std.io.getStdIn().reader().readUntilDelimiterOrEof(&buf, \'\\n\')) orelse "";\n    try std.io.getStdOut().writer().print("hello {s}\\n", .{line});\n}\n',
    template:
      'const std = @import("std");\n\npub fn main() !void {\n    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);\n    defer arena.deinit();\n    const input = try std.io.getStdIn().reader().readAllAlloc(arena.allocator(), 1 << 30);\n    var tokens = std.mem.tokenize(u8, input, " \\t\\r\\n");\n    _ = tokens;\n\n    var out = std.io.bufferedWriter(std.io.getStdOut().writer());\n    defer out.flush() catch {};\n    const w = out.writer();\n    _ = w;\n}\n',
  },
};

/** Languages installed by the default runner setup. */
export const DEFAULT_LANGUAGES: LanguageId[] = ['cpp', 'c', 'python', 'java', 'javascript', 'typescript', 'zig'];

/**
 * How a language is named everywhere in the UI: "C++17 (gcc 10.2.0)". The
 * version is whatever the runner has installed; without it (runner
 * unreachable) the label still names the toolchain: "C++17 (gcc)".
 */
export function languageLabel(language: LanguageId, version?: string | null) {
  const info = LANGUAGES[language];
  return `${info.label} (${info.toolchain}${version ? ` ${version}` : ''})`;
}

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === 'string' && (LANGUAGE_IDS as readonly string[]).includes(value);
}

export interface LanguageLimitOverride {
  time?: number;
  memory?: number;
}

/** Effective limits for one language: question limits times the language multiplier. */
export function effectiveLimits(
  base: { timeLimitMs: number; memoryLimitMb: number },
  language: LanguageId,
  overrides: Partial<Record<LanguageId, LanguageLimitOverride>> = {},
): { timeLimitMs: number; memoryLimitMb: number } {
  const info = LANGUAGES[language];
  const o = overrides[language] ?? {};
  // Capped at what the runner is configured to accept (docker-compose.yml).
  return {
    timeLimitMs: Math.min(20_000, Math.round(base.timeLimitMs * (o.time ?? info.timeMultiplier) + info.timeOverheadMs)),
    memoryLimitMb: Math.min(2048, Math.round(base.memoryLimitMb * (o.memory ?? info.memoryMultiplier))),
  };
}
