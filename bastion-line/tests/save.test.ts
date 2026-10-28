/** SPEC.md section 7: save/restore round-trip, version handling, write only at payout. */
import { describe, expect, it } from 'vitest';
import { GameEvents, GamePhase, SAVE_KEYS } from '../src/types';
import type { RunSave, StorageLike } from '../src/types';
import { createSaveStore, restoreRun, serializeRun } from '../src/save';
import { BEND1, loadData, makeCtx, newGame, playCombat } from './helpers';

function stubStorage(): StorageLike & { items: Map<string, string>; removed: string[] } {
  const items = new Map<string, string>();
  const removed: string[] = [];
  return {
    items,
    removed,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => {
      removed.push(k);
      items.delete(k);
    },
  };
}

const withoutTime = (s: RunSave): Omit<RunSave, 'savedAt'> => {
  const { savedAt: _ignored, ...rest } = s;
  return rest;
};

describe('save / restore round-trip', () => {
  it('payout writes the run; resuming rebuilds the same Build state and re-serializes identically', async () => {
    const storage = stubStorage();
    const saves = createSaveStore(storage);
    const { game } = await newGame({ saves });
    const { state, commands } = game;
    commands.placeTower('Arrow', BEND1[0]);
    commands.placeTower('Arrow', BEND1[1]);
    commands.setTargeting(state.towers[1].id, 'Strongest');
    await commands.requestHint();
    expect(saves.loadRun('easy')).toBeNull(); // nothing written during Build
    let written: { wave: number; key: string } | null = null;
    game.ctx.events.on(GameEvents.GameSaved, (p) => (written = p));
    commands.startWave();
    expect(saves.loadRun('easy')).toBeNull(); // nor at wave start
    playCombat(game);
    expect(state.phase).toBe(GamePhase.Build);
    expect(written).toEqual({ wave: 2, key: `${SAVE_KEYS.runPrefix}easy` });

    const run = saves.loadRun('easy')!;
    expect(run.version).toBe(1);
    expect(run.wave).toBe(2);
    expect(run.gold).toBe(state.gold);
    expect(run.nextId).toBe(state.nextId);
    expect(run.hintsLeft).toBe(2);
    expect(run.pendingPlan?.wave).toBe(2);
    expect(run.waveHistory).toHaveLength(1);
    expect(run.planSources[1]).toBe('fallback');

    const { ctx } = makeCtx();
    const restored = restoreRun(ctx, run);
    expect(restored.phase).toBe(GamePhase.Build);
    expect(restored.wave).toBe(2);
    expect(restored.enemies).toEqual([]);
    expect(restored.projectiles).toEqual([]);
    expect(restored.towers.every((t) => t.cooldownMs === 0)).toBe(true);
    expect(restored.towers.map((t) => [t.id, t.type, t.level, t.targeting, t.totalSpent, t.kills])).toEqual(
      state.towers.map((t) => [t.id, t.type, t.level, t.targeting, t.totalSpent, t.kills]),
    );
    expect(restored.nextId).toBe(state.nextId);
    expect(restored.planSources).toEqual(state.planSources);
    expect(restored.currentPlan).toEqual(state.currentPlan);
    expect(restored.narration).toEqual(state.narration);
    expect(restored.buildTimerMs).toBe(20000);
    expect(withoutTime(serializeRun(restored))).toEqual(withoutTime(run));
    expect(withoutTime(serializeRun(state))).toEqual(withoutTime(run));
    game.destroy();
  });

  it('resume makes no agent calls (stored narration and pendingPlan are used)', async () => {
    const saves = createSaveStore(null);
    const first = await newGame({ saves });
    first.game.commands.placeTower('Arrow', BEND1[0]);
    first.game.commands.startWave();
    playCombat(first.game);
    const run = saves.loadRun('easy')!;
    first.game.destroy();

    const calls: string[] = [];
    const { game } = await newGame({
      saves,
      resume: run,
      agents: (data) => ({
        planWave: async () => {
          calls.push('planWave');
          throw new Error('no');
        },
        getHint: async () => {
          calls.push('getHint');
          throw new Error('no');
        },
        getNarration: async () => {
          calls.push('getNarration');
          throw new Error('no');
        },
        getDebrief: async () => {
          calls.push('getDebrief');
          throw new Error(String(data.economy.version));
        },
      }),
    });
    expect(calls).toEqual([]);
    expect(game.state.narration).toEqual(run.narration);
    expect(game.state.currentPlan).toEqual(run.pendingPlan);
    expect(game.state.attemptNumber).toBe(run.attemptNumber);
    game.destroy();
  });

  it('a mid-run save keeps the attempt number; a new run after a finished one counts attempts + 1', async () => {
    const saves = createSaveStore(null);
    saves.writeProgress({ version: 1, bestStars: { easy: 1 }, attempts: { easy: 4 } });
    const { game } = await newGame({ saves });
    expect(game.state.attemptNumber).toBe(5);
    game.destroy();
  });
});

describe('save store', () => {
  it('ignores and deletes a run with an unknown version or bad JSON', () => {
    const storage = stubStorage();
    const saves = createSaveStore(storage);
    const key = `${SAVE_KEYS.runPrefix}easy`;
    storage.items.set(key, JSON.stringify({ version: 2, mapId: 'easy', wave: 3 }));
    expect(saves.loadRun('easy')).toBeNull();
    expect(storage.items.has(key)).toBe(false);
    storage.items.set(key, '{not json');
    expect(saves.loadRun('easy')).toBeNull();
    expect(storage.items.has(key)).toBe(false);
    storage.items.set(SAVE_KEYS.progress, JSON.stringify({ version: 9 }));
    expect(saves.loadProgress()).toEqual({ version: 1, bestStars: {}, attempts: {} });
    expect(storage.items.has(SAVE_KEYS.progress)).toBe(false);
  });

  it('uses one slot per map at the SPEC key and an in-memory store for null', () => {
    const data = loadData();
    const storage = stubStorage();
    const saves = createSaveStore(storage);
    const { ctx } = makeCtx();
    const state = restoreRun(ctx, {
      version: 1, savedAt: '', mapId: 'easy', difficulty: 'Easy', wave: 3, gold: 10, coreHp: 20, coreHpMax: 20, towers: [],
      hintsLeft: 3, speed: 1, nextId: 7, attemptNumber: 1, waveHistory: [], hintsUsed: [], playedPlans: {}, pendingPlan: null, planSources: {}, narration: null,
    });
    expect(state.currentPlan).toEqual(data.waves.waves[2]);
    expect(state.planSources[3]).toBe('fallback');
    saves.writeRun(serializeRun(state));
    expect([...storage.items.keys()]).toEqual(['bastion-line:run:v1:easy']);
    saves.deleteRun('easy');
    expect(storage.items.size).toBe(0);

    const mem = createSaveStore(null);
    mem.writeRun(serializeRun(state));
    expect(mem.loadRun('easy')?.wave).toBe(3);
  });
});
