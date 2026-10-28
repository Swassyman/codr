import type { CheckerConfig, Difficulty, Sample } from '../../shared/types';

/** Deterministic PRNG so seeded tests are identical on every machine. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedQuestion {
  slug: string;
  title: string;
  difficulty: Difficulty;
  rating: number;
  tags: string[];
  statement: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string[];
  samples: Sample[];
  notes: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  checker: CheckerConfig;
  /** Python 3 reference solution, validated on the runner after first boot. */
  reference: string;
  /** Test inputs and the JS reference that produces expected outputs. */
  inputs: () => string[];
  solve: (input: string) => string;
}

const ints = (s: string) => s.trim().split(/\s+/);

// ---------------------------------------------------------------- 1. Sum

const sum: SeedQuestion = {
  slug: 'sum-of-two-numbers',
  title: 'Sum of Two Numbers',
  difficulty: 'easy',
  rating: 800,
  tags: ['math', 'implementation'],
  statement: 'You are given two integers $a$ and $b$. Print their sum.\n\nThe numbers can be large, so think about which integer type your language uses.',
  inputFormat: 'A single line with two integers $a$ and $b$ separated by a space.',
  outputFormat: 'Print one integer: $a + b$.',
  constraints: ['-10^{18} \\le a, b \\le 10^{18}'],
  samples: [
    { input: '3 4\n', output: '7\n', explanation: '$3 + 4 = 7$.' },
    { input: '1000000000000 -1\n', output: '999999999999\n' },
  ],
  notes: '',
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  checker: { type: 'trim' },
  reference: 'a, b = map(int, input().split())\nprint(a + b)\n',
  inputs: () => {
    const rnd = mulberry32(11);
    const big = () => BigInt(Math.floor(rnd() * 1e9)) * 1_000_000_000n + BigInt(Math.floor(rnd() * 1e9)) * (rnd() < 0.5 ? -1n : 1n);
    const list = ['0 0\n', '1000000000000000000 1000000000000000000\n', '-1000000000000000000 -1000000000000000000\n', '-7 7\n'];
    for (let i = 0; i < 4; i++) list.push(`${big()} ${big()}\n`);
    return list;
  },
  solve: (input) => {
    const [a, b] = ints(input).map(BigInt);
    return `${a! + b!}\n`;
  },
};

// ---------------------------------------------------------------- 2. Average

const average: SeedQuestion = {
  slug: 'average-of-a-list',
  title: 'Average of a List',
  difficulty: 'easy',
  rating: 900,
  tags: ['math'],
  statement: 'Given $n$ integers, print their average (arithmetic mean).',
  inputFormat: 'The first line contains $n$. The second line contains $n$ integers $x_1, x_2, \\ldots, x_n$.',
  outputFormat: 'Print the average. Answers within an absolute or relative error of $10^{-6}$ are accepted.',
  constraints: ['1 \\le n \\le 10^5', '|x_i| \\le 10^9'],
  samples: [
    { input: '4\n1 2 3 4\n', output: '2.500000000\n', explanation: '$(1 + 2 + 3 + 4) / 4 = 2.5$.' },
    { input: '3\n-1 0 2\n', output: '0.333333333\n' },
  ],
  notes: 'This question is checked with a tolerance, so any number of decimal places works as long as the value is close enough.',
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  checker: { type: 'float', epsilon: 1e-6 },
  reference: 'import sys\n\ndata = sys.stdin.read().split()\nn = int(data[0])\nprint(f"{sum(map(int, data[1:1 + n])) / n:.9f}")\n',
  inputs: () => {
    const rnd = mulberry32(22);
    const list = ['1\n-1000000000\n', '5\n1 1 1 1 2\n'];
    for (const n of [10, 1000, 100000]) {
      const xs = Array.from({ length: n }, () => Math.floor(rnd() * 2e9) - 1e9);
      list.push(`${n}\n${xs.join(' ')}\n`);
    }
    return list;
  },
  solve: (input) => {
    const t = ints(input);
    const n = Number(t[0]);
    let s = 0n;
    for (let i = 1; i <= n; i++) s += BigInt(t[i]!);
    return `${(Number(s) / n).toFixed(9)}\n`;
  },
};

// ---------------------------------------------------------------- 3. Islands

function islands(input: string) {
  const lines = input.trim().split('\n');
  const [n, m] = lines[0]!.split(' ').map(Number) as [number, number];
  const grid = lines.slice(1, 1 + n).join('');
  const seen = new Uint8Array(n * m);
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < n * m; start++) {
    if (grid[start] !== '#' || seen[start]) continue;
    count++;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const cell = stack.pop()!;
      const r = Math.floor(cell / m);
      const c = cell % m;
      const next = [r > 0 ? cell - m : -1, r < n - 1 ? cell + m : -1, c > 0 ? cell - 1 : -1, c < m - 1 ? cell + 1 : -1];
      for (const x of next) {
        if (x >= 0 && !seen[x] && grid[x] === '#') {
          seen[x] = 1;
          stack.push(x);
        }
      }
    }
  }
  return `${count}\n`;
}

