// Language catalog shared by the server (runner mapping, limits) and the web
// client (labels, Monaco modes, starter templates). Engine-specific details for
// Piston live next to the generic fields so a different Runner can ignore them.

export const LANGUAGE_IDS = ['cpp', 'c', 'python', 'java', 'javascript', 'go', 'rust'] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

export interface LanguageInfo {
  id: LanguageId;
  label: string;
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
    label: 'JavaScript (Node.js)',
    monaco: 'javascript',
    timeMultiplier: 2,
    memoryMultiplier: 1.5,
    timeOverheadMs: 0,
    piston: { language: 'javascript', package: 'node', fileName: 'main.js' },
    hello: 'const s = require("fs").readFileSync(0, "utf8").split("\\n")[0];\nconsole.log("hello " + s);\n',
    template: 'const input = require("fs").readFileSync(0, "utf8").trim().split(/\\s+/);\n\n',
  },
  go: {
    id: 'go',
    label: 'Go',
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
    monaco: 'rust',
    timeMultiplier: 1,
    memoryMultiplier: 1,
    timeOverheadMs: 0,
    piston: { language: 'rust', package: 'rust', fileName: 'main.rs' },
    hello: 'use std::io;\nfn main() {\n    let mut s = String::new();\n    io::stdin().read_line(&mut s).unwrap();\n    println!("hello {}", s.trim());\n}\n',
    template: 'use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n}\n',
  },
};

/** Languages installed by the default runner setup. */
export const DEFAULT_LANGUAGES: LanguageId[] = ['cpp', 'c', 'python', 'java', 'javascript'];

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
