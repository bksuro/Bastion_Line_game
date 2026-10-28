/** SPEC.md section 8: scripted waves validate, unlockedEnemies on 9/10/11/20; section 3 budgets; section 4 spawning. */
import { describe, expect, it } from 'vitest';
import { GamePhase } from '../src/types';
import type { WavePlan } from '../src/types';
import { createSpawnState, isWaveClear, minThreat, stepSpawner, threatBudget, unlockedEnemies, validateWavePlan } from '../src/waves';
import { enemyHpForWave } from '../src/enemies';
import { bareState, loadData } from './helpers';

const data = loadData();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('scripted waves (data/waves.easy.json)', () => {
  it('has exactly 20 waves numbered 1..20', () => {
    expect(data.waves.waves.map((w) => w.wave)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it.each(Array.from({ length: 20 }, (_, i) => i + 1))('wave %i passes validateWavePlan', (n) => {
    expect(validateWavePlan(data, data.waves.waves[n - 1], n)).toEqual([]);
  });

  it('matches the SPEC 3 budget / min / total table', () => {
    const budgets = [10, 11, 13, 14, 16, 18, 20, 22, 25, 28, 31, 35, 39, 44, 49, 55, 61, 69, 77, 86];
    const mins = [8, 9, 11, 12, 13, 15, 16, 18, 20, 23, 25, 28, 32, 36, 40, 44, 49, 56, 62, 69];
    const totals = [8, 10, 12, 14, 15, 17, 18, 22, 22, 25, 28, 31, 35, 39, 44, 48, 54, 60, 70, 77];
    for (let n = 1; n <= 20; n++) {
      expect(threatBudget(data, n), `budget w${n}`).toBe(budgets[n - 1]);
      expect(minThreat(data, n), `min w${n}`).toBe(mins[n - 1]);
      expect(data.waves.waves[n - 1].totalThreat, `total w${n}`).toBe(totals[n - 1]);
    }
  });
});

describe('validateWavePlan rejects broken plans', () => {
  const w9 = (): WavePlan => clone(data.waves.waves[8]);
  const w10 = (): WavePlan => clone(data.waves.waves[9]);

  it('wrong wave number', () => expect(validateWavePlan(data, w9(), 8).length).toBeGreaterThan(0));
  it('Boss off its boss waves', () => {
    const p = w9();
    p.groups[0] = { enemy: 'Boss', count: 1, spawnIntervalMs: 1000, startDelayMs: 0 };
    expect(validateWavePlan(data, p, 9).join(' ')).toMatch(/Boss/);
  });
  it('boss wave without exactly one Boss', () => {
    const p = w10();
    p.groups = p.groups.filter((g) => g.enemy !== 'Boss');
    expect(validateWavePlan(data, p, 10).join(' ')).toMatch(/Boss/);
    const q = w10();
    q.groups.find((g) => g.enemy === 'Boss')!.count = 2;
    expect(validateWavePlan(data, q, 10).length).toBeGreaterThan(0);
  });
  it('locked enemy (Flyer on wave 6)', () => {
    const p = clone(data.waves.waves[5]);
    p.groups[0].enemy = 'Flyer';
    expect(validateWavePlan(data, p, 6).join(' ')).toMatch(/Flyer/);
  });
  it('totalThreat mismatch, over budget and under minimum', () => {
    const p = w9();
    p.totalThreat += 1;
    expect(validateWavePlan(data, p, 9).length).toBeGreaterThan(0);
    const over = w9();
    over.groups[1].count += 4; // +4 Grunts: 26 > 25
    over.totalThreat += 4;
    expect(validateWavePlan(data, over, 9).join(' ')).toMatch(/budget/);
    const under = w9();
    under.groups[1].count -= 3; // 19 < 20
    under.totalThreat -= 3;
    expect(validateWavePlan(data, under, 9).join(' ')).toMatch(/minimum/);
  });
  it('group count, count, interval, delay, previewText and reason limits', () => {
    const five = w9();
    five.groups = [...five.groups, ...five.groups, five.groups[0]];
    expect(validateWavePlan(data, five, 9).length).toBeGreaterThan(0);
    const mk = (f: (p: WavePlan) => void): string[] => {
      const p = w9();
      f(p);
      return validateWavePlan(data, p, 9);
    };
    expect(mk((p) => (p.groups[0].count = 31)).length).toBeGreaterThan(0);
    expect(mk((p) => (p.groups[0].count = 0)).length).toBeGreaterThan(0);
    expect(mk((p) => (p.groups[0].spawnIntervalMs = 299)).length).toBeGreaterThan(0);
    expect(mk((p) => (p.groups[0].spawnIntervalMs = 3001)).length).toBeGreaterThan(0);
    expect(mk((p) => (p.groups[0].startDelayMs = -1)).length).toBeGreaterThan(0);
    expect(mk((p) => (p.groups[0].startDelayMs = 20001)).length).toBeGreaterThan(0);
    expect(mk((p) => (p.previewText = 'x'.repeat(81))).length).toBeGreaterThan(0);
    expect(mk((p) => (p.previewText = 'x'.repeat(80)))).toEqual([]);
    expect(mk((p) => (p.reason = Array(26).fill('w').join(' '))).length).toBeGreaterThan(0);
    expect(mk((p) => (p.reason = Array(25).fill('w').join(' ')))).toEqual([]);
  });
});

describe('unlockedEnemies (unlock rule, SPEC 3)', () => {
  it('wave 9: Grunt, Runner, Brute, Flyer, no Boss', () => {
    expect(unlockedEnemies(data, 9)).toEqual(['Grunt', 'Runner', 'Brute', 'Flyer']);
  });
  it('wave 10: those plus Boss', () => {
    expect(unlockedEnemies(data, 10)).toEqual(['Grunt', 'Runner', 'Brute', 'Flyer', 'Boss']);
  });
  it('wave 11: no Boss', () => {
    expect(unlockedEnemies(data, 11)).toEqual(['Grunt', 'Runner', 'Brute', 'Flyer']);
  });
  it('wave 20: with Boss', () => {
    expect(unlockedEnemies(data, 20)).toEqual(['Grunt', 'Runner', 'Brute', 'Flyer', 'Boss']);
  });
  it('early waves follow unlockWave', () => {
    expect(unlockedEnemies(data, 1)).toEqual(['Grunt']);
    expect(unlockedEnemies(data, 3)).toEqual(['Grunt', 'Runner']);
    expect(unlockedEnemies(data, 5)).toEqual(['Grunt', 'Runner', 'Brute']);
    expect(unlockedEnemies(data, 7)).toEqual(['Grunt', 'Runner', 'Brute', 'Flyer']);
    for (let n = 11; n <= 19; n++) expect(unlockedEnemies(data, n)).not.toContain('Boss');
  });
});

describe('enemy HP growth (x1.10 per wave)', () => {
  it('matches the SPEC 3 enemy table', () => {
    const at = (t: 'Grunt' | 'Runner' | 'Brute' | 'Flyer' | 'Boss', ws: number[]) => ws.map((w) => enemyHpForWave(data, t, w));
    expect(at('Grunt', [5, 9, 10, 15, 20])).toEqual([88, 129, 141, 228, 367]);
    expect(at('Runner', [5, 9, 10, 15, 20])).toEqual([53, 77, 85, 137, 220]);
    expect(at('Brute', [5, 9, 10, 15, 20])).toEqual([351, 514, 566, 911, 1468]);
    expect(at('Flyer', [5, 9, 10, 15, 20])).toEqual([132, 193, 212, 342, 550]);
    expect(at('Boss', [10, 20])).toEqual([4716, 12232]);
  });
});

describe('stepSpawner', () => {
  it('spawns enemy i of every group at startDelayMs + i x spawnIntervalMs, groups independent', () => {
    const { ctx, state } = bareState(GamePhase.Combat);
    state.wave = 3;
    state.currentPlan = {
      wave: 3,
      groups: [
        { enemy: 'Grunt', count: 3, spawnIntervalMs: 1000, startDelayMs: 0 },
        { enemy: 'Runner', count: 2, spawnIntervalMs: 500, startDelayMs: 1200 },
      ],
      totalThreat: 5,
      previewText: 'test',
      reason: 'test',
    };
    state.spawn = createSpawnState(state.currentPlan);
    const spawnTimes: [string, number][] = [];
    const dt = 1000 / 60;
    for (let i = 0; i < 200; i++) {
      const t = state.spawn.waveElapsedMs;
      const before = state.enemies.length;
      stepSpawner(state, ctx, dt);
      for (const e of state.enemies.slice(before)) spawnTimes.push([e.type, t]);
    }
    const first = (type: string, k: number) => spawnTimes.filter(([ty]) => ty === type)[k][1];
    expect(spawnTimes).toHaveLength(5);
    expect(first('Grunt', 0)).toBe(0);
    expect(first('Grunt', 1)).toBeGreaterThanOrEqual(1000 - 1e-6);
    expect(first('Grunt', 1)).toBeLessThan(1000 + dt);
    expect(first('Grunt', 2)).toBeGreaterThanOrEqual(2000 - 1e-6);
    expect(first('Runner', 0)).toBeGreaterThanOrEqual(1200 - 1e-6);
    expect(first('Runner', 0)).toBeLessThan(1200 + dt);
    expect(first('Runner', 1)).toBeGreaterThanOrEqual(1700 - 1e-6);
    expect(state.enemies.every((e) => e.pathDistance === 0 && e.wave === 3)).toBe(true);
    expect(state.enemies.find((e) => e.type === 'Grunt')!.hp).toBe(enemyHpForWave(data, 'Grunt', 3));
    expect(state.spawn.totalSpawned).toBe(5);
  });

  it('isWaveClear needs every group spawned and no live enemies or unspent projectiles', () => {
    const { state } = bareState(GamePhase.Combat);
    state.currentPlan = clone(data.waves.waves[0]);
    state.spawn = createSpawnState(state.currentPlan);
    expect(isWaveClear(state)).toBe(false);
    state.spawn.totalSpawned = state.spawn.totalToSpawn;
    expect(isWaveClear(state)).toBe(true);
    state.projectiles.push({ id: 'p1', towerId: 't1', towerType: 'Arrow', targetId: 'e1', lastTargetPos: { x: 0, y: 0 }, pos: { x: 0, y: 0 }, damage: 1, speed: 1, splashRadius: 0, slowPct: 0, slowMs: 0, canHitAir: true, spent: false });
    expect(isWaveClear(state)).toBe(false);
    state.projectiles[0].spent = true;
    expect(isWaveClear(state)).toBe(true);
  });
});
