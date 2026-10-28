/**
 * Bastion Line - shared contract types (phase 1, Spec Writer).
 *
 * RULES
 * - Pure types plus a few `as const` lookup objects. No Phaser imports, no DOM, no Node APIs.
 *   Core logic (combat, economy, waves, agents, save) must run headless in Vitest against these types.
 * - Build agents MUST NOT edit this file. Request changes through the Integrator (see SPEC.md section 2).
 * - Cross-folder functions are declared here as function-type aliases (section "Cross-folder function
 *   contracts" at the end). Each folder's entry module (src/<folder>/index.ts) exports them under the
 *   exact names listed in SPEC.md section 2, typed with these aliases, e.g.
 *     export const spawnEnemy: SpawnEnemy = (state, ctx, type) => { ... };
 * - Parameter style (one rule for every alias):
 *     state systems and state queries:  (state: GameState, ctx: GameContext, ...args)
 *     pure data lookups:                (data: GameData, ...args)
 *     constructors / factories:         (their inputs) => the thing
 * - Units: distances/positions in TILES (float), speeds in tiles/second, times in milliseconds,
 *   money in integer gold. Rendering converts tiles -> pixels with economy.grid.tileSize (48).
 * - Agent input objects use the exact snake_case keys from prompts/*.md so they can be
 *   JSON.stringify'd straight into the user message. Agent outputs use the prompts' camelCase keys.
 */

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

export type TowerType = 'Arrow' | 'Frost' | 'Cannon' | 'Sniper';
export type EnemyType = 'Grunt' | 'Runner' | 'Brute' | 'Flyer' | 'Boss';
export type TargetingMode = 'First' | 'Strongest' | 'Closest';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type MapId = 'easy' | 'medium' | 'hard';
/** 1 = base tower, 4 = fully upgraded (3 upgrades). */
export type TowerLevel = 1 | 2 | 3 | 4;
export type GameSpeed = 1 | 2 | 3;
export type StarCount = 0 | 1 | 2 | 3;

export const TOWER_TYPES: readonly TowerType[] = ['Arrow', 'Frost', 'Cannon', 'Sniper'] as const;
export const ENEMY_TYPES: readonly EnemyType[] = ['Grunt', 'Runner', 'Brute', 'Flyer', 'Boss'] as const;
export const TARGETING_MODES: readonly TargetingMode[] = ['First', 'Strongest', 'Closest'] as const;

/**
 * Game phase. Declared as a const object + union (not a TS `enum`) so it works under
 * `isolatedModules` / `erasableSyntaxOnly` and in plain JSON saves.
 */
export const GamePhase = {
  Build: 'Build',
  Combat: 'Combat',
  Won: 'Won',
  Lost: 'Lost',
} as const;
export type GamePhase = (typeof GamePhase)[keyof typeof GamePhase];

/** Named stretches of the path. The map must tag every path tile with one of these. */
export type PathSegmentId = 'entrance' | 'bend_1' | 'long_straight' | 'bend_2' | 'core_approach';
export const PATH_SEGMENTS: readonly PathSegmentId[] = [
  'entrance',
  'bend_1',
  'long_straight',
  'bend_2',
  'core_approach',
] as const;

export interface TileCoord {
  /** Column, 0..cols-1 */
  x: number;
  /** Row, 0..rows-1 */
  y: number;
}

