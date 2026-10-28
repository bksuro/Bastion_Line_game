/**
 * src/save entry module (SPEC.md sections 2.1 and 7). Owner: agent 5 (Waves, Economy & Agents).
 * Other folders import only from this file.
 *
 * - One run slot per map at SAVE_KEYS.runPrefix + mapId, plus SAVE_KEYS.progress.
 * - Unknown version or unparsable JSON: the entry is deleted and treated as missing.
 * - Storage errors (quota, private mode) never throw out of the store.
 */
import { GamePhase, SAVE_KEYS } from '../types';
import type {
  CreateSaveStore,
  SerializeRun,
  RestoreRun,
  MapId,
  ProgressSave,
  RunSave,
  SavedTower,
  StorageLike,
  TowerInstance,
  GameState,
} from '../types';
import { buildTimerFor } from '../economy';

export const runKey = (mapId: MapId): string => `${SAVE_KEYS.runPrefix}${mapId}`;

const emptyProgress = (): ProgressSave => ({ version: 1, bestStars: {}, attempts: {} });

/** Deep copy through JSON: saves are plain data, and copies keep state and storage independent. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function createMemoryStorage(): StorageLike {
  const items = new Map<string, string>();
  return {
    getItem: (key) => (items.has(key) ? (items.get(key) as string) : null),
    setItem: (key, value) => {
      items.set(key, String(value));
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const createSaveStore: CreateSaveStore = (storage) => {
  const store = storage ?? createMemoryStorage();

  const safeGet = (key: string): string | null => {
    try {
      return store.getItem(key);
    } catch {
      return null;
    }
  };
  const safeSet = (key: string, value: string): void => {
    try {
      store.setItem(key, value);
    } catch (err) {
      console.warn(`[save] could not write ${key}`, err);
    }
  };
  const safeRemove = (key: string): void => {
    try {
      store.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  const readJson = (key: string): unknown => {
    const raw = safeGet(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      safeRemove(key);
      return null;
    }
  };

  return {
    loadRun(mapId) {
      const key = runKey(mapId);
      const parsed = readJson(key);
      if (parsed === null) return null;
      if (!isObject(parsed) || parsed.version !== 1 || parsed.mapId !== mapId || typeof parsed.wave !== 'number') {
        safeRemove(key);
        return null;
      }
      return parsed as unknown as RunSave;
    },
    writeRun(save) {
      safeSet(runKey(save.mapId), JSON.stringify(save));
    },
    deleteRun(mapId) {
      safeRemove(runKey(mapId));
    },
    loadProgress() {
      const parsed = readJson(SAVE_KEYS.progress);
      if (parsed === null) return emptyProgress();
      if (!isObject(parsed) || parsed.version !== 1) {
        safeRemove(SAVE_KEYS.progress);
        return emptyProgress();
      }
      return {
        version: 1,
        bestStars: isObject(parsed.bestStars) ? (parsed.bestStars as ProgressSave['bestStars']) : {},
        attempts: isObject(parsed.attempts) ? (parsed.attempts as ProgressSave['attempts']) : {},
      };
    },
    writeProgress(progress) {
      safeSet(SAVE_KEYS.progress, JSON.stringify(progress));
    },
  };
};

const toSavedTower = (t: TowerInstance): SavedTower => ({
  id: t.id,
  type: t.type,
  level: t.level,
  tile: { x: t.tile.x, y: t.tile.y },
  targeting: t.targeting,
  totalSpent: t.totalSpent,
  kills: t.kills,
  damageDealt: t.damageDealt,
  placedOnWave: t.placedOnWave,
});

/** Snapshot taken at payout, after core has entered Build for the next wave (state.wave = N + 1). */
export const serializeRun: SerializeRun = (state) => ({
  version: 1,
  savedAt: new Date().toISOString(),
  mapId: state.mapId,
  difficulty: state.difficulty,
  wave: state.wave,
  gold: state.gold,
  coreHp: state.coreHp,
  coreHpMax: state.coreHpMax,
  towers: state.towers.map(toSavedTower),
  hintsLeft: state.hintsLeft,
  speed: state.speed,
  nextId: state.nextId,
  attemptNumber: state.attemptNumber,
  waveHistory: clone(state.waveHistory),
  hintsUsed: clone(state.hintsUsed),
  playedPlans: clone(state.playedPlans),
  pendingPlan: state.currentPlan ? clone(state.currentPlan) : null,
  planSources: clone(state.planSources),
  narration: state.narration ? clone(state.narration) : null,
});

/**
 * Rebuilds a Build-phase GameState for save.wave: towers with cooldownMs = 0, no enemies or
 * projectiles, nextId and planSources restored. A missing pendingPlan falls back to the scripted
 * wave (no agent call), with planSources marked 'fallback'.
 */
export const restoreRun: RestoreRun = (ctx, raw) => {
  const save = clone(raw);
  const data = ctx.data;
  const wave = save.wave;
  const planSources = save.planSources ?? {};
  let currentPlan = save.pendingPlan ?? null;
  if (!currentPlan) {
    const scripted = data.waves.waves.find((w) => w.wave === wave) ?? data.waves.waves[wave - 1];
    currentPlan = scripted ? clone(scripted) : null;
    planSources[wave] = 'fallback';
  }
  const state: GameState = {
    mapId: save.mapId,
    difficulty: save.difficulty,
    phase: GamePhase.Build,
    wave,
    gold: save.gold,
    coreHp: save.coreHp,
    coreHpMax: save.coreHpMax,
    towers: (save.towers ?? []).map((t) => ({ ...t, tile: { x: t.tile.x, y: t.tile.y }, cooldownMs: 0 })),
    enemies: [],
    projectiles: [],
    currentPlan,
    nextPlan: null,
    spawn: null,
    buildTimerMs: buildTimerFor(data, wave),
    hintsLeft: save.hintsLeft,
    speed: save.speed ?? 1,
    paused: false,
    elapsedMs: 0,
    narration: save.narration ?? null,
    activeHint: null,
    activeBossTaunt: null,
    waveHistory: save.waveHistory ?? [],
    hintsUsed: save.hintsUsed ?? [],
    playedPlans: save.playedPlans ?? {},
    planSources,
    currentWaveStats: null,
    buildGoldStart: save.gold,
    nextId: save.nextId,
    attemptNumber: save.attemptNumber,
    stars: null,
  };
  return state;
};
