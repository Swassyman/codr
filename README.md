# Codr

Codr is a self-hosted platform for running competitive coding contests on a local network. Participants write and run code in the browser against test cases. Organizers write questions in structured forms, check them against a reference solution, and run contests with a choice of timing rules. Everything, including the sandbox that executes code, starts with one command and keeps working without internet after the first start.

- [Quick start](#quick-start)
- [Writing a question](#writing-a-question)
- [Running a contest](#running-a-contest)
- [The workspace](#the-workspace)
- [Importing questions](#importing-questions)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Development and tests](#development-and-tests)
- [Defaults and decisions](#defaults-and-decisions)

## Quick start

You need Docker with Compose v2 on a Linux host with cgroup v2 (any current distribution). The runner container is privileged because its sandbox creates its own cgroups.

```sh
cp .env.example .env     # optional: every value has a default
docker compose up -d
```

Open http://localhost:3000 and sign in as **admin** / **codr-admin**. Change the password right away under **Users → Reset password** (or set `ADMIN_PASSWORD` in `.env` before the first start).

The first start needs internet once: Docker pulls the images and builds the web and runner images, and the runner downloads the language packages (C, C++, Python 3, Java, JavaScript, TypeScript and Zig by default, about 1.3 GB) into a persistent volume. After that Codr runs offline. Participants on the same network open `http://<server-ip>:3000`.

The first start also seeds demo content: five sample questions (with tests and reference solutions, validated automatically once the runner is ready) and three public demo contests, one per timing mode, open for 30 days.

Useful commands:

```sh
docker compose logs -f web                              # server log
docker compose exec web node dist/server/seed.js        # re-run the (idempotent) seed
docker compose exec web node dist/server/import-dataset.js --limit 10   # bulk-import from CodeContests
docker compose down                                     # stop; data stays in the pgdata volume
```

## Writing a question

Admins and contest creators work in the **Question bank**.

1. **New question** opens the editor. It saves as you type; the indicator next to **Publish** shows the state.
2. **Statement**: title, slug, difficulty or rating, tags, the statement, input and output format, constraints (one per row, rendered as a bullet list), examples with optional explanations, and notes. Text fields take Markdown with `$math$` and `$$display math$$` (KaTeX). The preview on the right is exactly what participants see. If you copied a whole problem from somewhere, **Paste a whole statement** splits it into the fields.
3. **Tests**: add rows one at a time, drop a `.zip` of input/output pairs (`1.in`/`1.out` or `.ans`, `input/`/`output/` folders, Polygon `01`/`01.a`), or paste several tests at once (`===` between tests, `---` between input and output). Each test can be hidden, weighted, labelled and grouped; rows can be reordered, duplicated and deleted (with undo). Leave expected outputs empty and use **Fill outputs from a reference solution**: your solution runs on every input, you review the outputs, and you save the ones you want.
4. **Limits and languages**: time and memory limits, per-language multipliers (Python, Java, JavaScript and TypeScript get more time by default), allowed languages, starter code, the output checker (exact, ignore trailing whitespace, token by token, numbers within a tolerance), points, and practice (see [Practice](#practice)).

Every language is named with the version the runner has installed, for example "C++17 (gcc 10.2.0)" or "Zig (zig 0.10.1)", in the editor, run results, submissions and the admin pages.
5. **Validate**: runs the reference solution on the examples and every test with the real limits and reports each verdict and timing. Changing tests or limits marks the result stale.
6. **Publish**. Codr asks for confirmation if the question has not passed validation.

Examples are judged first in every submission and are worth no points; they cannot leak anything because they are already public.

## Running a contest

In the **Contest builder**:

1. **New contest**, then set the name, description and schedule.
2. Pick a **timing mode**:

   | Mode | What participants get |
   | --- | --- |
   | Fixed window | Everyone works between the start and end times. |
   | Personal window | N minutes from the moment each person presses Start. The end time is the entry cutoff; people who started before it keep their full time. |
   | Timer per question | Each question has its own timer (a default, overridable per question), started when the participant first opens it. When it runs out, the last code the server saved is submitted automatically and the question locks. The contest end cuts every timer short. |

3. **Questions**: add published questions from the bank, order them (they are lettered A, B, C…), and override points or minutes per question.
4. **Navigation**: *View once* means a question locks for good once the participant moves to another one (the server records it, so reloading, opening a new tab or using another device does not get around it). *In order only* forbids skipping ahead. They can be combined.
5. **Editor**: whether participants get autocomplete. *Participant chooses* (the default, and what contests created before this setting use) puts a switch in the editor that starts off and is remembered per account on each device. *Always off* removes every completion path (suggestions while typing or on demand, parameter hints, inline suggestions, snippets); *Always on* keeps suggestions on and the switch locked. The server sends the rule with every question it opens, so the browser only applies it; like any in-browser feature, a modified browser could still ignore it. Completion suggests words from the participant's own code, since no language services are bundled.
6. **Access**: public (listed and open to registration), invite code, or private (you add people by username). Guests can be allowed to join with the code and a name.
7. **Limits, results and scoring**: submissions per question, runs per minute, whether hidden-test results are shown right away or after the contest, per-test detail or only counts, partial or all-or-nothing scoring, penalty minutes, the leaderboard switch, and integrity signals (tab switches and pastes, shown to you and announced to participants; informational only, they prevent nothing).
8. **Publish**. Share the contest link or the join code. Timing rules and the autocomplete rule lock once the contest starts; the end time can still be extended.

The **Results** page shows live standings, per-question scores and attempts, start and finish times and integrity counts; click a person to see their submissions, read their code, rejudge, and see their integrity timeline.

All time rules are decided on the server, from the moment a request arrives. The browser clock only drives the countdown display and resynchronises with the server continuously. A submission that reached the server before the deadline counts, however long judging takes.

### Practice

The practice bank shows a published question when no published contest containing it is upcoming or running, and either:

- it is marked **Show in the practice bank**, or
- it was in at least one published contest, and every published contest containing it has finished.

So once a contest is over, all of its questions become practice material, tagged "from *contest name*". The tag names only public contests and contests the viewer took part in. "Finished" is the last moment anyone can still work: the end time, or in personal-window mode the entry cutoff plus the window. Participants who finish early do not end it. Draft contests are ignored. Visibility is computed for each request, so nothing is written when a contest ends.

To keep a question out of practice for good, for example one you plan to reuse, turn on **Keep out of practice** in its settings (`practiceHidden`). It overrides both rules.

## The workspace

Participants solve in one screen, in contests and in practice: the statement, the editor, and a panel for custom input, example results and submissions.

- **Zen mode** (`Alt+Z`, `⌥Z` on macOS, or the focus button in the editor toolbar) hides the header, the statement and the run panels. What is left is the editor and a slim bar with the language, the timer, Run, Submit and **Exit zen**. **Problem** (`Alt+P`) slides the statement over the editor without leaving zen, with the run results, the submissions and the question navigator next to it; Run and Submit open it on their results without taking focus from the editor. `Esc` leaves zen when focus is outside the editor; an open sheet or menu closes first, and inside the editor `Esc` stays with the editor (Vim needs it). Zen is remembered per account on each device, so it stays on across questions and reloads.
- **Fullscreen** (`Alt+Shift+F` or the toolbar button) uses the browser's fullscreen, and `Esc` leaves it as usual. Zen and fullscreen are independent and combine: each shortcut changes only its own state. Leaving the solve page leaves fullscreen; switching questions does not.
- **Editor settings** (the sliders button in the editor toolbar):
  - Key bindings: default, Vim or Emacs. Vim shows its mode and `:` command line under the editor, Emacs its pending prefix keys.
  - Tab width: 2, 4 or 8. Go always indents with tabs, shown at that width.
  - Editor theme: Codr (follows the app's light or dark theme), GitHub Light, GitHub Dark, Solarized Light, Solarized Dark, One Dark or Dracula.
  - Always show contest timer.

  Changes apply immediately, keeping the cursor, undo history and draft, and are remembered per account on each device. They change presentation and input only: the autocomplete rule, paste recording, autosave and every deadline work the same in every setting and layout.
- **Shortcuts**: Run `Ctrl+Enter`, Submit `Ctrl+Shift+Enter` (`⌘` instead of `Ctrl` on macOS), and the ones above. They work with Vim and Emacs bindings too, which never see them.
- **Contest timer**: hidden behind a dimmed clock while you work. Hover over it or focus it to see the time; click it (or press Enter or Space) to keep it visible. In the last minute it shows whatever you chose, and the fuse along the top edge flashes. The fuse itself is always visible and turns amber with five minutes left. Turn on **Always show contest timer** to see the clock all the time.

## Importing questions

**Import** brings problems in as drafts. Every imported question keeps its source, license and a link to the original, and lands in the same editor for review.

| Source | Provides | License and use |
| --- | --- | --- |
| CodeContests dataset (DeepMind, Hugging Face) | Statement, examples, hidden tests, accepted solutions | CC BY 4.0. Attribution is added automatically. |
| Codeforces (official API) | Name, rating, tags, link | Metadata only. Statements belong to their authors. |
| AtCoder (AtCoder Problems by kenkoooo) | Name, estimated difficulty, link | Metadata only. |
| CSES Problem Set (best effort) | Statement, limits, examples | Not openly licensed: private local use with attribution only. Hidden tests are not public. |

Metadata-only and scraped questions usually lack tests; the editor points this out and offers the reference-solution generator. When a site blocks automated access, Codr reports it and does not work around it: open the original link and use **Paste a whole statement**. **Do not republish scraped statements publicly.**

For bulk imports from the dataset there is a script:

```sh
npm run import:dataset -- --split test --limit 20 --extra-tests 10
npm run import:dataset -- --search graph --limit 5
```

### Adding an importer adapter

An adapter is one file in `src/server/importers/` implementing `SourceAdapter` (`types.ts`):

```ts
export const myAdapter: SourceAdapter<RawProblem> = {
  info: { id: 'my-source', name: 'My source', kind: 'metadata', description: '…', licenseNote: '…', provides: { statement: false, tests: false, solution: false } },
  async search(query, ctx) { /* return { results: SearchResult[] } */ },
  async fetchProblem(externalId, ctx) { /* return the raw problem */ },
  normalize(raw, ctx) { /* return a NormalizedQuestion: Codr's question shape */ },
};
```

Register it in `ADAPTERS` in `registry.ts`; the UI and API pick it up automatically. Rules for adapters:

- Make every request through `ctx.http.get(url, 'json' | 'text', { cacheMs, minIntervalMs })`. It sends the configured User-Agent, checks robots.txt (pass `api: true` only for documented APIs meant for programs), spaces requests per host, caches responses in Postgres, and turns bot challenges into a "blocked" error.
- Throw `SourceError` for expected failures (not found, unavailable, blocked); it is reported to the user and never affects other sources.
- Set an honest `licenseNote` and fill `license` and `attribution` in the normalized question.
- Put pure parsing in exported functions and cover them with unit tests (see `tests/unit/importers.test.ts`).

## Architecture

```
 browser ──HTTP/SSE──▶ web (Fastify + React build) ──SQL──▶ db (Postgres 17)
                         │  job worker, expiry scheduler
                         └──HTTP──▶ runner (Piston + isolate sandbox)
```

- **web**: one Node process. Fastify serves the API and the built React app. It also runs the **job worker**, which claims queued runs and submissions from Postgres (`FOR UPDATE SKIP LOCKED`) and sends programs to the runner through an execution pool that serves interactive runs before submission judging. The **expiry scheduler** handles per-question timers. Live updates (job status, contest changes, server time) go to the browser over Server-Sent Events. The web process never executes user code.
- **runner**: [Piston](https://github.com/engineer-man/piston), behind the `Runner` interface (`src/server/runner/types.ts`) so the engine can be swapped. Every program runs in an isolate sandbox with no network, cgroup CPU-time, wall-time, memory and process limits, an output cap, its own filesystem with a private writable box, and an unprivileged user. `runner/Dockerfile` pins the image and patches two upstream issues that break judging with real test data: the 100 KB request limit and truncation of large stdin. Judge0 CE was not used because it requires cgroup v1, which current distributions no longer provide. The image also lets Codr replace a package's stage script: Piston's `typescript` package compiles with a bare `tsc`, which targets ES5 without `Map`, `Set` or `BigInt`, so `runner/overrides/typescript/compile` compiles for the bundled Node.js (ES2022) and declares the Node.js globals used to read input. Language versions come from the runner's `/api/v2/runtimes`; the server keeps the last list it saw (`GET /api/runtimes`) so labels keep their versions while the runner restarts.
- **db**: Postgres 17 with Drizzle migrations (`drizzle/`), applied automatically on start.

Key ideas in the code:

- `src/shared/timing.ts`: every timing and locking rule as pure functions of server timestamps. The API calls them with the request's arrival time; the client only renders what the server decided.
- `src/server/routes/contest-play.ts`: opening a question is the only way to read its statement, and it records the first view (and, in view-once mode, locks the question being left) in a transaction that holds the participant's row lock, so parallel tabs cannot race. Runs, drafts and submissions are refused for locked questions.
- `src/server/jobs/judge.ts`: examples, then tests, checked by `src/shared/checkers.ts`; per-test verdict, time, memory and points; results never contain test data.
- `src/server/services/submissions.ts`: the participant view of a submission applies the contest's reveal and detail rules; hidden tests' inputs and outputs are never sent.

Data model (Postgres): `users`, `sessions`, `questions` (statement fields, limits, checker, reference solution, source), `test_cases`, `contests`, `contest_questions`, `participants` (entry and finish times), `participant_questions` (first view, left at, expiry processed), `drafts`, `submissions` (arrival time, verdict, per-test results), `runs`, `integrity_events`, `import_cache`.

Security: scrypt password hashes, httpOnly SameSite session cookies, a double-submit CSRF token plus an Origin check on every state-changing request, rate limits on sign-in, runs and submissions (keyed per account so a classroom behind one NAT can sign in), Zod validation on every input, authorization on every endpoint, and a strict Content Security Policy.

## Configuration

All settings are environment variables; see `.env.example` for the full list with comments. The most common:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODR_PORT` | `3000` | Host port of the web app. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | `admin`, `codr-admin` | First admin, created when no admin exists. |
| `SEED_ON_START` | `true` | Seed demo content into an empty database. |
| `ALLOW_REGISTRATION` | `true` | Let people create participant accounts. |
| `RUNNER_PACKAGES` | `python,gcc,node,java,typescript,zig` | Language packages to install (`gcc` gives C and C++, `node` gives JavaScript; add `go`, `rust`). |
| `RUNNER_CONCURRENCY` | `4` | Programs executed at the same time. |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS. |
| `FEATURE_LEADERBOARD_UI` | `false` | Show the leaderboard page for contests that enable it. |

## Development and tests

```sh
npm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db runner   # Postgres on :55432, runner on :2000
npm run dev          # API on :3000 (watch) and Vite on :5173 with hot reload
npm run typecheck
npm test             # unit + integration tests (uses a codr_test database on the dev Postgres)
```

- Unit tests (`tests/unit`): timing and lock rules, practice visibility, autocomplete rule resolution, checkers, scoring, runner result mapping and language catalog, test import parsing, importer parsing, editor settings parsing and storage, timer visibility, workspace shortcuts, and editor theme contrast and token coverage (Zig included).
- Integration tests (`tests/integration`): the real API against Postgres with a deterministic fake runner (auth, CSRF, authoring, the submit → judge → verdict flow, contests in every timing mode, view-once across tabs and devices, auto-submit at expiry, reveal rules, guests, imports, user management, practice visibility before, during and after contests, the autocomplete rule, Zig and TypeScript). When the dev runner is reachable, extra tests run real programs in the sandbox (TLE, MLE, no network, large inputs, real judging including Zig and TypeScript, seed validation). The TypeScript test needs a runner built from the current `runner/Dockerfile` (`docker compose up -d --build runner`). Point the tests at another runner with `RUNNER_URL`.
- End-to-end (`e2e/`): a participant going through a view-once contest, the autocomplete rule, and zen, fullscreen, editor settings and the hidden contest timer, in a real browser. Against a running stack: `npx playwright install chromium && E2E_BASE_URL=http://localhost:3000 npx playwright test` (or set `CHROME_PATH` to a local Chrome).

Project layout: `src/shared` (code used by both sides: schemas, timing, checkers, scoring, languages), `src/server` (API, jobs, runner, importers, seed), `src/web` (React app), `drizzle/` (migrations), `runner/` (runner image), `scripts/` (seed, dataset import), `tests/`, `e2e/`.

## Defaults and decisions

- Stack: React + Vite with a Fastify API in one TypeScript repo; Postgres with Drizzle; Monaco and KaTeX bundled locally (no CDN), syntax highlighting plus optional word-based autocomplete (no language services).
- Languages: C++17 and C (GCC with `-O2` enabled through a pragma, since Piston's GCC package compiles without optimisation), Python 3, Java (time limits include a 1.5 s allowance because the JVM compiles the source at run time), JavaScript, TypeScript and Zig. Go and Rust are available when their packages are installed.
- TypeScript: compiled by `tsc` (Piston's `typescript` package, 5.0.3) for its bundled Node.js 18, then run like JavaScript with the same limits. Read input with `require("fs").readFileSync(0, "utf8")`, as in the starter template. Type errors are compilation errors, and compilation runs in its own stage, so it does not count against the time limit. Deno's `typescript` runtime is never used. Pinning `typescript` below 4.6 breaks the compile step, which targets ES2022.
- Zig: Piston's `zig` package (0.10.1), built with `-O ReleaseSafe`, so overflows and out-of-bounds accesses are runtime errors. A compile takes about 5 s of CPU and happens for every test case, like every other compiled language, so Zig submissions take longer to judge.
- Autocomplete is a contest rule (participant chooses, always off, always on). Practice always lets the participant choose, and the editor starts with it off.
- Editor preferences (key bindings, tab width, theme, always show timer, zen) are kept in the browser per account, like the autocomplete choice; the server stores none of them. They only affect how the editor looks and takes input. Vim and Emacs bindings (`monaco-vim`, `monaco-emacs`) load the first time someone picks them.
- The contest timer is hidden by default while solving and always shown in the last minute (`clockLevel` "critical", 60 s, and after time is up). The fuse stays visible as the ambient warning: it tells you roughly how much is left without numbers to watch, and it turns amber at five minutes, before the clock is forced into view.
- Fullscreen covers the whole page, not just the workspace element, so dialogs (time up, leaving a view-once question) and notifications stay visible in fullscreen.
- Editor themes keep code text at WCAG AA contrast (4.5:1) and line numbers at 3:1. Well-known palettes keep their hues, but colours that fell short (Solarized accents, Dracula and One Dark comments) are lighter or darker than the originals.
- Samples are judged first in every submission and are worth no points.
- Practice shows published questions marked for practice, plus every question of a finished contest, except while a published contest containing them has not finished, and never questions kept out of practice. See [Practice](#practice).
- Personal-window mode: the contest end is the entry cutoff; each participant gets the full duration from entering.
- Per-question timers: the auto-submit uses the newest draft the server received before the deadline. The editor saves continuously and once more just before the deadline.
- Guests exist for one contest and live in one browser, so view-once cannot be enforced across devices for guests; use accounts for strict contests.
- Integrity signals (tab switches, pastes) are recorded only when the contest enables them, participants are told, and they are informational only.
- The leaderboard is off by default. Standings, penalty and freeze are complete in the API (`GET /api/contests/:id/leaderboard`); the page is a stub behind `FEATURE_LEADERBOARD_UI`.
- One web process: the job queue lives in Postgres, but live events use an in-process bus. Running several web processes would need Postgres LISTEN/NOTIFY for events and a single scheduler.

## Licensing of imported content

Codr keeps the source, license and attribution of every imported question. Content from the CodeContests dataset is CC BY 4.0. Codeforces and AtCoder imports contain only metadata and a link. CSES statements are not openly licensed and are imported for private, local use only. Do not republish imported statements publicly unless their license allows it.