/** Continuous position in tile units; tile (x,y) has its centre at (x + 0.5, y + 0.5). */
export interface Vec2 {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Data file shapes (data/*.json)                                      */
/* ------------------------------------------------------------------ */

/** Index i = level (i+1). All arrays have exactly 4 entries; entry 0 is always 1.0. */
export interface TowerLevelMultipliers {
  /** Multiplies base damage. */
  damage: [number, number, number, number];
  /** Multiplies base range. */
  range: [number, number, number, number];
  /** Multiplies base fireRateMs (values < 1 = faster). */
  fireRate: [number, number, number, number];
  /** Multiplies base slowMs (Frost only; 1.0 elsewhere). */
  slowDuration: [number, number, number, number];
}

export interface TowerDef {
  id: TowerType;
  name: string;
  role: string;
  /** Base placement cost in gold. */
  cost: number;
  /** Damage per hit at level 1 (float math; do not round). */
  damage: number;
  /** Range in tiles, Euclidean, tower tile centre to enemy position. */
  range: number;
  /** Milliseconds between shots at level 1 (game time). */
  fireRateMs: number;
  /** true = may target and hit flying enemies. */
  canHitAir: boolean;
  /** Splash radius in tiles around the impact point; 0 = single target. */
  splashRadius: number;
  /** Slow strength in percent (40 = enemy moves at 60% speed); 0 = none. */
  slowPct: number;
  /** Slow duration in ms at level 1; 0 = none. */
  slowMs: number;
  /** Projectile travel speed in tiles/second. */
  projectileSpeed: number;
  /**
   * Gold to go L1->L2, L2->L3, L3->L4. Pre-computed as round-half-up(cost * upgradeCostPct[i]).
   * Code MUST read these values, not recompute them.
   */
  upgradeCosts: [number, number, number];
  levelMultipliers: TowerLevelMultipliers;
  /** Placeholder fill colour (hex) until real art exists. */
  color: string;
}

export interface TowersFile {
  version: 1;
  /** GDD: 60% / 100% / 150% of base cost. Informational; upgradeCosts is authoritative. */
  upgradeCostPct: [number, number, number];
  /** GDD: 0.7. refund = floor(totalSpent * sellRefundPct). */
  sellRefundPct: number;
  maxLevel: 4;
  towers: Record<TowerType, TowerDef>;
}

export interface EnemyDef {
  id: EnemyType;
  name: string;
  trait: string;
  /** Base HP at wave 1. Spawned HP = round(hp * economy.enemyHpMultiplierPerWave ^ (wave - 1)). */
  hp: number;
  /** Base move speed in tiles/second along the path. */
  speed: number;
  /** Gold paid once when killed by a tower (not paid on leak). */
  goldReward: number;
  /** Threat cost used by the Wave Director budget. */
  threatCost: number;
  /** Core HP lost when this enemy reaches the end of the path. */
  coreDamage: number;
  /** Flying enemies follow the same path but can only be hit by towers with canHitAir. */
  flying: boolean;
  /**
   * First wave this enemy may appear in. Ignored when bossWaves is non-empty.
   *
   * UNLOCK RULE (unlockedEnemies, WaveDirectorInput.unlocked_enemies, validateWavePlan):
   *   enemy is unlocked on wave N  iff  (bossWaves.length === 0 && unlockWave <= N) || bossWaves.includes(N)
   * So the Boss is unlocked ONLY on waves 10 and 20 (not on 11-19), even though its unlockWave is 10.
   */
  unlockWave: number;
  /** Non-empty only for Boss: the ONLY waves it may appear in ([10, 20]); see the unlock rule above. */
  bossWaves: number[];
  /** Collision/visual radius in tiles (render + projectile hit test). */
  radius: number;
  color: string;
}

export interface EnemiesFile {
  version: 1;
  enemies: Record<EnemyType, EnemyDef>;
}

export interface EconomyFile {
  version: 1;
  startGold: number;
  startCoreHp: number;
  /** Clearing wave N pays base + perWave * N. */
  waveClearBonus: { base: number; perWave: number };
  earlyStart: {
    /** Build-phase countdown for waves 2..20 (unscaled real time; pauses with Esc). Auto-starts at 0. */
    buildTimerMs: number;
    /** Bonus = floor(maxBonus * remainingMs / buildTimerMs) when the player starts early. */
    maxBonus: number;
    /** false: the wave 1 build phase has no timer and pays no early bonus. */
    firstWaveTimed: boolean;
  };
  threat: {
    wave1Budget: number;
    budgetGrowth: number;
    /** totalThreat must be >= ceil(minSpendPct * budget). */
    minSpendPct: number;
    /** budget_N = floor(wave1Budget * budgetGrowth^(N-1) + 0.5) */
    rounding: 'roundHalfUp';
  };
  /** Enemy HP scales by this factor per wave (exponential). */
  enemyHpMultiplierPerWave: number;
  stars: {
    threeStarRequiresNoCoreDamage: boolean;
    /** 2 stars when coreHp >= twoStarMinHpPct * startCoreHp. */
    twoStarMinHpPct: number;
    oneStarOnClear: boolean;
  };
  hintsPerMap: number;
  waveCount: number;
  grid: { cols: number; rows: number; tileSize: number; width: number; height: number };
  gameSpeeds: GameSpeed[];
  /** Path length of the reference layout (SPEC.md section 2.4). tools/balance-sim.mjs asserts its waypoints match it; the real map must match it too. */
  simPathLengthTiles: number;
}

/** One spawn group. Identical to the Wave Director output schema (prompts/01-wave-director.md). */
export interface WaveGroup {
  enemy: EnemyType;
  /** 1..30 */
  count: number;
  /** 300..3000; ms between consecutive spawns in this group (game time). */
  spawnIntervalMs: number;
  /** 0..20000; ms after wave start before this group's first spawn (game time). */
  startDelayMs: number;
}

/** Wave Director output (= one entry of data/waves.easy.json). */
export interface WavePlan {
  wave: number;
  /** 1..4 groups */
  groups: WaveGroup[];
  /** sum(count * threatCost); must satisfy ceil(0.8*budget) <= totalThreat <= budget. */
  totalThreat: number;
  /** <= 80 chars, shown in the next-wave preview. */
  previewText: string;
  /** <= 25 words, developer logs only, never shown. */
  reason: string;
}

export interface WavesFile {
  version: 1;
  map: MapId;
  source: 'scripted';
  /** Exactly waveCount (20) entries, wave 1..20 in order. */
  waves: WavePlan[];
}

/** Everything loaded from data/. Passed to every core system. */
export interface GameData {
  towers: TowersFile;
  enemies: EnemiesFile;
  economy: EconomyFile;
  waves: WavesFile;
}

/* ------------------------------------------------------------------ */
/* Map (produced by src/map from public/maps/<id>.json, Tiled format)  */
/* ------------------------------------------------------------------ */

export interface PathWaypoint extends Vec2 {
  /** Cumulative path distance in tiles from the spawn point to this waypoint. */
  distance: number;
  segment: PathSegmentId;
}

export interface MapDef {
  id: MapId;
  name: string;
  difficulty: Difficulty;
  /** One line, used by the Battle Narrator input. */
  setting: string;
  bossNames: { '10': string; '20': string };
  cols: number;
  rows: number;
  /** Ordered waypoints at tile centres, first = spawn (may sit just off-grid), last = core. */
  path: PathWaypoint[];
  /** Total path length in tiles (= last waypoint distance). */
  pathLength: number;
  /** Tiles the path occupies (not buildable). */
  pathTiles: TileCoord[];
  /** Tiles where a tower may be placed (excludes path, core, blocked decor). */
  buildableTiles: TileCoord[];
  /** Core tile (end of path). */
  core: TileCoord;
}

/** Pure map queries implemented in src/map; no Phaser. */
export interface MapQueries {
  isBuildable(tile: TileCoord): boolean;
  /** Position and segment at a path distance (clamped to [0, pathLength]). */
  positionAt(distance: number): { pos: Vec2; segment: PathSegmentId };
  /** Nearest path segment to a tile (for agent inputs: tower.pathSegment, buildable_tiles.nearPath). */
  segmentForTile(tile: TileCoord): PathSegmentId;
}

/* ------------------------------------------------------------------ */
/* Runtime entities                                                    */
/* ------------------------------------------------------------------ */

/** Effective stats of a tower at a given level (computed from TowerDef + multipliers). */
export interface TowerStats {
  damage: number;
  range: number;
  fireRateMs: number;
  canHitAir: boolean;
  splashRadius: number;
  slowPct: number;
  slowMs: number;
  projectileSpeed: number;
}

export interface EnemyInstance {
  /** Unique within a run, e.g. "e42". */
  id: string;
  type: EnemyType;
  hp: number;
  maxHp: number;
  /** Base speed in tiles/s (copied from EnemyDef). Effective speed = speed * (1 - slowPct/100) while slowed. */
  speed: number;
  /** Distance travelled along the path in tiles; drives "First" targeting. */
  pathDistance: number;
  /** Current position in tile units (derived from pathDistance each step). */
  pos: Vec2;
  segment: PathSegmentId;
  flying: boolean;
  /** Active slow percent (0 when not slowed). */
  slowPct: number;
  /** Remaining slow time in ms (game time). */
  slowRemainingMs: number;
  /** Wave in which it spawned. */
  wave: number;
  /** false once killed or leaked. Systems never splice the arrays; only core's cleanup step removes dead entries (SPEC.md 2.3). */
  alive: boolean;
}

export interface TowerInstance {
  /** Unique within a run, e.g. "t3". Stable across save/load (agent inputs reference it). */
  id: string;
  type: TowerType;
  level: TowerLevel;
  tile: TileCoord;
  targeting: TargetingMode;
  /** Base cost + all upgrade costs paid. Sell refund = floor(totalSpent * 0.7). */
  totalSpent: number;
  /** Ms until the tower may fire again (game time). 0 = ready. */
  cooldownMs: number;
  kills: number;
  damageDealt: number;
  placedOnWave: number;
}

export interface ProjectileInstance {
  id: string;
  towerId: string;
  towerType: TowerType;
  /** Homing target; if it dies first, the projectile flies to lastTargetPos. */
  targetId: string;
  lastTargetPos: Vec2;
  pos: Vec2;
  /** Snapshot of the firing tower's stats at the moment of firing. */
  damage: number;
  speed: number;
  splashRadius: number;
  slowPct: number;
  slowMs: number;
  canHitAir: boolean;
  /** Set true by stepCombat when the projectile hits or fizzles; core's cleanup step removes it. */
  spent: boolean;
}

/* ------------------------------------------------------------------ */
/* Match log / history (feeds save, Wave Director, Match Analyst)      */
/* ------------------------------------------------------------------ */

export type EnemyCounts = Partial<Record<EnemyType, number>>;

/*
 * Leaks are stored as counts only (WaveRecord.leaks). Enemies can only leak at the end of the path,
 * which is always in the 'core_approach' segment, so buildHintInput sets
 * HintInput.last_wave_leaks[i].leakedAt = 'core_approach' for every entry.
 */

/**
 * Running tally for the wave in Combat (GameState.currentWaveStats). Owned by src/core only:
 * core creates it at wave start and updates it from its OWN listeners on enemy:spawned,
 * enemy:killed and enemy:leaked. Agents 3 and 4 never touch it. At payout it becomes a WaveRecord.
 */
export interface WaveStats {
  wave: number;
  /** Spawned so far, by type. */
  enemies: EnemyCounts;
  kills: EnemyCounts;
  leaks: EnemyCounts;
  coreDamage: number;
  /** Sum of enemy:killed.gold this wave (= economy:payout.killGoldThisWave). */
  killGold: number;
  /** Gold at the start of this wave's build phase. */
  goldStart: number;
  earlyStart: boolean;
  earlyStartBonus: number;
  planSource: AgentSource;
}

export interface WaveRecord {
  wave: number;
  enemies: EnemyCounts;
  kills: EnemyCounts;
  leaks: EnemyCounts;
  coreDamage: number;
  /** Gold at the start of this wave's build phase. */
  goldStart: number;
  /** Gold after this wave's payout. */
  goldEnd: number;
  earlyStart: boolean;
  earlyStartBonus: number;
  /** Where the plan came from (for debugging AI vs fallback). */
  planSource: AgentSource;
}

export interface HintUseRecord {
  wave: number;
  action: HintAction;
  towerType: TowerType | null;
  /** Set true if, before the wave started, the player performed the hinted action. */
  followed: boolean;
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

export interface GameState {
  mapId: MapId;
  difficulty: Difficulty;
  phase: GamePhase;
  /**
   * In Build: the wave about to be played (1..20). In Combat: the wave being played.
   * In Won: 20. In Lost: the wave that was lost.
   */
  wave: number;
  gold: number;
  coreHp: number;
  coreHpMax: number;
  towers: TowerInstance[];
  enemies: EnemyInstance[];
  projectiles: ProjectileInstance[];
  /** Plan for `wave` (shown as preview in Build; being spawned in Combat). */
  currentPlan: WavePlan | null;
  /** Plan for wave + 1, requested at Combat start; null until resolved or after wave 20. */
  nextPlan: WavePlan | null;
  /** Spawn cursor for the running wave. */
  spawn: SpawnState | null;
  /** Remaining build-phase countdown in ms; null when untimed (wave 1) or not in Build. */
  buildTimerMs: number | null;
  hintsLeft: number;
  speed: GameSpeed;
  paused: boolean;
  /** Total game time in ms (scaled by speed, excludes pause). */
  elapsedMs: number;
  /** Battle Narrator output for this map (fallback or AI), fetched once at map start. */
  narration: NarrationResult | null;
  /** Latest hint, shown/highlighted until the next wave starts. Core's wave start sets it back to null. */
  activeHint: HintResult | null;
  /**
   * Boss taunt text for the running wave. Core sets it at the start of waves 10 and 20 from
   * narration.bossTaunts[wave][selectBossTaunt(state, ctx)] and sets it to null at the next wave start. Hud shows it.
   */
  activeBossTaunt: string | null;
  waveHistory: WaveRecord[];
  hintsUsed: HintUseRecord[];
  /** Plans actually played, by wave number (stored in the save for replays). */
  playedPlans: Record<number, WavePlan>;
  /** Where each resolved plan came from, by wave number (current, next and played plans). */
  planSources: Record<number, AgentSource>;
  /** Tally for the wave in Combat; null in Build/Won/Lost. Owned by src/core (see WaveStats). */
  currentWaveStats: WaveStats | null;
  /** Gold when the current build phase began (copied into WaveStats.goldStart). */
  buildGoldStart: number;
  /**
   * Single shared id counter. RULE: the function that constructs an entity allocates its id with
   *   const id = `${prefix}${state.nextId}`; state.nextId += 1;
   * Prefixes and owners: 't' towers (core, placeTower command), 'e' enemies (enemies/spawnEnemy),
   * 'p' projectiles (combat/stepCombat). No other code changes it. Restored from RunSave.nextId.
   */
  nextId: number;
  attemptNumber: number;
  /** Set when phase becomes Won or Lost. */
  stars: StarCount | null;
}

export interface SpawnState {
  /** Game ms since the wave started. */
  waveElapsedMs: number;
  /** Per group (same index as plan.groups): how many already spawned. */
  spawnedPerGroup: number[];
  /** Total enemies this wave will spawn. */
  totalToSpawn: number;
  totalSpawned: number;
}

/**
 * Static context every core system receives. Built once per match by core's createGameContext;
 * tests and the QA sim build it the same way (with createFallbackAgentService).
 */
export interface GameContext {
  data: GameData;
  map: MapDef;
  mapQueries: MapQueries;
  events: EventBus;
  agents: AgentService;
}

/** Fixed simulation step in ms of game time (SPEC.md section 1, rule 4). */
export const FIXED_STEP_MS = 1000 / 60;

/** Options for core's createGame. */
export interface CreateGameOptions {
  mapId: MapId;
  difficulty: Difficulty;
  /**
   * Where runs and progress are persisted. null = no persistence (headless sim, most unit tests).
   * With a store, createGame reads ProgressSave for attemptNumber and the narrator's star count,
   * writes RunSave at payout, and on Won/Lost deletes the run and updates ProgressSave.
   */
  saves: SaveStore | null;
  /**
   * RunSave to resume (from saves.loadRun). null = fresh run. On resume the stored narration and
   * pendingPlan are used and no agent call is made for them.
   */
  resume: RunSave | null;
}

/** What createGame resolves to. The Integrator's GameScene and QA's sim drive it the same way. */
export interface GameInstance {
  readonly state: GameState;
  readonly ctx: GameContext;
  readonly commands: GameCommands;
  /**
   * Advance by real elapsed ms (Phaser's update delta). Paused, Won, Lost: does nothing.
   * Build: counts buildTimerMs down in real ms and auto-starts the wave at 0.
   * Combat: adds dtRealMs * speed to an accumulator and runs whole FIXED_STEP_MS steps
   * (at most 10 * speed per call). Each fixed step runs, in order:
   *   stepSpawner -> stepEnemies -> stepCombat -> cleanup -> wave-clear check,
   * and checks coreHp <= 0 after EVERY system call (Lost transition, SPEC.md section 5).
   */
  step(dtRealMs: number): void;
  /** Removes core's event listeners. */
  destroy(): void;
}

/* ------------------------------------------------------------------ */
/* Player commands (UI/Input -> core). Core validates; UI never mutates state. */
/* ------------------------------------------------------------------ */

export type CommandFailure =
  | 'wrong_phase'
  | 'not_enough_gold'
  | 'tile_not_buildable'
  | 'tile_occupied'
  | 'unknown_tower'
  | 'max_level'
  | 'no_hints_left'
  | 'game_over';

export type CommandResult = { ok: true } | { ok: false; reason: CommandFailure };

export interface GameCommands {
  placeTower(type: TowerType, tile: TileCoord): CommandResult;
  upgradeTower(towerId: string): CommandResult;
  sellTower(towerId: string): CommandResult;
  /** Free, allowed in Build and Combat. */
  setTargeting(towerId: string, mode: TargetingMode): CommandResult;
  /** Build phase only. Pays the early-start bonus if the timer is running. */
  startWave(): CommandResult;
  setSpeed(speed: GameSpeed): CommandResult;
  togglePause(): CommandResult;
  /**
   * Build phase only; resolves after the AgentService returns (fallback is instant).
   * A hint is used up only when a hint (AI or fallback) is shown; the failed AI attempt itself
   * costs nothing. hintsLeft-- happens together with hint:shown, never on the failed attempt.
   */
  requestHint(): Promise<CommandResult>;
}

/* ------------------------------------------------------------------ */
/* Events (core -> UI/audio/save, and system -> system)                */
/* ------------------------------------------------------------------ */

export const GameEvents = {
  PhaseChanged: 'phase:changed',
  WavePlanned: 'wave:planned',
  WaveStarted: 'wave:started',
  WaveCleared: 'wave:cleared',
  EnemySpawned: 'enemy:spawned',
  EnemyDamaged: 'enemy:damaged',
  EnemyKilled: 'enemy:killed',
  EnemyLeaked: 'enemy:leaked',
  TowerPlaced: 'tower:placed',
  TowerUpgraded: 'tower:upgraded',
  TowerSold: 'tower:sold',
  TowerRetargeted: 'tower:retargeted',
  TowerFired: 'tower:fired',
  ProjectileHit: 'projectile:hit',
  GoldChanged: 'gold:changed',
  CoreDamaged: 'core:damaged',
  Payout: 'economy:payout',
  BuildTimerTick: 'build:timer',
  HintShown: 'hint:shown',
  NarrationReady: 'narration:ready',
  SpeedChanged: 'speed:changed',
  PauseChanged: 'pause:changed',
  GameSaved: 'save:written',
  GameOver: 'game:over',
} as const;
export type GameEventName = (typeof GameEvents)[keyof typeof GameEvents];

export type GoldChangeReason = 'place' | 'upgrade' | 'sell' | 'kill' | 'waveClear' | 'earlyStart' | 'load';

/** Payload for every event name. */
export interface GameEventPayloads {
  'phase:changed': { from: GamePhase; to: GamePhase; wave: number };
  'wave:planned': { plan: WavePlan; source: AgentSource };
  'wave:started': { wave: number; plan: WavePlan; earlyStartBonus: number };
  'wave:cleared': { wave: number; record: WaveRecord };
  'enemy:spawned': { enemy: EnemyInstance };
  'enemy:damaged': { enemyId: string; amount: number; hpLeft: number; towerId: string };
  'enemy:killed': { enemy: EnemyInstance; towerId: string; gold: number };
  'enemy:leaked': { enemy: EnemyInstance; coreDamage: number };
  'tower:placed': { tower: TowerInstance; cost: number };
  'tower:upgraded': { tower: TowerInstance; cost: number };
  'tower:sold': { towerId: string; type: TowerType; tile: TileCoord; refund: number };
  'tower:retargeted': { towerId: string; mode: TargetingMode };
  'tower:fired': { towerId: string; projectileId: string; targetId: string };
  'projectile:hit': { projectileId: string; towerType: TowerType; pos: Vec2; enemyIds: string[] };
  'gold:changed': { gold: number; delta: number; reason: GoldChangeReason };
  'core:damaged': { coreHp: number; amount: number; enemy: EnemyType };
  'economy:payout': { wave: number; waveClearBonus: number; killGoldThisWave: number; gold: number };
  'build:timer': { remainingMs: number };
  'hint:shown': { hint: HintResult; source: AgentSource; hintsLeft: number };
  'narration:ready': { narration: NarrationResult; source: AgentSource };
  'speed:changed': { speed: GameSpeed };
  'pause:changed': { paused: boolean };
  'save:written': { wave: number; key: string };
  'game:over': { result: 'win' | 'loss'; stars: StarCount; wave: number; coreHp: number };
}

export type GameEventHandler<K extends GameEventName> = (payload: GameEventPayloads[K]) => void;

/** Plain-TS synchronous event bus (implemented in src/core/EventBus.ts). */
export interface EventBus {
  on<K extends GameEventName>(name: K, handler: GameEventHandler<K>): () => void;
  off<K extends GameEventName>(name: K, handler: GameEventHandler<K>): void;
  emit<K extends GameEventName>(name: K, payload: GameEventPayloads[K]): void;
}

/* ------------------------------------------------------------------ */
/* Save files (localStorage)                                           */
/* ------------------------------------------------------------------ */

export const SAVE_KEYS = {
  /** In-progress run for a map: `bastion-line:run:v1:<mapId>` */
  runPrefix: 'bastion-line:run:v1:',
  /** Best stars and finished-attempt counts per map (ProgressSave). No settings are stored. */
  progress: 'bastion-line:progress:v1',
} as const;

export interface SavedTower {
  id: string;
  type: TowerType;
  level: TowerLevel;
  tile: TileCoord;
  targeting: TargetingMode;
  totalSpent: number;
  kills: number;
  damageDealt: number;
  placedOnWave: number;
}

/**
 * Written at payout (after wave N clears, before wave N+1 build) and deleted on Won/Lost.
 * Never written mid-combat, so it contains no enemies or projectiles.
 */
export interface RunSave {
  version: 1;
  /** ISO 8601 */
  savedAt: string;
  mapId: MapId;
  difficulty: Difficulty;
  /** Next wave to play (N + 1). */
  wave: number;
  gold: number;
  coreHp: number;
  coreHpMax: number;
  towers: SavedTower[];
  hintsLeft: number;
  speed: GameSpeed;
  nextId: number;
  attemptNumber: number;
  waveHistory: WaveRecord[];
  hintsUsed: HintUseRecord[];
  /** Plans already played, by wave. */
  playedPlans: Record<number, WavePlan>;
  /** Plan for `wave`, if already resolved (AI output is stored so a resume makes no new call). */
  pendingPlan: WavePlan | null;
  /** Same shape as GameState.planSources. */
  planSources: Record<number, AgentSource>;
  narration: NarrationResult | null;
}

/** Stored at SAVE_KEYS.progress. Nothing else (no settings) lives here. */
export interface ProgressSave {
  version: 1;
  bestStars: Partial<Record<MapId, StarCount>>;
  /** Finished runs (Won or Lost) per map. attemptNumber of a new run = attempts + 1. */
  attempts: Partial<Record<MapId, number>>;
}

/** The subset of the Web Storage API the save store uses (window.localStorage or a test stub). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Implemented in src/save. Unknown version or unparsable JSON: the entry is deleted and treated as missing. */
export interface SaveStore {
  loadRun(mapId: MapId): RunSave | null;
  writeRun(save: RunSave): void;
  deleteRun(mapId: MapId): void;
  /** Returns an empty ProgressSave ({version:1, bestStars:{}, attempts:{}}) when none is stored. */
  loadProgress(): ProgressSave;
  writeProgress(progress: ProgressSave): void;
}

/* ------------------------------------------------------------------ */
/* AI agents (prompts/*.md). Prototype ships scripted fallbacks only.  */
/* ------------------------------------------------------------------ */

export type AgentSource = 'ai' | 'fallback';

export interface AgentResponse<T> {
  data: T;
  source: AgentSource;
  /** Validation error or network error that caused a fallback, for logs. */
  fallbackReason?: string;
}

/* --- 01 Wave Director ------------------------------------------------ */

export interface AgentTowerSummary {
  id: string;
  type: TowerType;
  level: TowerLevel;
  pathSegment: PathSegmentId;
  targeting: TargetingMode;
}

/** The <game_state> object in prompts/01-wave-director.md (keys verbatim). */
export interface WaveDirectorInput {
  map: MapId;
  difficulty: Difficulty;
  wave: number;
  threat_budget: number;
  unlocked_enemies: EnemyType[];
  gold: number;
  core_hp: number;
  core_hp_max: number;
  towers: AgentTowerSummary[];
  /** null before wave 1. */
  last_wave: {
    groups: { enemy: EnemyType; count: number }[];
    leaks: { enemy: EnemyType; count: number }[];
    core_damage: number;
  } | null;
  /** Enemy types used in each previous wave, oldest first (last 3 at most). */
  previous_mixes: EnemyType[][];
}

/** Output = WavePlan (defined above). */

/* --- 02 Tactical Advisor --------------------------------------------- */

export type HintAction = 'place' | 'upgrade' | 'retarget' | 'sell' | 'none';

/** The <game_state> object in prompts/02-tactical-advisor.md (keys verbatim). */
export interface HintInput {
  wave: number;
  gold: number;
  core_hp: number;
  hints_left_after_this: number;
  towers: {
    id: string;
    type: TowerType;
    level: TowerLevel;
    tile: TileCoord;
    targeting: TargetingMode;
    totalSpent: number;
  }[];
  /** Pre-filtered by the client to the ~15 most relevant tiles near the path. */
  buildable_tiles: (TileCoord & { nearPath: PathSegmentId })[];
  path_segments: PathSegmentId[];
  next_wave: { groups: { enemy: EnemyType; count: number }[] };
  last_wave_leaks: { enemy: EnemyType; count: number; leakedAt: PathSegmentId }[];
}

export interface HintResult {
  action: HintAction;
  /** Required for "place". */
  towerType: TowerType | null;
  /** Required for "upgrade", "retarget", "sell". */
  towerId: string | null;
  /** Required for "place". */
  tile: TileCoord | null;
  /** Required for "retarget". */
  targeting: TargetingMode | null;
  /** One sentence, <= 20 words. */
  message: string;
}

/* --- 03 Battle Narrator ---------------------------------------------- */

/** The <map> object in prompts/03-battle-narrator.md (keys verbatim). */
export interface NarrationInput {
  id: MapId;
  name: string;
  difficulty: Difficulty;
  setting: string;
  boss_names: { '10': string; '20': string };
  player_stars_on_this_map: StarCount;
  attempt_number: number;
}

export type TauntKey = TowerType | 'mixed';
export type BossTauntSet = Record<TauntKey, string>;

export interface NarrationResult {
  /** <= 100 chars */
  intro: string;
  /** Exactly 20 entries, waves 1..20 in order, each <= 70 chars. */
  captions: { wave: number; text: string }[];
  bossTaunts: { '10': BossTauntSet; '20': BossTauntSet };
}

/* --- 04 Match Analyst ------------------------------------------------ */

/** The <match_log> object in prompts/04-match-analyst.md (keys verbatim). */
export interface DebriefInput {
  map: MapId;
  difficulty: Difficulty;
  result: 'win' | 'loss';
  stars: StarCount;
  waves_cleared: number;
  final_core_hp: number;
  final_towers: (AgentTowerSummary & { kills: number; placedOnWave: number })[];
  /** Omit empty fields when sending to the model to save tokens. */
  waves: {
    wave: number;
    enemies: EnemyCounts;
    leaks: EnemyCounts;
    coreDamage: number;
    goldStart: number;
    goldEnd: number;
    earlyStart: boolean;
  }[];
  hints_used: HintUseRecord[];
}

export interface DebriefResult {
  /** <= 60 chars */
  headline: string;
  /** 1-2 items, each <= 100 chars */
  held: string[];
  /** 0-3 items, most damaging first */
  damage: { wave: number; enemy: EnemyType; coreDamage: number; cause: string }[];
  /** <= 140 chars, one strategy */
  tryNext: string;
}

/* --- Service --------------------------------------------------------- */

/**
 * The only door between the game and the AI layer. The prototype ships
 * `FallbackAgentService` (src/agents). Milestone 2 adds an AI implementation behind
 * the same interface; nothing outside src/agents may change when it does.
 *
 * Contract: methods NEVER reject. On timeout (5 s), invalid JSON or schema failure the
 * implementation retries once, then returns the scripted fallback with source 'fallback'.
 */
export interface AgentService {
  planWave(input: WaveDirectorInput): Promise<AgentResponse<WavePlan>>;
  getHint(input: HintInput): Promise<AgentResponse<HintResult>>;
  getNarration(input: NarrationInput): Promise<AgentResponse<NarrationResult>>;
  getDebrief(input: DebriefInput): Promise<AgentResponse<DebriefResult>>;
}


/* ------------------------------------------------------------------ */
/* Scene keys (Scaffolder registers them; UI and Integrator use them)  */
/* ------------------------------------------------------------------ */

export const SCENE_KEYS = {
  Boot: 'Boot',
  Menu: 'Menu',
  MapSelect: 'MapSelect',
  Game: 'Game',
  Debrief: 'Debrief',
} as const;
export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];

/** scene.start(SCENE_KEYS.Game, data): sent by MapSelect. */
export interface GameSceneData {
  mapId: MapId;
  /** true = "Continue" was pressed and a run save exists. */
  resume: boolean;
}

/** scene.start(SCENE_KEYS.Debrief, data): sent by GameScene after game:over. */
export interface DebriefSceneData {
  mapId: MapId;
  result: 'win' | 'loss';
  stars: StarCount;
  /** Built with buildDebriefInput by GameScene before the scene switch. */
  input: DebriefInput;
  /** The Debrief scene calls agents.getDebrief(input) exactly once. */
  agents: AgentService;
}

/* ------------------------------------------------------------------ */
/* Cross-folder function contracts                                     */
/* Each entry module exports these under the names in SPEC.md section 2 */
/* (export const <name>: <Alias> = ...).                               */
/* ------------------------------------------------------------------ */

/* --- src/map/index.ts (agent 3) --- */

/** Parses public/maps/<id>.json (Tiled format, authored by agent 3). Throws on invalid input. */
export type ParseTiledMap = (json: unknown) => MapDef;
export type CreateMapQueries = (map: MapDef) => MapQueries;

/* --- src/enemies/index.ts (agent 3) --- */

/** Math.round(def.hp * economy.enemyHpMultiplierPerWave ** (wave - 1)). */
export type EnemyHpForWave = (data: GameData, type: EnemyType, wave: number) => number;
/**
 * Creates an enemy for state.wave at path distance 0 with HP from enemyHpForWave: allocates its id
 * ('e' prefix, see GameState.nextId), pushes it onto state.enemies, emits enemy:spawned, returns it.
 */
export type SpawnEnemy = (state: GameState, ctx: GameContext, type: EnemyType) => EnemyInstance;

/**
 * One fixed simulation step of one system (dtMs = FIXED_STEP_MS of game time).
 * - stepEnemies (agent 3): movement, slow decay, leaks. On a leak it sets alive = false,
 *   coreHp = max(0, coreHp - coreDamage), emits enemy:leaked then core:damaged, and does NOTHING
 *   else: no phase change, no stars, no save (core runs the Lost transition).
 * - stepCombat (agent 4): cooldowns, targeting, firing (allocates 'p' ids), projectile movement,
 *   hits, splash, slow, damage, kills (alive = false, tower.kills++, damageDealt, enemy:killed,
 *   then addGold(state, ctx, goldReward, 'kill')), and sets projectile.spent. It never removes
 *   entries from state.enemies or state.projectiles (core's cleanup does).
 * - stepSpawner (agent 5): spawns due enemies of the running wave via spawnEnemy and advances state.spawn.
 */
export type StepSystem = (state: GameState, ctx: GameContext, dtMs: number) => void;

/* --- src/towers/index.ts (agent 4) --- */

/** Effective stats at a level from TowerDef and levelMultipliers (float, never rounded). */
export type GetTowerStats = (data: GameData, type: TowerType, level: TowerLevel) => TowerStats;
/** Gold to go from `level` to level + 1 (= TowerDef.upgradeCosts[level - 1]); null at maxLevel. */
export type UpgradeCost = (data: GameData, type: TowerType, level: TowerLevel) => number | null;
/** Math.floor(totalSpent * towers.sellRefundPct). */
export type SellRefund = (data: GameData, totalSpent: number) => number;
/**
 * Read-only placement check, failures reported in this order: phase is not Build ('wrong_phase'
 * or 'game_over') -> 'tile_not_buildable' -> 'tile_occupied' -> 'not_enough_gold'. Never mutates.
 */
export type CanPlace = (state: GameState, ctx: GameContext, type: TowerType, tile: TileCoord) => CommandResult;

/* --- src/combat/index.ts (agent 4) --- */

/** The tower's target among state.enemies by its targeting mode (SPEC.md section 4); null if none in range. */
export type SelectTarget = (state: GameState, ctx: GameContext, tower: TowerInstance) => EnemyInstance | null;
/* stepCombat: StepSystem */

/* --- src/waves/index.ts (agent 5) --- */

/** Math.floor(wave1Budget * budgetGrowth ** (wave - 1) + 0.5). */
export type ThreatBudget = (data: GameData, wave: number) => number;
/** Math.ceil(minSpendPct * threatBudget(data, wave)). */
export type MinThreat = (data: GameData, wave: number) => number;
/** Enemy types unlocked on `wave` by the unlock rule on EnemyDef.unlockWave, in ENEMY_TYPES order. */
export type UnlockedEnemies = (data: GameData, wave: number) => EnemyType[];
/** Every hard rule of prompts/01-wave-director.md. [] = valid; otherwise one message per problem. */
export type ValidateWavePlan = (data: GameData, plan: WavePlan, wave: number) => string[];
/* stepSpawner: StepSystem */
/** All groups fully spawned and no live enemies or unspent projectiles remain. */
export type IsWaveClear = (state: GameState) => boolean;

/* --- src/economy/index.ts (agent 5) --- */

/** waveClearBonus.base + waveClearBonus.perWave * wave. */
export type WaveClearBonus = (data: GameData, wave: number) => number;
/** Math.floor(maxBonus * remainingMs / buildTimerMs); 0 when remainingMs is null (untimed) or <= 0. */
export type EarlyStartBonus = (data: GameData, remainingMs: number | null) => number;
/** 0 if !won; 3 if coreHp === startCoreHp; 2 if coreHp >= twoStarMinHpPct * startCoreHp; else 1. */
export type ComputeStars = (data: GameData, won: boolean, coreHp: number) => StarCount;
/** state.gold += delta (delta may be negative), then emits gold:changed. The ONLY way any system changes gold. */
export type AddGold = (state: GameState, ctx: GameContext, delta: number, reason: GoldChangeReason) => void;

/* --- src/agents/index.ts (agent 5) --- */

export type CreateFallbackAgentService = (data: GameData) => AgentService;
export type BuildWaveDirectorInput = (state: GameState, ctx: GameContext, wave: number) => WaveDirectorInput;
export type BuildHintInput = (state: GameState, ctx: GameContext) => HintInput;
export type BuildNarrationInput = (state: GameState, ctx: GameContext, bestStars: StarCount) => NarrationInput;
export type BuildDebriefInput = (state: GameState, ctx: GameContext) => DebriefInput;
/** Dominant tower type by total gold spent across current towers; 'mixed' if none exceeds 40% (or no towers). */
export type SelectBossTaunt = (state: GameState, ctx: GameContext) => TauntKey;

/* --- src/save/index.ts (agent 5) --- */

/** storage null = in-memory store (tests, sim). */
export type CreateSaveStore = (storage: StorageLike | null) => SaveStore;
/** Snapshot taken at payout (RunSave.wave = next wave to play, pendingPlan = its plan). */
export type SerializeRun = (state: GameState) => RunSave;
/** Rebuilds a Build-phase GameState for save.wave (tower cooldownMs = 0, no enemies or projectiles). */
export type RestoreRun = (ctx: GameContext, save: RunSave) => GameState;

/* --- src/core/index.ts (agent 5) --- */

export type CreateEventBus = () => EventBus;
/** Builds GameData from the four parsed data/*.json files, checking version fields; the single place the JSON is cast. */
export type LoadGameData = (raw: { towers: unknown; enemies: unknown; economy: unknown; waves: unknown }) => GameData;
/** Calls createMapQueries(map) and createEventBus(). */
export type CreateGameContext = (data: GameData, map: MapDef, agents: AgentService) => GameContext;
/**
 * Builds (or restores) the state, fetches narration and the wave-1 plan on a fresh run, enters
 * Build and resolves. Never rejects (AgentService methods never reject).
 */
export type CreateGame = (ctx: GameContext, opts: CreateGameOptions) => Promise<GameInstance>;
