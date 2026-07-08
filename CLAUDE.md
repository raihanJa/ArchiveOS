# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ArchiveOS is a local **Electron desktop app** (not a website, not a management game) that
autonomously simulates the entire history of a fictional organization. The user founds an
organization (AI company, space agency, cybersecurity firm, intelligence agency, robotics, pharma,
fantasy kingdom, or game studio), sets a speed, and a deterministic agent-based simulation runs
forward on its own — hiring, firing, launching products, inventing tech, getting breached, suing
and being sued — writing every event and an authentic document (email, memo, incident report,
press release, letter...) into a permanent, searchable local archive. An "AI Investigator" answers
natural-language questions about the archive by walking its causal graph, optionally backed by the
Claude API.

## Commands

```bash
npm install
npm start        # build (main + preload + renderer) then launch the Electron app
npm run dev       # same, with devtools open
npm run build     # esbuild only, no launch — three bundles: dist/main, dist/main/preload.js, dist/ui
npm test          # vitest run — unit tests (tests/*.test.ts)
npx vitest run tests/engine.test.ts   # run a single test file
npm run smoke     # headless end-to-end: simulate 500 days, verify DB persistence, reload, investigator
npx tsc --noEmit  # typecheck only (no test runner, no build)
```

There is no lint script configured.

**Environment gotcha:** if `ELECTRON_RUN_AS_NODE=1` is set (common in some sandboxes), Electron
runs as plain Node and `app` is undefined at startup (`Cannot read properties of undefined
(reading 'whenReady')`). Unset it before running `npm start`/`npm run smoke`.

## Architecture

Three-layer split, each with a distinct execution context:

```
src/shared/types.ts   → domain model + IPC contracts, imported by all three layers
src/sim/               → pure simulation (no I/O), runs in the Electron main process
src/main/              → Electron main process: SQLite, IPC handlers, the sim loop, investigator
src/ui/                → React renderer, talks to main only via window.archive (preload bridge)
```

### Simulation engine (`src/sim/`)

- **`engine.ts`** is the entire simulation. `Engine.create(name, kind, seed)` founds an
  organization; `engine.tickDay()` advances one in-world day; `engine.drain()` returns everything
  produced since the last drain (events + documents + a dirty-id set per entity type) for the host
  to persist. The engine never touches SQLite directly — it only mutates the in-memory `WorldState`
  (`src/sim/world.ts`) and emits `SimEvent`/`SimDocument` drafts.
- **Determinism is load-bearing.** `rng.ts` is a seeded `mulberry32` generator whose cursor
  (`world.rngState`) is serialized alongside the world. Given the same seed, `tickDay()` produces
  byte-identical event streams — this is what lets a reloaded archive continue exactly where it
  left off, and it's what the engine/db tests assert. **Any state the engine reads to make a
  decision must be part of the persisted, dirty-tracked world state**, and any float that could
  drift between the in-memory value and its rounded DB column must be rounded at the point of
  mutation (see the `happiness`/`morale` monthly drift in `engine.ts` for the pattern — forgetting
  to call `touch()` after mutating a field is the classic way to silently break determinism after a
  reload, since the change never reaches SQLite).
- **`themes.ts`** holds everything theme-specific (department names, role ladders per org kind,
  name pools, project-codename pools, tech/product noun banks, press names, attack vectors...). The
  engine itself is theme-agnostic and only consumes this vocabulary through `Theme`.
- **Causality is explicit, not implied.** Every `SimEvent` carries `causeIds: number[]`. Immediate
  causes are passed inline when an event is emitted from within another event's handling; delayed
  consequences go through `engine.schedule(daysAhead, kind, causeId, payload)` and are processed at
  the top of `tickDay()` via `processScheduled()` / `handleScheduled()` — this is how a breach today
  can trigger a lawsuit or CEO resignation months of in-world time later while still recording the
  causal link.
- **`docs.ts`** turns an emitted event into zero or more `SimDocument` drafts (email, memo,
  incident report, press release, letters, filings...). It's a pure function of the event + a
  `DocCtx` lookup context; add new document flavors here, keyed on `ev.type`.
- **"Pressures"** (`world.pressures`, e.g. `fame`, `scandal`, `legal_risk`, `security_threat`,
  `espionage_target`, `tech_leaked`) are named floats that decay ~1.5%/day and bias event
  probabilities elsewhere in the engine — this is the mechanism that gives the world momentum and
  lets one event's aftermath influence unrelated future events without hard scripting.

