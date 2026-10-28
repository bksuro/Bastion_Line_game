/** SPEC.md 2.3 / 5: wave-start resets (cooldowns 0, activeHint null, boss taunt on 10/20), event order, loop rules. */
import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, GameEvents, GamePhase } from '../src/types';
import type { GameEventName, HintResult } from '../src/types';
import { selectBossTaunt } from '../src/agents';
import { BEND1, BEND2, loadData, makeRunSave, newGame, playCombat, savedTower } from './helpers';

const data = loadData();
const hint: HintResult = { action: 'none', towerType: null, towerId: null, tile: null, targeting: null, message: 'stale' };

describe('wave-start resets', () => {
  it('every tower cooldown is 0 and activeHint is null at wave start', async () => {
    const { game } = await newGame();
    const { state, commands } = game;
    commands.placeTower('Arrow', BEND1[0]);
    commands.placeTower('Cannon', BEND1[1]);
    for (const t of state.towers) t.cooldownMs = 650;
    await commands.requestHint();
    expect(state.activeHint).not.toBeNull();
    commands.startWave();
    expect(state.towers.map((t) => t.cooldownMs)).toEqual([0, 0]);
    expect(state.activeHint).toBeNull();
    expect(state.activeBossTaunt).toBeNull();
    game.destroy();
  });

  it('towers start a later wave ready even if they fired at the end of the previous one', async () => {
    const { game } = await newGame();
    game.commands.placeTower('Arrow', BEND1[0]);
    game.commands.startWave();
    playCombat(game);
    expect(game.state.phase).toBe(GamePhase.Build);
    game.state.towers[0].cooldownMs = 123;
    game.commands.startWave();
    expect(game.state.towers[0].cooldownMs).toBe(0);
    game.destroy();
  });

  it.each([10, 20])('wave %i sets activeBossTaunt from narration.bossTaunts[N][selectBossTaunt]', async (n) => {
    const towers = [savedTower('t1', 'Sniper', BEND1[0], 2, 240), savedTower('t2', 'Arrow', BEND2[0], 1, 50)];
    const { game } = await newGame({ resume: makeRunSave(data, n, {}, towers) });
    const { state } = game;
    expect(state.activeBossTaunt).toBeNull(); // only set at wave start
    const key = selectBossTaunt(state, game.ctx);
    expect(key).toBe('Sniper'); // 240 of 290 gold
    game.commands.startWave();
    const narr = state.narration!;
    expect(state.activeBossTaunt).toBe(narr.bossTaunts[String(n) as '10' | '20'][key]);
    expect(state.activeBossTaunt?.length).toBeGreaterThan(0);
    game.destroy();
  });

  it.each([9, 11, 19])('wave %i clears any old taunt (null)', async (n) => {
    const { game } = await newGame({ resume: makeRunSave(data, n) });
    game.state.activeBossTaunt = 'left over from the boss wave';
    game.state.activeHint = hint;
    game.commands.startWave();
    expect(game.state.activeBossTaunt).toBeNull();
    expect(game.state.activeHint).toBeNull();
    game.destroy();
  });

  it('selectBossTaunt is mixed with no towers or when no type exceeds 40%', async () => {
    const even = [savedTower('t1', 'Arrow', BEND1[0], 1, 100), savedTower('t2', 'Cannon', BEND1[1], 1, 100), savedTower('t3', 'Frost', BEND2[0], 1, 100)];
    const a = await newGame({ resume: makeRunSave(data, 10, {}, even) });
    expect(selectBossTaunt(a.game.state, a.game.ctx)).toBe('mixed');
    a.game.destroy();
    const b = await newGame({ resume: makeRunSave(data, 10) });
    expect(selectBossTaunt(b.game.state, b.game.ctx)).toBe('mixed');
    b.game.destroy();
  });
});

describe('wave start event flow', () => {
  it('earlyStart gold, then phase:changed, then wave:started; then wave:planned for N+1', async () => {
    const { game } = await newGame({ resume: makeRunSave(data, 4) });
    const order: GameEventName[] = [];
    for (const name of [GameEvents.GoldChanged, GameEvents.PhaseChanged, GameEvents.WaveStarted, GameEvents.WavePlanned] as const) {
      game.ctx.events.on(name, () => order.push(name));
    }
    game.commands.startWave();
    expect(order).toEqual([GameEvents.GoldChanged, GameEvents.PhaseChanged, GameEvents.WaveStarted]);
    expect(game.state.currentWaveStats?.wave).toBe(4);
    expect(game.state.buildTimerMs).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(order[order.length - 1]).toBe(GameEvents.WavePlanned);
    expect(game.state.nextPlan?.wave).toBe(5);
    expect(game.state.planSources[5]).toBe('fallback');
    game.destroy();
  });

  it('the fixed-step loop runs whole steps, x speed, at most 10 x speed per call; pause runs none', async () => {
    const { game } = await newGame({ resume: makeRunSave(data, 1) });
    const { state } = game;
    game.commands.startWave();
    game.step(FIXED_STEP_MS * 2.5);
    expect(state.elapsedMs).toBeCloseTo(FIXED_STEP_MS * 2, 6);
    game.step(FIXED_STEP_MS * 0.5); // accumulator reaches 3 steps
    expect(state.elapsedMs).toBeCloseTo(FIXED_STEP_MS * 3, 6);
    game.commands.setSpeed(2);
    game.step(FIXED_STEP_MS);
    expect(state.elapsedMs).toBeCloseTo(FIXED_STEP_MS * 5, 6);
    game.step(1000); // 120 steps due, capped at 20
    expect(state.elapsedMs).toBeCloseTo(FIXED_STEP_MS * 25, 6);
    game.commands.togglePause();
    game.step(1000);
    expect(state.elapsedMs).toBeCloseTo(FIXED_STEP_MS * 25, 6);
    game.destroy();
  });

  it('per-wave tallies become the WaveRecord at payout', async () => {
    const { game } = await newGame();
    game.commands.placeTower('Arrow', BEND1[0]);
    game.commands.placeTower('Arrow', BEND1[1]);
    let spawned = 0;
    let killGold = 0;
    game.ctx.events.on(GameEvents.EnemySpawned, () => (spawned += 1));
    game.ctx.events.on(GameEvents.EnemyKilled, ({ gold }) => (killGold += gold));
    const goldStart = game.state.gold;
    game.commands.startWave();
    playCombat(game);
    const rec = game.state.waveHistory[0];
    expect(rec.wave).toBe(1);
    expect(rec.enemies.Grunt).toBe(spawned);
    expect((rec.kills.Grunt ?? 0) + (rec.leaks.Grunt ?? 0)).toBe(spawned);
    expect(rec.coreDamage).toBe(20 - game.state.coreHp);
    expect(rec.goldEnd).toBe(game.state.gold);
    expect(rec.goldEnd - killGold - 30).toBe(goldStart);
    expect(rec.goldStart).toBe(200); // gold when the build phase began, before purchases
    expect(game.state.playedPlans[1]).toEqual(data.waves.waves[0]);
    game.destroy();
  });
});
