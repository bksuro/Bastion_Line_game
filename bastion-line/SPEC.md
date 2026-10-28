# Bastion Line Prototype: Build Spec (v2, after Gate 1)

This is the contract for the build agents in Run B. Sources: the GDD v2, PROTOTYPE_PLAN.md (sections 1-3) and prompts/*.md.

**Authoritative files (read-only for every build agent):**

| File | Contents |
| --- | --- |
| `data/towers.json` | 4 towers: base stats, level multipliers, upgrade costs, sell rate |
| `data/enemies.json` | 5 enemies: HP, speed, gold, threat cost, core damage, unlocks |
| `data/economy.json` | start values, payouts, threat budget, HP scaling, stars, grid, timers |
| `data/waves.easy.json` | 20 scripted waves (the Wave Director fallback), each a valid `WavePlan` |
| `src/types.ts` | every shared type, event name, save shape, the `AgentService` interface, and the **function-type aliases of every cross-folder function** |
| `src/ui/contracts.ts` | type-only signatures of the UI entry points (the only file in `src/ui` the UI agent may not edit) |
| `tools/balance-sim.mjs` | the Spec Writer's headless balance sim (section 8); reads `data/*.json` directly |

If something here conflicts with the JSON, **the JSON wins** and the Integrator reports the mismatch. Never hard-code a number that exists in `data/`.

**Gate 1 decisions (human):** enemy HP growth is ×1.10 per wave (briefly softened to ×1.09, then returned to ×1.10 so that never upgrading loses); upgrades also shorten the fire interval (×0.9 / 0.85 / 0.8) — approved; the 20 s auto-start build timer on waves 2-20 with a 0-5 gold early-start bonus — approved.

---

## 1. Core rules for all code

1. **Logic is plain TypeScript; Phaser only renders it.** Map parsing, enemy movement, targeting, projectiles, damage, economy, the wave state machine, saves and agents live in `src/{map,enemies,towers,combat,waves,economy,agents,save,core}` and must not import `phaser`. Scenes and `src/ui` read `GameState`, listen to events and call `GameCommands`. QA must be able to run a whole 20-wave match in Vitest with no Phaser and no DOM (a `localStorage` stub is fine).
2. **Only core changes state.** The UI never changes `GameState` directly. It calls `GameCommands`, which return `CommandResult` so the UI can show why something failed (greyed button, shake).
3. **Units.** Positions and ranges are in tiles (float). The centre of tile (x,y) is (x+0.5, y+0.5). Speeds are in tiles per second, times in ms, gold in integers. Pixels = tiles × 48.
4. **Determinism.** The prototype uses no randomness, so the same inputs give the same match. The simulation runs in **fixed steps of `FIXED_STEP_MS` = 1000/60 ms of game time**. `GameInstance.step(dtRealMs)` accumulates `dtRealMs × speed` and runs whole fixed steps (at most 10 × speed per call). Pause runs 0 steps.
5. **Data import.** Use Vite JSON imports (`import towers from '../data/towers.json'`), cast to the types in `types.ts`. Tests import the same files.

---

## 2. Module boundaries, entry modules and ownership

Agents edit only the folders they own. `src/types.ts`, `src/ui/contracts.ts` and `data/` are frozen. If you need a change, ask the Integrator, who batches requests and updates the Spec owner's files.

| Agent | Owns |
| --- | --- |
| 1 Spec Writer | `data/`, `src/types.ts`, `src/ui/contracts.ts`, `tools/`, `SPEC.md` |
| 2 Scaffolder | `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `src/scenes/*` stubs (scene keys = `SCENE_KEYS` in types.ts; `resolveJsonModule` on; Vitest configured) |
| 3 Map & Enemies | `src/map/`, `src/enemies/`, `public/maps/` |
| 4 Towers & Combat | `src/towers/`, `src/combat/` |
| 5 Waves, Economy & Agents | `src/waves/`, `src/economy/`, `src/agents/`, `src/save/`, **`src/core/`** |
| 6 UI & Input | `src/ui/` (except `contracts.ts`), `src/scenes/` Menu, MapSelect, Debrief |
| 7 Integrator | glue only (`src/scenes/GameScene.ts`, `src/scenes/BootScene.ts` loading, `src/main.ts` wiring) |
| 8 QA & Balance | `tests/`, `sim/` |

`src/core/` is my addition to the plan. The event bus, initial-state factory, `GameCommands` implementation and the fixed-step loop needed one owner, and they sit with the phase state machine (agent 5).

### 2.1 Entry modules (the cross-folder contract)

**Rule:** code in one folder imports another folder **only** through that folder's `index.ts`, e.g. `import { spawnEnemy } from '../enemies'`. Each entry module exports **exactly these names** (more exports are fine), each typed with its alias from `src/types.ts`:

```ts
// src/enemies/index.ts
import type { SpawnEnemy, StepSystem, EnemyHpForWave } from '../types';
export const spawnEnemy: SpawnEnemy = (state, ctx, type) => { /* ... */ };
```

Parameter style, the same everywhere: state systems and state queries take `(state, ctx, ...)`; pure data lookups take `(data: GameData, ...)`; factories take their inputs.

| Entry module | Owner | Export name : alias (types.ts) |
| --- | --- | --- |
| `src/map/index.ts` | 3 | `parseTiledMap: ParseTiledMap`, `createMapQueries: CreateMapQueries` |
| `src/enemies/index.ts` | 3 | `enemyHpForWave: EnemyHpForWave`, `spawnEnemy: SpawnEnemy`, `stepEnemies: StepSystem` |
| `src/towers/index.ts` | 4 | `getTowerStats: GetTowerStats`, `upgradeCost: UpgradeCost`, `sellRefund: SellRefund`, `canPlace: CanPlace` |
| `src/combat/index.ts` | 4 | `selectTarget: SelectTarget`, `stepCombat: StepSystem` |
| `src/waves/index.ts` | 5 | `threatBudget: ThreatBudget`, `minThreat: MinThreat`, `unlockedEnemies: UnlockedEnemies`, `validateWavePlan: ValidateWavePlan`, `stepSpawner: StepSystem`, `isWaveClear: IsWaveClear` |
| `src/economy/index.ts` | 5 | `waveClearBonus: WaveClearBonus`, `earlyStartBonus: EarlyStartBonus`, `computeStars: ComputeStars`, `addGold: AddGold` |
| `src/agents/index.ts` | 5 | `createFallbackAgentService: CreateFallbackAgentService`, `buildWaveDirectorInput: BuildWaveDirectorInput`, `buildHintInput: BuildHintInput`, `buildNarrationInput: BuildNarrationInput`, `buildDebriefInput: BuildDebriefInput`, `selectBossTaunt: SelectBossTaunt` |
| `src/save/index.ts` | 5 | `createSaveStore: CreateSaveStore`, `serializeRun: SerializeRun`, `restoreRun: RestoreRun` |
| `src/core/index.ts` | 5 | `loadGameData: LoadGameData`, `createEventBus: CreateEventBus`, `createGameContext: CreateGameContext`, `createGame: CreateGame` |
| `src/ui/index.ts` | 6 | `createUiState: CreateUiState`, `createFieldView: CreateFieldView`, `createHud: CreateHud`, `createBuildBar: CreateBuildBar`, `createPlacementPreview: CreatePlacementPreview`, `createTowerPanel: CreateTowerPanel`, `createHintHighlight: CreateHintHighlight`, `bindKeyboard: BindKeyboard`, `mountGameUi: MountGameUi` (aliases from `src/ui/contracts.ts`) |

Supporting types, all in `src/types.ts`: `GameContext`, `CreateGameOptions` (`mapId`, `difficulty`, `saves: SaveStore | null`, `resume: RunSave | null`), `GameInstance` (`state`, `ctx`, `commands`, `step(dtRealMs)`, `destroy()`), `SaveStore`, `StorageLike`, `WaveStats`, `FIXED_STEP_MS`, `SCENE_KEYS`, `GameSceneData`, `DebriefSceneData`.

How the Integrator wires it (and how QA runs headless, minus the UI line):

```ts
const data = loadGameData({ towers, enemies, economy, waves });   // the four data/*.json imports
const ctx = createGameContext(data, parseTiledMap(mapJson), createFallbackAgentService(data));
const game = await createGame(ctx, { mapId: 'easy', difficulty: 'Easy', saves: createSaveStore(window.localStorage), resume });
const ui = mountGameUi(this, game);          // GameScene.create
game.step(delta); ui.update();               // GameScene.update(time, delta)
```

### 2.2 UI entry points (`src/ui/contracts.ts`, Phaser allowed)

Each returns `UiHandle { update(): void; destroy(): void }`. `ui: UiState` is UI-local selection state (`placing`, `selectedTowerId`, `hoverTile`, `set`, `onChange`), never saved and never part of `GameState`.

| Name : alias | File | Signature | Shows / does |
| --- | --- | --- | --- |
| `createUiState` | `src/ui/uiState.ts` | `() => UiState` | |
| `createFieldView` | `src/ui/FieldView.ts` | `(scene, game) => UiHandle` | grid, path, core, towers, enemies (HP bar, slow tint), projectiles as shapes |
| `createHud` | `src/ui/Hud.ts` | `(scene, game) => UiHandle` | gold, core HP, wave N/20, next-wave preview + caption, `state.activeBossTaunt` when set, build timer, hints left, speed, pause |
| `createBuildBar` | `src/ui/BuildBar.ts` | `(scene, game, ui) => UiHandle` | 4 tower buttons with cost, greyed on `gold:changed` when unaffordable |
| `createPlacementPreview` | `src/ui/PlacementPreview.ts` | `(scene, game, ui) => UiHandle` | ghost + range circle, red when `canPlace` fails; click calls `placeTower`; right-click cancels |
| `createTowerPanel` | `src/ui/TowerPanel.ts` | `(scene, game, ui) => UiHandle` | stats, upgrade cost, sell value, targeting buttons |
| `createHintHighlight` | `src/ui/HintHighlight.ts` | `(scene, game) => UiHandle` | pulsing highlight + message for `state.activeHint`; cleared on `wave:started` |
| `bindKeyboard` | `src/ui/keyboard.ts` | `(scene, game, ui) => UiHandle` | the key map of section 6 |
| `mountGameUi` | `src/ui/index.ts` | `(scene, game) => UiHandle` | creates one `UiState` and all pieces above; the **only** UI call GameScene makes |

`scene` is `Phaser.Scene`, `game` is `GameInstance`. Scene data: MapSelect starts Game with `GameSceneData { mapId, resume }`; GameScene starts Debrief with `DebriefSceneData { mapId, result, stars, input, agents }` after `game:over`, and the Debrief scene calls `agents.getDebrief(input)` once.

### 2.3 Who owns what at run time

| Responsibility | Owner | Rule |
| --- | --- | --- |
| Leak | agent 3, `stepEnemies` | sets `alive = false`, `coreHp = max(0, coreHp − coreDamage)`, emits `enemy:leaked` then `core:damaged`. **Nothing else** |
| **Lost transition** | agent 5, `src/core` fixed-step loop | after **every** system call in a step, if `coreHp <= 0`: phase → Lost, stars 0, delete run save, `attempts++`, `phase:changed`, `game:over`; the step stops there |
| Kill, kill gold | agent 4, `stepCombat` | `alive = false`, `kills++`, `damageDealt`, `enemy:killed`, then `addGold(…, 'kill')` |
| **Cleanup** | agent 5, `src/core` fixed-step loop | after `stepCombat`: drop enemies with `alive === false` and projectiles with `spent === true`. Systems never splice the arrays |
| **`nextId`** | whoever constructs the entity | `id = prefix + state.nextId; state.nextId += 1`. `'e'` in `spawnEnemy` (agent 3), `'p'` in `stepCombat` (agent 4), `'t'` in core's `placeTower` (agent 5). Nobody else touches it |
| Gold changes | everyone, via `addGold` only | `addGold` (agent 5) changes `state.gold` and emits `gold:changed` |
| **Per-wave tallies** | agent 5, `src/core` | `state.currentWaveStats: WaveStats` is created at wave start and updated **only by core's own listeners** on `enemy:spawned` / `enemy:killed` / `enemy:leaked`. At payout it becomes the `WaveRecord`, and `killGold` is `economy:payout.killGoldThisWave` |
| Plan source | agent 5 | `state.planSources[wave]` from each `AgentResponse.source` |
| **Wave-start resets** | agent 5, core's start-wave command | set every tower's `cooldownMs = 0` (towers open each wave ready to fire, matching the balance sim), `activeHint = null`, and `activeBossTaunt` = the taunt for waves 10/20 (`narration.bossTaunts[N][selectBossTaunt(state, ctx)]`) or `null` otherwise |

### 2.4 Map authoring targets (agent 3, `public/maps/easy.json`, Tiled format)

20×12 tiles at 48 px. Use this **reference layout**: it is the geometry `tools/balance-sim.mjs` was balanced on, and it fits the grid (a 2-bend path on 20×12 must be a U to reach ~45 tiles).

- **Path waypoints** (tile-centre coordinates, `x` = column, `y` = row): spawn (−0.5, 1.5) just off the left edge → bend 1 (18.5, 1.5) → bend 2 (18.5, 10.5) → core (1.5, 10.5).
- **Path tiles:** row 1, columns 0-18; column 18, rows 2-10; row 10, columns 2-17. The **core** is tile (1, 10). Path length = **45 tiles** (`economy.simPathLengthTiles`). Bend 1 is at path distance 19 (42%), bend 2 at 28 (62%).
- **Segments by path distance:** `entrance` 0-16.5, `bend_1` 16.5-21.5, `long_straight` 21.5-25.5, `bend_2` 25.5-30.5, `core_approach` 30.5-45. Every path tile is tagged with the segment of its centre.
- **Inside-bend tiles** (4 each, all buildable): bend 1 = (16,2), (17,2), (16,3), (17,3); bend 2 = (16,8), (17,8), (16,9), (17,9).
- **Buildable:** every non-path, non-core tile. Optional blocked decor only on tiles more than 3 tiles from every path tile (so placement matches the sim).
- Map properties: name `Greenhollow Road`, setting `a quiet farm valley with one dirt road winding to the keep`, bosses `Old Ironhide` (wave 10) and `The Greenhollow Warlord` (wave 20).

---

## 3. Chosen numbers and why

### Towers (`data/towers.json`)

Derived per level. Damage is float (never rounded). Refund = floor(totalSpent × 0.7). Upgrade costs are round-half-up(base × 60/100/150%), stored explicitly.

| Tower | Lv | Dmg | Range | Fire ms | DPS | Total spent | Sell | Air | Special |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Arrow | 1 | 10 | 2.5 | 700 | 14.3 | 50 | 35 | yes | |
| | 2 | 14 | 2.63 | 630 | 22.2 | 80 | 56 | | |
| | 3 | 19.6 | 2.75 | 595 | 32.9 | 130 | 91 | | |
| | 4 | 27.4 | 2.88 | 560 | 48.9 | 205 | 143 | | |
| Frost | 1 | 5 | 2.0 | 900 | 5.6 | 75 | 52 | no | splash 0.75, slow 40% for 1500 ms |
| | 2 | 7 | 2.2 | 810 | 8.6 | 120 | 84 | | slow 1875 ms |
| | 3 | 9.8 | 2.4 | 765 | 12.8 | 195 | 136 | | slow 2250 ms |
| | 4 | 13.7 | 2.6 | 720 | 19.0 | 308 | 215 | | slow 2625 ms |
| Cannon | 1 | 32 | 2.5 | 1500 | 21.3 single (×targets in splash) | 100 | 70 | no | splash 1.0 |
| | 2 | 44.8 | 2.63 | 1350 | 33.2 | 160 | 112 | | |
| | 3 | 62.7 | 2.75 | 1275 | 49.2 | 260 | 182 | | |
| | 4 | 87.7 | 2.88 | 1200 | 73.1 | 410 | 287 | | |
| Sniper | 1 | 80 | 5.0 | 2000 | 40.0 | 150 | 105 | yes | |
| | 2 | 112 | 5.25 | 1800 | 62.2 | 240 | 168 | | |
| | 3 | 156.8 | 5.5 | 1700 | 92.2 | 390 | 273 | | |
| | 4 | 219.2 | 5.75 | 1600 | 137.0 | 615 | 430 | | |

The multipliers, the same for all towers except Frost range, are:

- Damage: ×1 / 1.4 / 1.96 / 2.74 (the GDD's +40% per level, compounded).
- Range: ×1 / 1.05 / 1.10 / 1.15 (Frost: 1.1 / 1.2 / 1.3).
- Fire interval: ×1 / 0.9 / 0.85 / 0.8 (**approved at Gate 1**; the GDD now says "plus slightly faster firing").
- Frost slow duration: ×1 / 1.25 / 1.5 / 1.75.

Effective DPS per level is ×1.56 / ×2.31 / ×3.43 of L1 (damage alone would give ×1.4 / ×1.96 / ×2.74).

**Why the fire-rate gain:** with damage alone, an upgrade buys +40% for 60% of the cost, which is strictly worse value than a second tower, and "never upgrade" becomes optimal. With the fire-rate gain an L4 tower is about 0.85× as gold-efficient as new towers but about 3.4× better per tile on a bend, so upgrading good spots is the right play.

Tower roles at L1: Arrow has the best DPS per gold and hits air (the plan's lock). On the reference map a bend-inside Arrow covers 6.6 path tiles (a straight-side one 4.6); the best Sniper tile covers 14 tiles, about 2× an Arrow's exposure. The Cannon wins against packs. Frost makes every other tower's exposure 1.67× longer.

### Enemies (`data/enemies.json`)

Spawn HP = round(baseHp × 1.10^(N−1)) (`economy.enemyHpMultiplierPerWave` = 1.10, Gate 1).

| Enemy | Base HP | HP w5 / w9 / w10 / w15 / w20 | Speed (t/s) | Gold | Threat | Core dmg | Flying | Unlocked on wave N |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Grunt | 60 | 88 / 129 / 141 / 228 / 367 | 1.2 | 4 | 1 | 1 | no | N ≥ 1 |
| Runner | 36 | 53 / 77 / 85 / 137 / 220 | 2.0 | 3 | 1 | 1 | no | N ≥ 3 |
| Brute | 240 | 351 / 514 / 566 / 911 / 1468 | 0.7 | 10 | 3 | 1 | no | N ≥ 5 |
| Flyer | 90 | 132 / 193 / 212 / 342 / 550 | 1.4 | 6 | 2 | 1 | **yes** | N ≥ 7 |
| Boss | 2000 | - / - / 4716 / - / 12232 | 0.5 | 75 | 15 | **5** | no | **N = 10 or 20 only** |

**Unlock rule** (used by `unlockedEnemies`, `WaveDirectorInput.unlocked_enemies` and `validateWavePlan`): an enemy is unlocked on wave N **iff** (`bossWaves` is empty **and** `unlockWave ≤ N`) **or** `bossWaves` includes N. So `unlocked_enemies` lists the Boss on waves 10 and 20 and **not** on 11-19, and the Wave Director prompt's "use only enemy types listed in unlocked_enemies" never invites an off-wave Boss. The Boss's `unlockWave: 10` is ignored because its `bossWaves` is non-empty.

Kill gold is about 3-4 per threat point (the Boss is cheaper per threat, so it isn't a jackpot). Flyers follow the same path as ground units; they just can't be targeted or splashed by `canHitAir: false` towers.

**Why HP scales per wave (not in the GDD):** the 1.12 budget curve grows enemy count, but income grows with it, and towers persist and compound. With no HP growth the map is trivial after wave 3. At ×1.09 NoUpgrades ended on 17 HP, almost as good as Sensible's 19, so Gate 1 settled on ×1.10: Sensible still ends on 19 HP and NoUpgrades loses on wave 20. This remains the main difficulty knob.

### Economy (`data/economy.json`)

| Value | Setting |
| --- | --- |
| Start gold / core HP | 200 / 20 (GDD) |
| Wave clear bonus | 25 + 5 × N (GDD), paid on every cleared wave including 20 |
| Threat budget | budget_N = floor(10 × 1.12^(N−1) + 0.5) (round half up). Valid plan: ceil(0.8 × budget_N) ≤ totalThreat ≤ budget_N |
| Early start | Waves 2-20 get a 20 s build timer (unscaled real time, frozen while paused). At 0 the wave auto-starts with no bonus. Pressing Space with r ms left pays floor(5 × r / 20000), so 0-5 gold. Wave 1 is untimed and pays no bonus (**approved at Gate 1**) |
| Stars | Lost: 0. Won with coreHp = 20 (no core damage): 3. Won with coreHp ≥ 10: 2. Any other win: 1 |
| Hints | 3 per map. **A hint is used up only when a hint (AI or fallback) is shown; the failed AI attempt itself costs nothing.** (Same wording as prompts/02-tactical-advisor.md.) A press with hints left therefore always shows exactly one hint and uses exactly one |
| Grid | 20×12 tiles × 48 px = 960×576, Scale Manager FIT |

**Why the early bonus is capped at 5:** it is a strong lever. In the current sim Sensible ends on 19 HP with or without the bonus. NoUpgrades loses on wave 20 with it but scrapes a 1★ win on 9 HP without it (`--late-start`), because its scripted purchase order spreads differently with less gold; the bonus is small either way. With a 5 cap it is a small reward for confidence, not a required tax.

**Budgets and the scripted waves (`data/waves.easy.json`):**

| N | Budget | Min | Total | % | Mix |
| --- | --- | --- | --- | --- | --- |
| 1 | 10 | 8 | 8 | 80% | 8 Grunt |
| 2 | 11 | 9 | 10 | 91% | 10 Grunt |
| 3 | 13 | 11 | 12 | 92% | 6 Grunt, 6 Runner |
| 4 | 14 | 12 | 14 | 100% | 6 Runner, 8 Grunt |
| 5 | 16 | 13 | 15 | 94% | 6 Grunt, 2 Brute, 3 Runner |
| 6 | 18 | 15 | 17 | 94% | 5 Runner, 6 Grunt, 2 Brute |
| 7 | 20 | 16 | 18 | 90% | 8 Grunt, 2 Runner, 4 Flyer |
| 8 | 22 | 18 | 22 | 100% | 3 Brute, 6 Runner, 3 Grunt, 2 Flyer |
| 9 | 25 | 20 | 22 | 88% | 6 Flyer, 10 Grunt |
| 10 | 28 | 23 | 25 | 89% | 8 Grunt, 2 Runner, **1 Boss** |
| 11 | 31 | 25 | 28 | 90% | 4 Brute, 8 Runner, 4 Flyer |
| 12 | 35 | 28 | 31 | 89% | 12 Grunt, 5 Flyer, 3 Brute |
| 13 | 39 | 32 | 35 | 90% | 16 Runner, 5 Brute, 2 Flyer |
| 14 | 44 | 36 | 39 | 89% | 8 Flyer, 14 Grunt, 3 Brute |
| 15 | 49 | 40 | 44 | 90% | 8 Brute, 10 Runner, 5 Flyer |
| 16 | 55 | 44 | 48 | 87% | 18 Grunt, 6 Brute, 6 Flyer |
| 17 | 61 | 49 | 54 | 89% | 12 Flyer, 12 Runner, 6 Brute |
| 18 | 69 | 56 | 60 | 87% | 20 Grunt, 8 Brute, 8 Flyer |
| 19 | 77 | 62 | 70 | 91% | 10 Brute, 15 Runner, 10 Flyer, 5 Grunt |
| 20 | 86 | 69 | 77 | 90% | 12 Grunt, 10 Brute, 10 Flyer, **1 Boss** |

Every wave obeys the Wave Director's hard rules. The sim re-checks the wave number, totalThreat, budget range, unlocks and the Boss rule on every run; group count, count, interval, delay and text lengths were checked once by hand and are covered by QA's `validateWavePlan` test:

- Only unlocked enemies (unlock rule above); the Boss appears exactly once, on waves 10 and 20, and never elsewhere.
- 1-4 groups, count 1-30, interval 300-3000 ms, delay 0-20000 ms.
- previewText ≤ 80 chars; reason ≤ 25 words.

The Easy fallback mostly spends about 90%, which leaves headroom for the AI Director to push harder.

### Economy sanity check (actual sim output)

From `node tools/balance-sim.mjs`, Sensible build. Gold earned = start 200 + every kill's `goldReward` + (25 + 5N) per cleared wave + the early bonus actually paid (5 on waves 2-20, since the scripted player presses Space at once). It is counted **before** that wave's build phase. The towers are the ones owned after that phase's purchases.

| Before wave | Gold earned to date | Value of towers owned | Defense after buying (type+level) |
| --- | --- | --- | --- |
| 5 | 525 | 435 | A2 A2 A1 A1 F1 C1 |
| 10 | 1172 | 1140 | A3 A3 A2 A2 F2 C3 S2 C1 |
| 15 | 2175 | 2115 | A4 A3 A3 A3 F2 C4 S3 C2 S2 S1 A1 |
| 20 | 3659 | 3635 | A4 A4 A4 A4 F3 C4 S4 C2 S4 S4 A4 |

Total gold over the match is 4,072. The ceiling with no leaks and the full early bonus is 4,076 (3,981 without the early bonus). Sensible lost 4 gold to one leaked wave-3 Grunt. The defense spends almost everything it earns, so a leak-heavy player falls behind fast.

**Boss check (wave 10, Sensible).** The Boss has 4,716 HP at 0.5 t/s, so it needs **90 s** to walk the 45-tile path unslowed. It is slower only while a Frost slow is active (Frost covers about 6 of the 45 tiles here), not for the whole path. The sim kills it at path distance 26.4 of 45 (59%). Against an unkillable Boss the same defense deals 6,374 damage over the full walk, a **1.35× margin**. Wave 20: 12,232 HP, killed at 57% of the path, 1.61× margin.

**Air check:** wave 9 sends 6 Flyers at **193 HP** each (1,158 air HP). Two L1 Arrows at the bend-1 inside corner cover 6.6 tiles each, about 4.7 s of exposure at 1.4 t/s. That is 2 × 14.3 DPS × 4.7 s ≈ 134 damage per Flyer, so every Flyer leaks. One L1 Sniper on the best tile (14 tiles covered, about 10 s) adds 40 DPS × 10 s = 400. That is why an air-capable investment by wave 7 is needed, and why Arrows (not only the 150-gold Sniper) count as one. The NoAir build confirms it: it starts leaking Flyers on wave 7 and dies on wave 11.

---

## 4. Simulation rules (all in core TS)

**Movement** (`stepEnemies`, agent 3). Each step:

- Enemies advance `pathDistance += speed × (1 − slowPct/100) × dt`.
- `pos` comes from `MapQueries.positionAt`.
- `slowRemainingMs` decays; at 0, `slowPct` is reset to 0.
- When `pathDistance ≥ pathLength`, the enemy leaks: `alive = false`, `coreHp = max(0, coreHp − coreDamage)`, no gold, `enemy:leaked` then `core:damaged`. `stepEnemies` does nothing else on a leak.
- **Core**, not `stepEnemies`, checks `coreHp ≤ 0` after every system call and runs the Lost transition at once, even mid-wave (section 2.3).

**Targeting** (`selectTarget`; candidates are enemies within range by Euclidean distance from tower centre to enemy `pos`; `canHitAir: false` excludes flying enemies):

- First: highest `pathDistance`.
- Strongest: highest current `hp`, ties broken by First.
- Closest: smallest distance, ties broken by First.
- Final tie: lowest id. New towers default to First.

**Firing.** When `cooldownMs ≤ 0` and a target exists, the tower spawns a homing projectile (`'p'` id, `spent: false`) with a snapshot of its stats and sets `cooldownMs = fireRateMs`. With no target, cooldown stays at 0, so the tower fires the moment something enters range.

**Projectiles.** They move at `projectileSpeed` toward the target. They hit when the remaining distance is ≤ this step's travel + the target's radius.

- If the target died first, single-target shots disappear (fizzle) and splash shots detonate at `lastTargetPos`.
- On hit, a single-target shot damages only the target.
- A splash shot (`splashRadius > 0`) damages every eligible enemy within `splashRadius` of the impact point, primary included. Frost and Cannon splash never touch Flyers.
- Frost hits also apply slow: `slowPct = max(current, 40)` and `slowRemainingMs = max(current, slowMs)`. Slows don't stack. The Boss can be slowed.
- A projectile that hits or fizzles gets `spent = true`; core's cleanup removes it.

**Kills** (`stepCombat`). At hp ≤ 0 (checked once per hit), the enemy dies:

- `alive = false`. Gold is added once, through `addGold(state, ctx, goldReward, 'kill')`.
- The firing tower gets `kills++`.
- `damageDealt` adds the damage actually applied (capped at the hp remaining).
- Events fire: `enemy:killed`, then `gold:changed` (from `addGold`).

**Spawning** (`stepSpawner`). Every group is independent. Enemy `i` of a group spawns at `startDelayMs + i × spawnIntervalMs` of wave time, via `spawnEnemy`, at path distance 0, with HP scaled for the wave.

**Per-step order** (core): `stepSpawner` → `stepEnemies` → `stepCombat` → cleanup → `isWaveClear`. The `coreHp ≤ 0` check runs after each of the first three.

**Wave clear.** All groups are fully spawned and no enemies or projectiles remain.

**Spending:**

- Place, upgrade and sell are allowed **in the Build phase only**. Retargeting is free and allowed in Build and Combat.
- Place requires a buildable, unoccupied tile and gold ≥ cost (`canPlace`).
- Upgrade requires level < 4 and gold ≥ `upgradeCosts[level−1]`.
- Sell refunds floor(totalSpent × 0.7) and frees the tile.

---

## 5. Event flow for one wave

```
BUILD (wave N)            state.phase=Build, currentPlan = plan N (preview shown), buildTimerMs = 20000 (null on N=1)
  player: place/upgrade/sell/retarget  -> tower:* , gold:changed
  player: H                            -> agents.getHint(buildHintInput) -> hint:shown (hintsLeft-- here, and only here)
  timer ticks (real ms, not when paused)-> build:timer