const islandsQ: SeedQuestion = {
  slug: 'counting-islands',
  title: 'Counting Islands',
  difficulty: 'medium',
  rating: 1300,
  tags: ['graphs', 'dfs and similar'],
  statement:
    'A map is a grid of $n$ rows and $m$ columns. Each cell is land (`#`) or water (`.`). Two land cells belong to the same island when you can walk from one to the other through land cells, moving up, down, left or right.\n\nCount the islands.',
  inputFormat: 'The first line contains $n$ and $m$. Each of the next $n$ lines contains $m$ characters, each `#` or `.`.',
  outputFormat: 'Print the number of islands.',
  constraints: ['1 \\le n, m \\le 1000'],
  samples: [
    { input: '4 5\n##..#\n#...#\n..#..\n.....\n', output: '3\n', explanation: 'The islands are the top-left group, the right column pair, and the single cell in the middle.' },
  ],
  notes: 'Recursion can overflow the stack on large maps; an explicit stack or queue is safer.',
  timeLimitMs: 2000,
  memoryLimitMb: 256,
  checker: { type: 'trim' },
  reference:
    'import sys\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n, m = int(data[0]), int(data[1])\n    grid = b"".join(data[2:2 + n])\n    seen = bytearray(n * m)\n    count = 0\n    for start in range(n * m):\n        if grid[start] != 35 or seen[start]:\n            continue\n        count += 1\n        seen[start] = 1\n        stack = [start]\n        while stack:\n            cell = stack.pop()\n            r, c = divmod(cell, m)\n            for x, ok in ((cell - m, r > 0), (cell + m, r < n - 1), (cell - 1, c > 0), (cell + 1, c < m - 1)):\n                if ok and not seen[x] and grid[x] == 35:\n                    seen[x] = 1\n                    stack.append(x)\n    print(count)\n\nmain()\n',
  inputs: () => {
    const rnd = mulberry32(33);
    const grid = (n: number, m: number, p: number) => {
      const rows = Array.from({ length: n }, () => Array.from({ length: m }, () => (rnd() < p ? '#' : '.')).join(''));
      return `${n} ${m}\n${rows.join('\n')}\n`;
    };
    return ['1 1\n.\n', '1 1\n#\n', '3 3\n#.#\n.#.\n#.#\n', grid(20, 30, 0.4), grid(200, 200, 0.45), grid(500, 500, 0.5), `2 4\n####\n####\n`];
  },
  solve: islands,
};

// ---------------------------------------------------------------- 4. Coins

function minCoins(input: string) {
  const t = ints(input).map(Number);
  const n = t[0]!;
  const x = t[1]!;
  const coins = t.slice(2, 2 + n);
  const INF = 1e9;
  const dp = new Array<number>(x + 1).fill(INF);
  dp[0] = 0;
  for (let v = 1; v <= x; v++) {
    for (const c of coins) if (c <= v && dp[v - c]! + 1 < dp[v]!) dp[v] = dp[v - c]! + 1;
  }
  return `${dp[x]! >= INF ? -1 : dp[x]}\n`;
}

const coins: SeedQuestion = {
  slug: 'making-change',
  title: 'Making Change',
  difficulty: 'medium',
  rating: 1500,
  tags: ['dp'],
  statement:
    'A shop has coins of $n$ different values, with an unlimited supply of each. What is the smallest number of coins that adds up to exactly $x$? If $x$ cannot be made, print $-1$.',
  inputFormat: 'The first line contains $n$ and $x$. The second line contains the $n$ coin values $c_1, \\ldots, c_n$.',
  outputFormat: 'Print the smallest number of coins, or $-1$.',
  constraints: ['1 \\le n \\le 20', '1 \\le x \\le 10^5', '1 \\le c_i \\le 10^4'],
  samples: [
    { input: '3 11\n1 5 7\n', output: '3\n', explanation: '$11 = 5 + 5 + 1$. Taking the largest coin first ($7 + 1 + 1 + 1 + 1$) uses five coins.' },
    { input: '2 3\n2 4\n', output: '-1\n' },
  ],
  notes: '',
  timeLimitMs: 2000,
  memoryLimitMb: 256,
  checker: { type: 'trim' },
  reference:
    'import sys\n\ndef main():\n    data = list(map(int, sys.stdin.read().split()))\n    n, x = data[0], data[1]\n    coins = data[2:2 + n]\n    INF = float("inf")\n    dp = [0] + [INF] * x\n    for v in range(1, x + 1):\n        best = INF\n        for c in coins:\n            if c <= v and dp[v - c] + 1 < best:\n                best = dp[v - c] + 1\n        dp[v] = best\n    print(-1 if dp[x] == INF else dp[x])\n\nmain()\n',
  inputs: () => {
    const rnd = mulberry32(44);
    const list = ['1 1\n1\n', '1 100000\n3\n', '3 6\n1 3 4\n'];
    for (const [n, x] of [
      [5, 1000],
      [10, 50000],
      [20, 100000],
    ] as const) {
      const cs = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 10000));
      list.push(`${n} ${x}\n${cs.join(' ')}\n`);
    }
    return list;
  },
  solve: minCoins,
};

