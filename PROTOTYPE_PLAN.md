# Bastion Line: Initial Prototype Build Plan

Source: [Bastion Line GDD v2](Bastion%20Line%20GDD%20v2%20(Desktop%20+%20Mobile,%20Phaser).md) · [Agent prompts](prompts/)

## 1. What "initial prototype" means

A playable **desktop/web vertical slice** of GDD Milestone 1, built so the AI layer (Milestone 2) plugs in later without rework.

| In scope | Out of scope (later runs) |
| --- | --- |
| 1 map (Easy), 20 waves, win/lose, stars | Maps 2–3 (Medium, Hard) |
| 4 towers with 3 upgrades, sell, 3 targeting modes | Backend proxy and live model calls |
| 5 enemies incl. Boss on waves 10 and 20 | Mobile: Capacitor, touch, safe areas |
| Build/combat loop, early start bonus, speed 1/2/3, pause | Electron/Tauri desktop wrapper |
| HUD, build bar, tower panel, menu → map select → game → debrief | Real art and audio (use shapes and colors) |
| Save/load at payout (localStorage) | Store submission |
| **Agent interface with the 4 scripted fallbacks** | |
| Headless balance sim (the GDD's dev-time Balance Tester) | |

The key design choice: the game talks to an `AgentService` interface from day one. The prototype ships only the **scripted fallback** implementations (hand-authored waves, rule-based hint, stock captions, stats-only debrief), which the GDD requires anyway. Milestone 2 adds an AI implementation behind the same interface, using the prompts in `prompts/`.

## 2. Decisions to lock before building

The GDD leaves these open. Proposed defaults below; change any before the run.

| Decision | Proposed default | Why |
| --- | --- | --- |
| Grid | 20×12 tiles at 48 px (960×576, Scale Manager FIT) | Works on phones later without zoom; GDD lists it as an option |
| Which towers hit Flyers | Arrow and Sniper | Sniper-only makes wave-7 Flyers a 150-gold hard gate |
| Enemy unlocks | Grunt 1, Runner 3, Brute 5, Flyer 7, Boss 10 & 20 | Introduces one new threat at a time |
| Threat cost | Grunt 1, Runner 1, Brute 3, Flyer 2, Boss 15 | Simple numbers for the Wave Director's budget math |
| Wave 1 threat budget | 10, then ×1.12 per wave (≈ 86 at wave 20) | GDD's 12% curve |
| Unit HP/speed/damage, kill gold | Proposed by the Spec agent, then tuned by the balance sim | GDD gives none |
| Map path | One winding path, 2 bends, ~45 path tiles, authored as Tiled-format JSON | No art needed; Tiled can open it later |

## 3. The build team (8 agents, 6 phases)

Each agent owns specific folders, so parallel agents never edit the same file.

| # | Agent | Phase | Owns | Produces |
| --- | --- | --- | --- | --- |
| 1 | **Spec Writer** | 1 Spec | `data/`, `src/types.ts`, `SPEC.md` | Tower/enemy/unlock/wave JSON, 20 scripted waves, shared TypeScript interfaces (`Enemy`, `Tower`, `GameState`, `AgentService`, event names) |
| 2 | **Scaffolder** | 2 Scaffold | `package.json`, `vite.config.ts`, `src/main.ts`, `src/scenes/*` stubs | Vite + TS + Phaser project that builds and boots to an empty Game scene |
| 3 | **Map & Enemies** | 3 Build | `src/map/`, `src/enemies/`, `public/maps/` | Map JSON, grid and buildable tiles, path following, enemy pooling, Frost slow, core damage |
| 4 | **Towers & Combat** | 3 Build | `src/towers/`, `src/combat/` | Placement rules, targeting (First/Strongest/Closest), projectiles, splash, air rules, upgrade and sell math |
| 5 | **Waves, Economy & Agents** | 3 Build | `src/waves/`, `src/economy/`, `src/agents/`, `src/save/` | Phase state machine, spawner, gold/HP/stars, early-start bonus, save/load, `AgentService` + 4 scripted fallbacks |
| 6 | **UI & Input** | 3 Build | `src/ui/`, `src/scenes/` (Menu, MapSelect, Debrief) | HUD, build bar, tower panel, preview + caption, hint button, keys H / Space / 1–3 / Esc |
| 7 | **Integrator** | 4 Integrate | Glue code only | Wires systems into the Game scene, fixes type errors; `npm run build` and `tsc --noEmit` pass |
| 8 | **QA & Balance** | 5 Verify | `tests/`, `sim/` | Vitest unit tests (economy, upgrade/sell math, targeting, budget rules) and a headless sim that plays 3 scripted builds through 20 waves and reports win rate and core HP per wave |

Phase 6 is a **GDD conformance review** done by me (main session, not an extra agent): check the build against the GDD tables and list mismatches.

Build agents in phase 3 code against `src/types.ts` from phase 1, which is how they work in parallel without waiting on each other.

## 4. Workflow

```
Spec ──► [you approve SPEC.md + data] ──► Scaffold ──► ┌ Map & Enemies   ┐
                                                       ├ Towers & Combat ┤──► Integrate ──► QA & Balance ──► Conformance review ──► [you playtest]
                                                       ├ Waves/Econ/Agents┤        ▲                │
                                                       └ UI & Input      ┘        └── fix loop ────┘ (max 2 rounds)
```

- **Gate 1 (you):** approve the spec and starting numbers before any code. Cheapest point to change design.
- **Build check after every phase:** `npm run build` must pass before the next phase starts. Failures go back to the owning agent once, then to the Integrator.
- **Fix loop:** failing tests or a sim showing an unwinnable or trivial map go back to the Integrator, at most 2 rounds, then reported to you rather than looped forever.
- **Gate 2 (you):** play it. Per the class slides, agents verify the game *works*; only a human can verify it's *fun*.

Two runs, so you can review between them:
1. **Run A:** Spec only (1 agent), then stop for Gate 1.
2. **Run B:** Scaffold → Build → Integrate → Verify (7 agents).

## 5. Setup before Run A

- Project goes in a new `bastion-line/` folder here.
- `git init` first, so each phase is a commit and anything can be rolled back.
- Environment: Node 24 and git are installed. Phaser and Vite install via npm; no Tiled or Mac needed for this prototype.

## 6. Done when

- `npm run dev` opens the game in a browser; you can play map 1 from menu to debrief.
- All 20 waves run from scripted data; Boss appears on waves 10 and 20; preview shows the next wave.
- Upgrade costs (60/100/150%), sell refund (70%), wave bonus (25 + 5 × N) and stars match the GDD, verified by tests.
- The sim shows the map is winnable by a reasonable build and losable by a weak one.
- Swapping a fallback for an AI implementation needs no change outside `src/agents/`.

## 7. Risks

| Risk | Mitigation |
| --- | --- |
| Parallel agents disagree on interfaces | Single `types.ts` from phase 1; build agents may not edit it, only request changes via the Integrator |
| Balance is off with invented stats | Sim reports numbers; you tune `data/*.json` without touching code |
| Phaser can't run headless for tests | Keep combat/economy logic in plain TS modules; Phaser scenes only render them |
| Agent cost | 8 agents across 2 runs; Run A is small, so you see the spec before paying for the build |