START                     Space (bonus = floor(5*r/20000)) or timer reaches 0 (bonus 0)
  gold += bonus                        -> gold:changed{reason:'earlyStart'} (if > 0)
  currentWaveStats = new WaveStats     (core)
  tower cooldowns = 0, activeHint = null, activeBossTaunt set on N = 10/20   (core)
  phase Build->Combat                  -> phase:changed, wave:started{plan, earlyStartBonus}
  fire-and-forget agents.planWave(buildWaveDirectorInput for N+1) -> nextPlan; wave:planned  (N < 20)
COMBAT (fixed steps)      order per step: spawner -> enemies(move/slow/leak) -> combat(fire/projectiles/hit/splash/kill) -> cleanup (core)
  spawns                               -> enemy:spawned          (core tallies into currentWaveStats)
  hits                                 -> tower:fired, projectile:hit, enemy:damaged
  kills                                -> enemy:killed, gold:changed{reason:'kill'}   (core tallies)
  leaks                                -> enemy:leaked, core:damaged                  (core tallies; coreHp<=0 -> LOST)
PAYOUT                    when isWaveClear
  gold += 25 + 5N                      -> economy:payout{killGoldThisWave = currentWaveStats.killGold}, gold:changed{reason:'waveClear'}
  push WaveRecord (from currentWaveStats), playedPlans[N] -> wave:cleared
  N == 20 -> WON: stars, delete run save, ProgressSave (bestStars, attempts++) -> phase:changed(Won), game:over
  else    -> wave = N+1, currentPlan = nextPlan ?? fallback waves[N], nextPlan = null,
             phase Combat->Build       -> phase:changed
