/**
 * Shared QA test helpers (agent 8). Builds the real data, map, context and game headless, the same way
 * GameScene does (SPEC.md 2.1 minus the UI line). Not a test file itself (vitest runs tests/**\/*.test.ts).
 */
import towers from '../data/towers.json';
import enemies from '../data/enemies.json';
import economy from '../data/economy.json';
import waves from '../data/waves.easy.json';
import easyMap from '../public/maps/easy.json';
import { FIXED_STEP_MS, GamePhase } from '../src/types';
import type {
  AgentService,
  EnemyInstance,
  EnemyType,
  GameContext,
  GameData,
  GameInstance,
  GameState,
  MapDef,
  RunSave,
  SaveStore,
  SavedTower,
  TargetingMode,
  TileCoord,
  TowerInstance,
  TowerLevel,
  TowerType,
} from '../src/types';
import { createGame, createGameContext, createInitialState, loadGameData } from '../src/core';
import { parseTiledMap } from '../src/map';
import { createFallbackAgentService } from '../src/agents';

export const loadData = (): GameData => loadGameData({ towers, enemies, economy, waves });
export const loadMap = (): MapDef => parseTiledMap(easyMap);

export function makeCtx(agents?: (data: GameData) => AgentService): { data: GameData; map: MapDef; ctx: GameContext } {
  const data = loadData();
  const map = loadMap();
  const ctx = createGameContext(data, map, agents ? agents(data) : createFallbackAgentService(data));
  return { data, map, ctx };
}

export interface NewGameOptions {
  agents?: (data: GameData) => AgentService;
  saves?: SaveStore | null;
  resume?: RunSave | null;
}

export async function newGame(opts: NewGameOptions = {}): Promise<{ data: GameData; map: MapDef; ctx: GameContext; game: GameInstance }> {
  const { data, map, ctx } = makeCtx(opts.agents);
  const game = await createGame(ctx, { mapId: 'easy', difficulty: 'Easy', saves: opts.saves ?? null, resume: opts.resume ?? null });
  return { data, map, ctx, game };
}

/** Read through a call so TS does not narrow the phase across commands and steps. */
export const phaseOf = (state: GameState): GamePhase => state.phase;

/** Runs fixed steps while the game is in Combat (cap = 15 min of game time). Returns the step count. */
export function playCombat(game: GameInstance, maxSteps = 15 * 60 * 60): number {
  let steps = 0;
  while (phaseOf(game.state) === GamePhase.Combat && steps < maxSteps) {
    game.step(FIXED_STEP_MS);
    steps += 1;
  }
  return steps;
}

/** A bare state + context for calling systems directly (no createGame). */
export function bareState(phase: GamePhase = GamePhase.Combat): { data: GameData; map: MapDef; ctx: GameContext; state: GameState } {
  const { data, map, ctx } = makeCtx();
  const state = createInitialState(data, 'easy', 'Easy', 1);
  state.phase = phase;
  return { data, map, ctx, state };
}

let enemySeq = 1000;
export function makeEnemy(state: GameState, ctx: GameContext, type: EnemyType, over: Partial<EnemyInstance> = {}): EnemyInstance {
  const def = ctx.data.enemies.enemies[type];
  const pathDistance = over.pathDistance ?? 0;
  const { pos, segment } = ctx.mapQueries.positionAt(pathDistance);
  const e: EnemyInstance = {
    id: `e${enemySeq++}`,
    type,
    hp: def.hp,
    maxHp: def.hp,
    speed: def.speed,
    pathDistance,
    pos,
    segment,
    flying: def.flying,
    slowPct: 0,
    slowRemainingMs: 0,
    wave: state.wave,
    alive: true,
    ...over,
  };
  state.enemies.push(e);
  return e;
}

let towerSeq = 500;
export function makeTower(state: GameState, type: TowerType, tile: TileCoord, targeting: TargetingMode = 'First', level: TowerLevel = 1): TowerInstance {
  const t: TowerInstance = {
    id: `t${towerSeq++}`,
    type,
    level,
    tile,
    targeting,
    totalSpent: 0,
    cooldownMs: 0,
    kills: 0,
    damageDealt: 0,
    placedOnWave: state.wave,
  };
  state.towers.push(t);
  return t;
}

/** A hand-built RunSave for resuming straight into the Build phase of `wave`. */
export function makeRunSave(data: GameData, wave: number, over: Partial<RunSave> = {}, towersList: SavedTower[] = []): RunSave {
  return {
    version: 1,
    savedAt: new Date(0).toISOString(),
    mapId: 'easy',
    difficulty: 'Easy',
    wave,
    gold: 1000,
    coreHp: data.economy.startCoreHp,
    coreHpMax: data.economy.startCoreHp,
    towers: towersList,
    hintsLeft: data.economy.hintsPerMap,
    speed: 1,
    nextId: 100,
    attemptNumber: 1,
    waveHistory: [],
    hintsUsed: [],
    playedPlans: {},
    pendingPlan: null,
    planSources: {},
    narration: null,
    ...over,
  };
}

export function savedTower(id: string, type: TowerType, tile: TileCoord, level: TowerLevel = 1, totalSpent = 0): SavedTower {
  return { id, type, level, tile, targeting: 'First', totalSpent, kills: 0, damageDealt: 0, placedOnWave: 1 };
}

/** Inside-bend tiles of the SPEC 2.4 reference layout. */
export const BEND1: TileCoord[] = [{ x: 16, y: 2 }, { x: 17, y: 2 }, { x: 16, y: 3 }, { x: 17, y: 3 }];
export const BEND2: TileCoord[] = [{ x: 16, y: 8 }, { x: 17, y: 8 }, { x: 16, y: 9 }, { x: 17, y: 9 }];
