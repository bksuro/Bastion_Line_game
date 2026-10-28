/** SPEC.md section 8: clear bonus, stars, early bonus 0..5 and 0 on wave 1. */
import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS, GameEvents, GamePhase } from '../src/types';
import type { GoldChangeReason } from '../src/types';
import { computeStars, earlyStartBonus, waveClearBonus } from '../src/economy';
import { BEND1, loadData, makeRunSave, newGame, phaseOf, playCombat } from './helpers';

const data = loadData();

describe('wave clear bonus', () => {
  it('is 25 + 5N for every wave 1..20', () => {
    for (let n = 1; n <= 20; n++) expect(waveClearBonus(data, n)).toBe(25 + 5 * n);
  });

  it('is paid at payout with economy:payout carrying the wave kill gold', async () => {
    const { game } = await newGame();
    const { state, commands, ctx } = game;
    commands.placeTower('Arrow', BEND1[0]);
    commands.placeTower('Arrow', BEND1[1]);
    const payouts: { waveClearBonus: number; killGoldThisWave: number }[] = [];
    let killGold = 0;
    ctx.events.on(GameEvents.Payout, (p) => payouts.push(p));
    ctx.events.on(GameEvents.EnemyKilled, ({ gold }) => (killGold += gold));
    const start = state.gold;
    commands.startWave();
    playCombat(game);
    expect(payouts).toHaveLength(1);
    expect(payouts[0].waveClearBonus).toBe(30);
    expect(payouts[0].killGoldThisWave).toBe(killGold);
    expect(state.gold).toBe(start + killGold + 30);
    game.destroy();
  });
});

describe('stars', () => {
  it('Lost 0; no core damage 3; coreHp >= 10 is 2; any other win 1', () => {
    expect(computeStars(data, false, 20)).toBe(0);
    expect(computeStars(data, false, 0)).toBe(0);
    expect(computeStars(data, true, 20)).toBe(3);
    expect(computeStars(data, true, 19)).toBe(2);
    expect(computeStars(data, true, 10)).toBe(2);
    expect(computeStars(data, true, 9)).toBe(1);
    expect(computeStars(data, true, 1)).toBe(1);
  });
});

describe('early start bonus', () => {
  it('is floor(5 x r / 20000), so 0..5', () => {
    const cases: [number | null, number][] = [
      [null, 0],
      [0, 0],
      [-5, 0],
      [3999, 0],
      [4000, 1],
      [7999, 1],
      [8000, 2],
      [12000, 3],
      [15999, 3],
      [16000, 4],
      [19999, 4],
      [20000, 5],
      [25000, 5],
    ];
    for (const [r, b] of cases) expect(earlyStartBonus(data, r), `r=${r}`).toBe(b);
    for (let r = 0; r <= 20000; r += 250) {
      const b = earlyStartBonus(data, r);
      expect(b).toBe(Math.floor((5 * r) / 20000));
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(5);
    }
  });

  it('wave 1 is untimed and pays no bonus when Space is pressed', async () => {
    const { game } = await newGame();
    const reasons: GoldChangeReason[] = [];
    let started = -1;
    game.ctx.events.on(GameEvents.GoldChanged, ({ reason }) => reasons.push(reason));
    game.ctx.events.on(GameEvents.WaveStarted, ({ earlyStartBonus: b }) => (started = b));
    expect(game.state.buildTimerMs).toBeNull();
    const gold = game.state.gold;
    expect(game.commands.startWave()).toEqual({ ok: true });
    expect(started).toBe(0);
    expect(reasons).not.toContain('earlyStart');
    expect(game.state.gold).toBe(gold);
    expect(game.state.currentWaveStats?.earlyStartBonus).toBe(0);
    expect(game.state.currentWaveStats?.earlyStart).toBe(false);
    game.destroy();
  });

  it('wave 1 build phase never auto-starts', async () => {
    const { game } = await newGame();
    for (let i = 0; i < 3000; i++) game.step(FIXED_STEP_MS);
    expect(game.state.phase).toBe(GamePhase.Build);
    game.destroy();
  });

  it('pressing Space at once on wave 2 pays 5; after 10 s of build time it pays 2', async () => {
    const a = await newGame({ resume: makeRunSave(data, 2) });
    const g1 = a.game.state.gold;
    expect(a.game.state.buildTimerMs).toBe(20000);
    a.game.commands.startWave();
    expect(a.game.state.gold - g1).toBe(5);
    expect(a.game.state.currentWaveStats?.earlyStartBonus).toBe(5);
    a.game.destroy();

    const b = await newGame({ resume: makeRunSave(data, 2) });
    for (let i = 0; i < 10; i++) b.game.step(1000);
    expect(b.game.state.buildTimerMs).toBe(10000);
    const g2 = b.game.state.gold;
    b.game.commands.startWave();
    expect(b.game.state.gold - g2).toBe(2);
    b.game.destroy();
  });

  it('the timer auto-starts at 0 with no bonus, and is frozen while paused', async () => {
    const { game } = await newGame({ resume: makeRunSave(data, 2) });
    game.commands.togglePause();
    game.step(30000);
    expect(game.state.buildTimerMs).toBe(20000);
    game.commands.togglePause();
    const gold = game.state.gold;
    let bonus = -1;
    game.ctx.events.on(GameEvents.WaveStarted, ({ earlyStartBonus: b }) => (bonus = b));
    for (let i = 0; i < 20; i++) game.step(1000);
    expect(phaseOf(game.state)).toBe(GamePhase.Combat);
    expect(bonus).toBe(0);
    expect(game.state.gold).toBe(gold);
    game.destroy();
  });

  it('the build timer runs on real ms, not scaled by game speed', async () => {
    const { game } = await newGame({ resume: makeRunSave(data, 2) });
    game.commands.setSpeed(3);
    game.step(1000);
    expect(game.state.buildTimerMs).toBe(19000);
    game.destroy();
  });
});
