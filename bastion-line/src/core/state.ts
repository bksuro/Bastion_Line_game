/**
 * Initial-state factory for a fresh run (Build phase of wave 1, no plan yet).
 */
import { GamePhase } from '../types';
import type { Difficulty, GameData, GameState, MapId } from '../types';
import { buildTimerFor } from '../economy';

export function createInitialState(data: GameData, mapId: MapId, difficulty: Difficulty, attemptNumber: number): GameState {
  const e = data.economy;
  return {
    mapId,
    difficulty,
    phase: GamePhase.Build,
    wave: 1,
    gold: e.startGold,
    coreHp: e.startCoreHp,
    coreHpMax: e.startCoreHp,
    towers: [],
    enemies: [],
    projectiles: [],
    currentPlan: null,
    nextPlan: null,
    spawn: null,
    buildTimerMs: buildTimerFor(data, 1),
    hintsLeft: e.hintsPerMap,
    speed: 1,
    paused: false,
    elapsedMs: 0,
    narration: null,
    activeHint: null,
    activeBossTaunt: null,
    waveHistory: [],
    hintsUsed: [],
    playedPlans: {},
    planSources: {},
    currentWaveStats: null,
    buildGoldStart: e.startGold,
    nextId: 1,
    attemptNumber,
    stars: null,
  };
}