### Main process (`src/main/`)

- **`db.ts`** is the only place SQLite is touched. `node:sqlite` is loaded via
  `createRequire(__filename)` rather than a static import so esbuild/Vitest never try to bundle it
  (it's a very new Node builtin). Mutable entities (employees, departments, projects, ...) are
  mirrored rows upserted via `INSERT OR REPLACE`; events and documents are append-only. FTS5
  virtual tables (`events_fts`, `docs_fts`) power full-text search with a `LIKE`-based fallback if
  FTS5 is unavailable (`db.fts` flag). `flush(world, out)` writes one tick's output in a single
  transaction. **World rows are reloaded ordered by `id`** (`ORDER BY id`) specifically so Map
  iteration order after a reload matches original insertion order — required for determinism, see
  above.
- **`main.ts`** owns the sim loop: a 250ms interval accumulates in-world days based on the current
  `Speed` multiplier (`SPEEDS = [0,1,2,5,10,50,100]`, 1× ≈ 1 day / 3 real seconds), batches up to
  `MAX_DAYS_PER_BATCH` days per tick, then flushes to SQLite and pushes a `TickPush` payload to the
  renderer over `win.webContents.send("tick", ...)`. All other renderer↔main communication is
  request/response via `ipcMain.handle` (see the full handler list there for the IPC surface).
  `--smoke` runs a headless 500-day simulation + reload + investigator query and exits with a
  status code, used by `npm run smoke`.
- **`investigator.ts`** answers questions in two modes, both built on the same retrieval step
  (`retrieve()`): resolve entity names mentioned in the question against `employees`/`projects`,
  detect an intent (causal / who / summary / list / turnover / mistakes) and an event-type filter
  via regex, then gather candidate events (including `db.causalChain`/`consequenceChain` walks).
  **Local mode** (`composeLocal`) templates an answer directly from the retrieved events — always
  available, no network. **LLM mode** (`askLlm`) packs the same retrieved context into a prompt and
  calls the Anthropic Messages API directly (no SDK dependency) with the user's own API key from
  settings; it extracts cited `[e123]` ids from the response to return matching citations. LLM mode
  is opt-in and falls back to local mode on any API failure.

### Renderer (`src/ui/`)

- Plain React 18 (no router library). `NavContext` (`nav.tsx`) holds `{ view, params, selection }`
  and is the only navigation mechanism — `nav.go(view, params)` switches the main panel,
  `nav.select(selection)` drives the right-hand `ContextPanel` (person/project/department/event/doc
  detail), `nav.open(selection)` does both (used when drilling into an entity from a table row).
  There is no client-side router or URL state; everything lives in this one React context.
- `api.ts` types the `window.archive` bridge exposed by `preload.ts` (`contextBridge` +
  `ipcRenderer.invoke`, one method per IPC channel). The renderer has `contextIsolation: true`,
  `nodeIntegration: false` — it can only reach main through this typed surface.
- `format.ts` holds a **module-level mutable `org` reference** (`setOrg()`/`fmtDay()`/`money()`)
  used to format sim-days as calendar dates and amounts with the org's currency convention
  (`gp` for the fantasy kingdom theme, `$` otherwise) without threading the org object through
  every component. It's updated both on initial load and on every `tick` push.
- Views (`views.tsx`, `Assistant.tsx`, `Settings.tsx`, `Setup.tsx`) are grouped by screen rather
  than one-file-per-component; `components.tsx` has the small shared primitives (`EventRow`,
  `Bar`, `usePaged` pagination hook, etc.) reused across them.

## Testing conventions

`tests/` uses Vitest against the TypeScript sources directly (no separate test build step).
`tests/engine.test.ts` re-runs the engine with the same seed and asserts byte-identical event
headlines/order — this is the primary guard against accidentally introducing nondeterminism (e.g.
reading `Math.random()`, iterating a `Set`/object whose insertion order isn't stable, or mutating
state without persisting it). `tests/db.test.ts` seeds a world, persists it, reloads it, and
continues both the original and reloaded engine in parallel to assert their subsequent event
streams match exactly — if you add engine state, make sure it's captured by `takeSnapshot`/
`EngineSnapshot` (`world.ts`) or mirrored into a DB column, or this test will start failing.
