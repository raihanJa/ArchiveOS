# ArchiveOS — Autonomous History Simulator

ArchiveOS is a **local desktop application** that continuously generates and maintains the
complete history of a fictional organization. Found an AI lab, a space agency, a cybersecurity
firm — or a fantasy kingdom — then step back. Autonomous AI agents run the world forward on their
own, hiring people, launching projects, inventing technologies, fighting, failing, getting
breached, going to court and occasionally changing history. Everything they do is written into a
permanent, searchable archive of events and authentic documents.

It is **not** a management game. You do not micromanage. You investigate.

---

## Quick start

```bash
npm install
npm start        # build + launch the desktop app
```

Other scripts:

```bash
npm run dev      # launch with devtools
npm test         # unit tests (engine determinism, causality, persistence)
npm run smoke    # headless end-to-end: simulate 500 days, verify DB + reload + investigator
```

Requires **Node 22+** (the persistence layer uses the built-in `node:sqlite`). No native modules,
no build toolchain beyond esbuild.

> If you are running inside a sandbox that sets `ELECTRON_RUN_AS_NODE=1`, unset it first — that
> variable forces Electron to run as plain Node and the GUI will not start.

---

## What the world does on its own

Set a speed (1× → 100×) and history accumulates. Agents and org-level processes generate:

- **People:** hires, promotions, resignations, firings, retirements, burnout, misconduct,
  investigations, rivalries, mentorships, reconciliations, awards.
- **Work:** projects started / completed / cancelled / **revived years later**, breakthroughs,
  failed experiments, invented technologies, product launches, product decline and discontinuation.
- **Business:** contracts won and lost, client complaints, marketing campaigns, new offices,
  funding rounds, financial crises and layoffs.
- **Threats:** cyber-attacks, data breaches, industrial espionage (sometimes an insider),
  lawsuits, government investigations, regulatory fines, CEO resignations and successions.

Every event is stored with its **causes**, so history forms a directed graph. A breach can trigger
a government investigation, which fines the company, which pressures the CEO into resigning, whose
successor revives an abandoned technology from a project that was cancelled a decade earlier. None
of that is scripted — it emerges from agent decisions and decaying "pressures" that bias future
probabilities.

Each meaningful event also emits **authentic documents**: emails, memos, meeting minutes, incident
reports, press releases, offer/promotion/termination/resignation letters, project proposals,
financial reports, research papers, security logs, legal filings and board minutes.

---

## Using the archive

- **Dashboard** — live stats and a real-time feed of history as it happens.
- **Timeline** — every event, filterable by type / importance / full-text; click any event to
  trace its causes and consequences in the right-hand context panel.
- **Personnel / Projects / Departments** — browse every entity that ever existed, with full
  dossiers, career timelines, teams, relationships and asset tables (products, technologies,
  clients, offices).
- **Documents** — full-text search across every generated artifact; read them as written.
- **Search** — one box across people, projects, products, departments, technologies, events and
  documents (SQLite FTS5, with a LIKE fallback).
- **AI Investigator** — ask natural-language questions ("Why was the CEO replaced?", "Which
  department had the highest turnover?", "Show every data breach"). It resolves entities, walks the
  causal graph and answers with citations. Works fully offline; optionally connect a Claude API key
  (Settings) for reasoned prose answers over the same retrieved context.

The world **persists** to a local SQLite database and resumes exactly where it left off — including
the RNG cursor, so a reloaded simulation continues deterministically.

---

## Architecture & key decisions

**Stack: Electron + TypeScript + React + esbuild + `node:sqlite`.**

| Decision | Why |
| --- | --- |
| **Electron desktop app** | The brief demands a professional desktop application (not a website), local storage, and a long-running background process. Electron gives a real main-process simulation loop plus a rich renderer, with zero server. |
| **`node:sqlite` (built-in)** | The archive must scale to millions of events and tens of thousands of documents. SQLite handles that on a single file with indexes and FTS5 full-text search. Using Node's built-in binding means **no native compilation** — nothing to rebuild per Electron version. |
| **esbuild, no framework CLI** | Three tiny bundles (main / preload / renderer) build in milliseconds. Full control, no magic, fast iteration. |
| **Deterministic seeded RNG (`mulberry32`)** | The entire engine — including the RNG cursor — is serializable. Given a seed the same history replays exactly, which makes the simulation testable and lets a restarted app continue bit-for-bit. |
| **Append-only event graph** | Events are immutable facts with `causeIds`. Causality is a DAG persisted in a join table; "why did X happen?" is a breadth-first walk up the graph, "what did X cause?" is a walk down. This is what turns a stream of events into *stories*. |
| **Agent + pressure model** | Each active person is a lightweight agent that acts probabilistically from its personality, mood and relationships. Org-wide "pressures" (fame, scandal, legal risk, security threat, espionage target…) decay over time and bias event odds — giving momentum and consequences without global scripting. |
| **Scheduled consequences** | Delayed effects (a lawsuit months after a breach, a revival years after a cancellation) go on a `scheduled` queue that fires on the due day, so cause and effect can be separated by in-world years. |
| **Context isolation + typed IPC** | The renderer has no Node access; everything goes through a small `contextBridge` API and typed `ipcMain` handlers. Standard Electron security posture. |
| **Investigator: retrieval-first** | Whether answering locally or via Claude, the same pipeline resolves entities, gathers relevant events and expands their causal chains into a context pack. The LLM is an optional reasoning layer over deterministic retrieval — never the source of truth — and everything stays fully functional offline. |

### Layout

```
src/
  shared/    types.ts          # domain model + IPC contracts, shared by all layers
  sim/
    rng.ts                     # seedable deterministic RNG
    themes.ts                  # all org-kind flavor: depts, roles, names, codenames, tech
    world.ts                   # in-memory working set + serializable snapshot
    engine.ts                  # the simulation: founding, daily tick, agents, consequences
    docs.ts                    # event → authentic document generation
  main/
    db.ts                      # SQLite persistence, FTS search, causal-graph queries
    investigator.ts            # AI Investigator (local reasoning + optional Claude API)
    main.ts                    # Electron main: sim loop, IPC, lifecycle
    preload.ts                 # contextBridge API surface
  ui/                          # React renderer (dashboard, timeline, entities, docs, search, assistant, settings)
tests/                         # vitest: rng, engine determinism/causality, db round-trip
```

### Data & scale

Entities (people, departments, projects, technologies, products, clients, buildings,
relationships) are mirrored rows updated in place. Events and documents are **append-only** and
indexed for time, type, importance and entity foreign keys, with FTS5 virtual tables for search.
The engine keeps only the live working set in memory and streams history straight to disk in a
single transaction per tick batch, so the on-disk archive can grow without bound while memory stays
flat.