AUTOSAVE                  serialize RunSave (wave=N+1, pendingPlan=currentPlan) -> save:written
LOST (core, mid-step)     phase -> Lost, stars 0, delete run save, ProgressSave attempts++ -> phase:changed(Lost), game:over
DEBRIEF                   GameScene starts Debrief with DebriefSceneData; Debrief calls agents.getDebrief(input) once
```

At map start: `createGame` builds the state, then calls `getNarration` once and `planWave(1)`. It stores both (`narration:ready`, `wave:planned`) and enters Build for wave 1. On resume, the stored `narration` and `pendingPlan` are used, with **no new agent calls**. `attemptNumber` = `ProgressSave.attempts[mapId] + 1` (1 without a save store), or `resume.attemptNumber`.

**Fallback behaviour (agent 5, `src/agents/`):**

- `planWave(N)` returns `waves.easy.json` wave N.
- `getHint` is rule-based, first match wins:
  1. Flyers are next and no air tower is at a bend: place a Sniper (or an Arrow if the Sniper is unaffordable) on the best tile near `bend_2`.
  2. Brutes or the Boss are next and an upgrade is affordable: upgrade the highest-DPS tower.
  3. There were leaks last wave: place the cheapest affordable tower near the leak segment (`core_approach`, since every leak happens there).
  4. Otherwise: `none`, with a save-gold message.
- Hint cost: a hint is used up only when a hint (AI or fallback) is shown; the failed AI attempt itself costs nothing.
- `getNarration` returns stock text that meets the Narrator length rules. The boss taunt is picked by `selectBossTaunt` (agent 5, `src/agents`) at the start of waves 10 and 20: the tower type with the most gold spent across current towers, or `mixed` if none has more than 40%. Core stores the text in `state.activeBossTaunt` and Hud shows it.
- `getDebrief` returns a stats-only result built from `WaveRecord`s. Every agent call must have a valid fallback even when offline.
- `buildHintInput` sets `last_wave_leaks[i].leakedAt = 'core_approach'` for every entry (leaks are stored as counts; there is no per-leak record).

---

## 6. Controls (desktop prototype)

| Key / mouse | Action | Source |
| --- | --- | --- |
| Click build-bar button, then click tile | Place tower; ghost + range circle; red if invalid or unaffordable | GDD |
| Click placed tower | Open tower panel: stats, upgrade cost, sell value, targeting | GDD |
| **H** | Request hint (Build only; disabled at 0 hints) | GDD |
| **Space** | Start next wave (Build only; pays early bonus) | GDD |
| **1 / 2 / 3** | Game speed ×1 / ×2 / ×3 | GDD |
| **Esc** | Cancel placement or close panel if one is open; otherwise toggle pause | GDD + assumption |
| Q / W / E / R | Select Arrow / Frost / Cannon / Sniper for placement | assumption |
| U / S / T | Upgrade / sell / cycle targeting of the selected tower | assumption |
| Right-click | Cancel placement | assumption |

Affordability greys out build-bar buttons live (on `gold:changed`). All of this is implemented by `bindKeyboard`, `createBuildBar`, `createPlacementPreview` and `createTowerPanel` (section 2.2).

---

## 7. Save

- One run slot per map at `bastion-line:run:v1:<mapId>` (`RunSave`), plus `bastion-line:progress:v1` (`ProgressSave`: best stars and finished-attempt counts per map; no settings).
- Access goes through `SaveStore` (`createSaveStore(window.localStorage)` in the game, `createSaveStore(null)` = in-memory in tests).
- The run is written **only at payout** and deleted on Won or Lost.
- MapSelect shows "Continue" if a run save exists.
- Restoring (`restoreRun`) rebuilds towers with `cooldownMs = 0`, restores `nextId` and `planSources`, and starts in Build for `save.wave`.
- Loads with an unknown `version` are ignored and deleted.

---

## 8. QA and balance acceptance

Tests must cover:

- Upgrade costs equal round-half-up(base × 0.6/1.0/1.5): Arrow 30/50/75, Frost 45/75/113, Cannon 60/100/150, Sniper 90/150/225.
- Refund is floor(0.7 × spent).
- The clear bonus is 25 + 5N.
- The star thresholds.
- Each of the 20 scripted waves passes `validateWavePlan`.
- **`unlockedEnemies`**: wave 9 = Grunt, Runner, Brute, Flyer (no Boss); wave 10 = those + Boss; wave 11 = no Boss; wave 20 = with Boss.
- Targeting tie-breaks and air rules.
- Early bonus: 0..5, and 0 on wave 1.
- Hints: a failed AI call followed by the fallback uses exactly one hint.
- A leak that takes coreHp to 0 mid-wave ends the game in the same step (Lost, stars 0) and `stepEnemies` alone does not change `phase`.

### Balance sim

Run it from `bastion-line/`:

```
node tools/balance-sim.mjs              # summary, economy and Boss tables
node tools/balance-sim.mjs --verbose    # plus a per-wave trace for every build
node tools/balance-sim.mjs --late-start # the player never presses Space (no early bonus)
node tools/balance-sim.mjs --data <dir> # tuning experiments against a copy of data/
```

It is plain Node with no dependencies. It reads every number from `data/*.json` (`goldReward`, the 25 + 5N clear bonus, the early-start rule, HP growth, tower stats and multipliers) and re-validates all 20 scripted waves. It plays them on the section 2.4 reference layout: a 1D path distance mapped onto the 45-tile polyline, with Euclidean ranges, the section 4 rules, homing projectiles with travel time, splash and slow, and fixed 1000/60 ms steps. The scripted player buys at each build start in list order while the next item is affordable, placing each new tower on the free tile with the most path in range. Then it presses Space at once (+5 gold on waves 2-20).

Output with HP growth ×1.10:

| Build | Script | Result | Final HP | Wave lost | Stars | Leaks | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sensible | 4 Arrows, Frost and Cannon at the bends by w4, Sniper by w6, upgrades, 2nd Cannon and Sniper, 3rd Sniper ~w15, then upgrade everything (air first) | **Win** | **19** | - | 2 | w3: 1 Grunt | win with ≥ 10 HP — **met** |
| NoAir | 2 Arrows never upgraded, then only Frost and Cannons, all upgraded | **Loss** | 0 | **11** | 0 | Flyers w7-9 and w11, Boss w10 | loses — **met** |
| NoUpgrades | Sensible's tower mix, new towers only, spreading to worse tiles (50 towers by w20) | **Loss** | 0 | **20** | 0 | w1: 1 Grunt, Flyers w17-20 | ≤ 12 HP or loses — **met** |
| ArrowsOnly | 12 Arrows, all upgraded, no splash or slow | **Loss** | 0 | **19** | 0 | Boss w10, Flyer w17, 2 Brutes w18, 1 Flyer + 4 Grunts + 7 Brutes w19 | loses or ≤ 8 HP — **met** |

Towers at the end: Sensible `A4 A4 A4 A4 F3 C4 S4 C2 S4 S4 A4`; NoAir `A1 A1 C3 F3 C3 C2 C2 F1`; ArrowsOnly 12 × `A4`. With `--late-start`: Sensible 19 HP, NoAir lost w11, NoUpgrades 9 HP (1★), ArrowsOnly lost w19.

**Data retuned:** `enemyHpMultiplierPerWave` stays at 1.10 (Gate 1, after a ×1.09 trial) and `simPathLengthTiles` 46 → 45 (the reference layout). No other data value needed tuning.

QA's own sim (`sim/`, phase 5) must drive the real `createGame` with these 4 builds and land within about ±3 HP of this table (same win/loss). A bigger gap means the build and this spec disagree about a rule. The Integrator reports it; nobody retunes to hide it.

---

## 9. Assumptions (values and rules I invented)

1. **Every tower stat except cost**: damage, range, fire rate, projectile speed, Frost damage 5, slow 1500 ms, Frost splash 0.75, Cannon splash 1.0.
2. **Upgrade multipliers**: damage ×1.4 compounding, range +5%/level (Frost +10%), fire interval −10/15/20% (approved at Gate 1), Frost slow duration +25%/level. Slow strength stays at 40% at every level.
3. **Rounding**:
   - Upgrade cost: round half up (Frost 112.5 → 113).
   - Sell: floor.
   - Threat budget: floor(x + 0.5).
   - Minimum spend: ceil(0.8 × budget).
   - Enemy HP: Math.round.
   - Damage: float.
4. **Every enemy stat**: HP, speed, gold, radius, Boss 2000 base HP / 0.5 t/s / 75 gold. `bossWaves: [10, 20]` plus the unlock rule (section 3) encodes "Boss only on 10 and 20".
5. **Enemy HP scaling ×1.10 per wave** (not in the GDD; confirmed at Gate 1 after a ×1.09 trial).
6. **Early start**: 20 s real-time build timer with auto-start, bonus 0-5 gold scaled by time left, wave 1 untimed (approved at Gate 1).
7. **Spending is Build-phase only**; retargeting is allowed anytime.
8. **Flyers follow the ground path** (they don't fly straight to the core). Frost and Cannon splash do not affect them.
9. **Slows do not stack** (max pct, max duration). The Boss is slowable.
10. **Loss is immediate** when coreHp hits 0 mid-wave (run by core). The clear bonus is also paid on wave 20.
11. **2★ threshold** is coreHp ≥ 10 (50% of 20, inclusive).
12. **Fixed step** of 1000/60 ms; speed multiplies steps; the build timer uses unscaled time.
13. **Homing projectiles**: single-target shots fizzle on a dead target; splash detonates at the last position.
14. **Targeting tie-break rules** (section 4) and the default mode First.
15. **Extra keys** Q/W/E/R, U/S/T, right-click, and Esc closing panels before pausing.
16. **`src/core/` folder** and its ownership by agent 5; entry-module names and the run-time ownership table (section 2).
17. **Easy map name, setting, boss names and the reference U layout** (section 2.4).
18. **Save keys**, one slot per map, save deleted at game over, `pendingPlan`/`narration`/`planSources` stored so a resume makes no agent call; `attempts` counts finished runs (Won or Lost).
19. **Hint fallback rule order** and the hint-cost wording shared with prompts/02.
20. **The 20 wave compositions**, spawn intervals, delays and preview text.
21. **Placeholder colours** per unit.
22. **Leaks are counts only** (no per-leak record); `leakedAt` is always `core_approach`.

---

## 10. Open questions for the human

Resolved at Gate 1: HP growth (×1.10, after a ×1.09 trial made NoUpgrades nearly as good as Sensible), upgrade fire-rate gain (kept), 20 s build timer with auto-start (kept).

1. **Sensible is close to a 3★ run (19 HP)** on Easy. Fine for an Easy map? The Wave Director (Milestone 2) is meant to add pressure on top.
2. **Spending during combat**: currently disallowed. Allowing it is friendlier but weakens the preview-and-counter loop the agents are built around.
