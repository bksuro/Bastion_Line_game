/** SPEC.md section 8: a leak that takes coreHp to 0 mid-wave ends the game in the same step; stepEnemies alone never changes phase. */
import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, GameEvents, GamePhase } from '../src/types';
import type { GameEventName } from '../src/types';
import { stepEnemies } from '../src/enemies';
import { createSaveStore } from '../src/save';
import { bareState, loadData, makeEnemy, makeRunSave, newGame, phaseOf } from './helpers';

describe('stepEnemies on a fatal leak', () => {
  it('sets alive=false, coreHp=max(0, ...), emits enemy:leaked then core:damaged, and does not change phase', () => {
    const { ctx, map, state } = bareState(GamePhase.Combat);
    state.coreHp = 3;
    const boss = makeEnemy(state, ctx, 'Boss', { id: 'e1', pathDistance: map.pathLength - 0.001 });
    const behind = makeEnemy(state, ctx, 'Grunt', { id: 'e2', pathDistance: map.pathLength - 0.001 });
    const order: GameEventName[] = [];
    ctx.events.on(GameEvents.EnemyLeaked, () => order.push(GameEvents.EnemyLeaked));
    ctx.events.on(GameEvents.CoreDamaged, ({ coreHp, amount }) => {
      order.push(GameEvents.CoreDamaged);
      expect(coreHp).toBe(0);
      expect(amount).toBe(5);
    });
    let phaseEvents = 0;
    ctx.events.on(GameEvents.PhaseChanged, () => (phaseEvents += 1));
    ctx.events.on(GameEvents.GameOver, () => (phaseEvents += 1));
    const gold = state.gold;

    stepEnemies(state, ctx, FIXED_STEP_MS);

    expect(boss.alive).toBe(false);
    expect(state.coreHp).toBe(0);
    expect(order).toEqual([GameEvents.EnemyLeaked, GameEvents.CoreDamaged]);
    expect(state.phase).toBe(GamePhase.Combat);
    expect(state.stars).toBeNull();
    expect(phaseEvents).toBe(0);
    expect(state.gold).toBe(gold); // a leak pays no gold
    expect(state.enemies).toContain(boss); // no splicing
    expect(behind.alive).toBe(true); // stops at the fatal leak
  });

  it('a non-fatal leak takes coreDamage and nothing else', () => {
    const { ctx, map, state } = bareState(GamePhase.Combat);
    const g = makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: map.pathLength - 0.001 });
    stepEnemies(state, ctx, FIXED_STEP_MS);
    expect(g.alive).toBe(false);
    expect(state.coreHp).toBe(19);
    expect(state.phase).toBe(GamePhase.Combat);
  });
});

describe('core Lost transition', () => {
  it('ends the game inside the same fixed step as the fatal leak (Lost, stars 0, save deleted, attempts++)', async () => {
    const data = loadData();
    const saves = createSaveStore(null);
    const resume = makeRunSave(data, 1, { coreHp: 1, gold: 0 });
    saves.writeRun(resume);
    const { game } = await newGame({ saves, resume });
    const { state, ctx } = game;
    let leakStep = -1;
    let overStep = -1;
    let step = 0;
    let phaseAtLeak: string | null = null;
    const overs: { result: string; stars: number; wave: number; coreHp: number }[] = [];
    ctx.events.on(GameEvents.CoreDamaged, () => {
      leakStep = step;
      phaseAtLeak = state.phase;
    });
    ctx.events.on(GameEvents.GameOver, (p) => {
      overStep = step;
      overs.push(p);
    });
    game.commands.startWave();
    while (phaseOf(state) === GamePhase.Combat && step < 60 * 120) {
      step += 1;
      game.step(FIXED_STEP_MS);
    }
    expect(leakStep).toBeGreaterThan(0);
    expect(overStep).toBe(leakStep);
    expect(phaseAtLeak).toBe(GamePhase.Combat);
    expect(state.phase).toBe(GamePhase.Lost);
    expect(state.stars).toBe(0);
    expect(state.coreHp).toBe(0);
    expect(state.wave).toBe(1);
    expect(overs).toEqual([{ result: 'loss', stars: 0, wave: 1, coreHp: 0 }]);
    expect(saves.loadRun('easy')).toBeNull();
    expect(saves.loadProgress().attempts.easy).toBe(1);
    expect(saves.loadProgress().bestStars.easy).toBe(0);
    // Enemies are still on the field mid-wave: the wave was not finished, the game simply stopped.
    expect(state.enemies.some((e) => e.alive)).toBe(true);

    // Nothing moves after game over and commands report game_over.
    const snapshot = JSON.stringify(state.enemies);
    game.step(1000);
    expect(JSON.stringify(state.enemies)).toBe(snapshot);
    expect(overs).toHaveLength(1);
    expect(game.commands.startWave()).toEqual({ ok: false, reason: 'game_over' });
    expect(game.commands.placeTower('Arrow', { x: 16, y: 2 })).toEqual({ ok: false, reason: 'game_over' });
    game.destroy();
  });

  it('with several steps per call (speed 3) the step after the loss does not run', async () => {
    const data = loadData();
    const { game } = await newGame({ resume: makeRunSave(data, 1, { coreHp: 1, gold: 0 }) });
    const { state, ctx } = game;
    game.commands.setSpeed(3);
    game.commands.startWave();
    let elapsedAtLeak = -1;
    ctx.events.on(GameEvents.CoreDamaged, () => (elapsedAtLeak = state.elapsedMs));
    let guard = 0;
    while (phaseOf(state) === GamePhase.Combat && guard++ < 10000) game.step(100);
    expect(state.phase).toBe(GamePhase.Lost);
    expect(state.elapsedMs).toBe(elapsedAtLeak);
    game.destroy();
  });
});

describe('Won transition', () => {
  it('clearing wave 20 pays the clear bonus, sets stars from coreHp and deletes the run save', async () => {
    const data = loadData();
    const saves = createSaveStore(null);
    // A single Grunt plan for wave 20 so the test is quick; the defense kills it.
    const pendingPlan = { wave: 20, groups: [{ enemy: 'Grunt' as const, count: 1, spawnIntervalMs: 1000, startDelayMs: 0 }], totalThreat: 1, previewText: 'one', reason: 'test' };
    const resume = makeRunSave(data, 20, { coreHp: 12, gold: 1000, pendingPlan });
    saves.writeRun(resume);
    const { game } = await newGame({ saves, resume });
    game.state.gold = 10000;
    for (const t of [{ x: 16, y: 2 }, { x: 17, y: 2 }, { x: 16, y: 3 }]) game.commands.placeTower('Sniper', t);
    const gold = game.state.gold;
    game.commands.startWave();
    let guard = 0;
    while (phaseOf(game.state) === GamePhase.Combat && guard++ < 60 * 120) game.step(FIXED_STEP_MS);
    expect(game.state.phase).toBe(GamePhase.Won);
    expect(game.state.stars).toBe(2);
    expect(game.state.gold).toBe(gold + 5 + data.enemies.enemies.Grunt.goldReward + 125);
    expect(saves.loadRun('easy')).toBeNull();
    expect(saves.loadProgress().bestStars.easy).toBe(2);
    expect(saves.loadProgress().attempts.easy).toBe(1);
    game.destroy();
  });
});