// ---------------------------------------------------------------- 5. Dijkstra

function shortest(input: string) {
  const t = ints(input).map(Number);
  const n = t[0]!;
  const m = t[1]!;
  const adj: [number, number][][] = Array.from({ length: n + 1 }, () => []);
  for (let i = 0; i < m; i++) adj[t[2 + i * 3]!]!.push([t[3 + i * 3]!, t[4 + i * 3]!]);
  const dist = new Array<number>(n + 1).fill(Infinity);
  dist[1] = 0;
  const heap: [number, number][] = [[0, 1]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let s = i;
        if (l < heap.length && heap[l]![0] < heap[s]![0]) s = l;
        if (r < heap.length && heap[r]![0] < heap[s]![0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i]!, heap[s]!];
        i = s;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (d > dist[u]!) continue;
    for (const [v, w] of adj[u]!) {
      if (d + w < dist[v]!) {
        dist[v] = d + w;
        push([dist[v]!, v]);
      }
    }
  }
  return `${dist[n] === Infinity ? -1 : dist[n]}\n`;
}

const dijkstra: SeedQuestion = {
  slug: 'shortest-delivery-route',
  title: 'Shortest Delivery Route',
  difficulty: 'hard',
  rating: 1800,
  tags: ['graphs', 'shortest paths'],
  statement:
    'A courier starts at junction $1$ and must reach junction $n$. There are $m$ one-way roads; road $i$ goes from $a_i$ to $b_i$ and takes $w_i$ minutes.\n\nWhat is the shortest possible travel time? Print $-1$ if junction $n$ cannot be reached.',
  inputFormat: 'The first line contains $n$ and $m$. Each of the next $m$ lines contains three integers $a_i$, $b_i$ and $w_i$.',
  outputFormat: 'Print the shortest travel time, or $-1$.',
  constraints: ['2 \\le n \\le 10^5', '1 \\le m \\le 2 \\cdot 10^5', '1 \\le a_i, b_i \\le n', '1 \\le w_i \\le 10^9'],
  samples: [
    { input: '4 5\n1 2 5\n1 3 2\n3 2 1\n2 4 4\n3 4 9\n', output: '7\n', explanation: 'Go $1 \\to 3 \\to 2 \\to 4$: $2 + 1 + 4 = 7$ minutes.' },
    { input: '3 1\n2 3 1\n', output: '-1\n' },
  ],
  notes: 'The answer can exceed the 32-bit integer range.',
  timeLimitMs: 2000,
  memoryLimitMb: 256,
  checker: { type: 'trim' },
  reference:
    'import sys, heapq\n\ndef main():\n    data = sys.stdin.buffer.read().split()\n    n, m = int(data[0]), int(data[1])\n    adj = [[] for _ in range(n + 1)]\n    for i in range(m):\n        a, b, w = int(data[2 + 3 * i]), int(data[3 + 3 * i]), int(data[4 + 3 * i])\n        adj[a].append((b, w))\n    INF = float("inf")\n    dist = [INF] * (n + 1)\n    dist[1] = 0\n    heap = [(0, 1)]\n    while heap:\n        d, u = heapq.heappop(heap)\n        if d > dist[u]:\n            continue\n        for v, w in adj[u]:\n            nd = d + w\n            if nd < dist[v]:\n                dist[v] = nd\n                heapq.heappush(heap, (nd, v))\n    print(-1 if dist[n] == INF else dist[n])\n\nmain()\n',
  inputs: () => {
    const rnd = mulberry32(55);
    const graph = (n: number, m: number, maxW: number) => {
      const edges: string[] = [];
      // A guaranteed path keeps most cases reachable.
      for (let v = 1; v < n && edges.length < m; v++) edges.push(`${v} ${v + 1} ${1 + Math.floor(rnd() * maxW)}`);
      while (edges.length < m) edges.push(`${1 + Math.floor(rnd() * n)} ${1 + Math.floor(rnd() * n)} ${1 + Math.floor(rnd() * maxW)}`);
      return `${n} ${m}\n${edges.join('\n')}\n`;
    };
    return ['2 1\n1 2 1000000000\n', '2 1\n2 1 5\n', '3 3\n1 2 1\n2 3 1\n1 3 3\n', graph(100, 300, 100), graph(2000, 8000, 1_000_000_000), graph(20000, 60000, 1000)];
  },
  solve: shortest,
};

export const SEED_QUESTIONS: SeedQuestion[] = [sum, average, islandsQ, coins, dijkstra];
