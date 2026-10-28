/** SPEC.md section 8: upgrade costs, refunds; section 3 tower stats; section 4 spending rules. */
import { describe, expect, it } from 'vitest';
import { GamePhase, TOWER_TYPES } from '../src/types';
import type { TowerLevel } from '../src/types';
import { canPlace, getTowerStats, sellRefund, upgradeCost } from '../src/towers';
import { BEND1, bareState, loadData, newGame } from './helpers';

const data = loadData();
const roundHalfUp = (x: number): number => Math.floor(x + 0.5);

describe('upgrade costs', () => {
  const expected = { Arrow: [30, 50, 75], Frost: [45, 75, 113], Cannon: [60, 100, 150], Sniper: [90, 150, 225] } as const;

  it.each(TOWER_TYPES)('%s upgradeCosts are round-half-up(base x 0.6/1.0/1.5) and match SPEC 8', (type) => {
    const def = data.towers.towers[type];
    expect(def.upgradeCosts).toEqual([...expected[type]]);
    expect(def.upgradeCosts).toEqual(data.towers.upgradeCostPct.map((p) => roundHalfUp(def.cost * p)));
  });

  it.each(TOWER_TYPES)('%s upgradeCost() reads data for levels 1-3 and is null at level 4', (type) => {
    expect([1, 2, 3].map((l) => upgradeCost(data, type, l as TowerLevel))).toEqual([...expected[type]]);
    expect(upgradeCost(data, type, 4)).toBeNull();
  });

  it('upgradeTower charges upgradeCosts[level-1], adds it to totalSpent and stops at max_level', async () => {
    const { game } = await newGame();
    const { state, commands } = game;
    state.gold = 10_000;
    expect(commands.placeTower('Frost', BEND1[0])).toEqual({ ok: true });
    const t = state.towers[0];
    const costs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const before = state.gold;
      expect(commands.upgradeTower(t.id)).toEqual({ ok: true });
      costs.push(before - state.gold);
    }
    expect(costs).toEqual([45, 75, 113]);
    expect(t.level).toBe(4);
    expect(t.totalSpent).toBe(75 + 45 + 75 + 113);
    expect(commands.upgradeTower(t.id)).toEqual({ ok: false, reason: 'max_level' });
    game.destroy();
  });

  it('upgradeTower fails with not_enough_gold one gold short and changes nothing', async () => {
    const { game } = await newGame();
    const { state, commands } = game;
    commands.placeTower('Arrow', BEND1[0]);
    state.gold = 29;
    expect(commands.upgradeTower(state.towers[0].id)).toEqual({ ok: false, reason: 'not_enough_gold' });
    expect(state.towers[0].level).toBe(1);
    expect(state.gold).toBe(29);
    game.destroy();
  });
});

describe('sell refund', () => {
  it('matches the SPEC 3 sell column for every tower level', () => {
    const sells: Record<string, number[]> = {
      Arrow: [35, 56, 91, 143],
      Frost: [52, 84, 136, 215],
      Cannon: [70, 112, 182, 287],
      Sniper: [105, 168, 273, 430],
    };
    for (const type of TOWER_TYPES) {
      const def = data.towers.towers[type];
      let spent = def.cost;
      const got = [sellRefund(data, spent)];
      for (const c of def.upgradeCosts) {
        spent += c;
        got.push(sellRefund(data, spent));
      }
      expect(got, type).toEqual(sells[type]);
    }
  });

  it('is exactly floor(0.7 x spent) for every totalSpent a tower can reach', () => {
    // Integer arithmetic gives the exact floor.
    const reachable = TOWER_TYPES.flatMap((type) => {
      const def = data.towers.towers[type];
      return def.upgradeCosts.reduce((acc, c) => [...acc, acc[acc.length - 1] + c], [def.cost]);
    });
    const wrong: string[] = [];
    for (const spent of reachable) {
      const exact = Math.floor((spent * 7) / 10);
      const got = sellRefund(data, spent);
      if (got !== exact) wrong.push(`${spent} -> ${got} (expected ${exact})`);
    }
    expect(wrong).toEqual([]);
  });

  it('is exactly floor(0.7 x spent) for every integer total 0..2000 (no float drift, e.g. 90 -> 63)', () => {
    const wrong: string[] = [];
    for (let spent = 0; spent <= 2000; spent++) {
      const exact = Math.floor((spent * 7) / 10);
      const got = sellRefund(data, spent);
      if (got !== exact) wrong.push(`${spent} -> ${got} (expected ${exact})`);
    }
    expect(wrong).toEqual([]);
  });

  it('sellTower refunds floor(0.7 x totalSpent), frees the tile and is Build-only', async () => {
    const { game } = await newGame();
    const { state, commands } = game;
    commands.placeTower('Arrow', BEND1[0]);
    commands.upgradeTower(state.towers[0].id);
    const id = state.towers[0].id;
    const before = state.gold;
    expect(commands.sellTower(id)).toEqual({ ok: true });
    expect(state.gold - before).toBe(56);
    expect(state.towers).toHaveLength(0);
    expect(commands.placeTower('Arrow', BEND1[0])).toEqual({ ok: true });
    commands.startWave();
    expect(commands.sellTower(state.towers[0].id)).toEqual({ ok: false, reason: 'wrong_phase' });
    expect(commands.placeTower('Arrow', BEND1[1])).toEqual({ ok: false, reason: 'wrong_phase' });
    expect(commands.upgradeTower(state.towers[0].id)).toEqual({ ok: false, reason: 'wrong_phase' });
    // Retargeting is free and allowed in Combat.
    expect(commands.setTargeting(state.towers[0].id, 'Strongest')).toEqual({ ok: true });
    game.destroy();
  });
});

describe('tower stats (SPEC 3 table)', () => {
  it('derives level stats from the multipliers (float, never rounded)', () => {
    const a4 = getTowerStats(data, 'Arrow', 4);
    expect(a4.damage).toBeCloseTo(27.4, 6);
    expect(a4.range).toBeCloseTo(2.875, 6);
    expect(a4.fireRateMs).toBeCloseTo(560, 6);
    const f2 = getTowerStats(data, 'Frost', 2);
    expect(f2.range).toBeCloseTo(2.2, 6);
    expect(f2.slowMs).toBeCloseTo(1875, 6);
    expect(f2.slowPct).toBe(40);
    const s3 = getTowerStats(data, 'Sniper', 3);
    expect(s3.damage).toBeCloseTo(156.8, 6);
    expect(s3.fireRateMs).toBeCloseTo(1700, 6);
    expect(getTowerStats(data, 'Cannon', 1).canHitAir).toBe(false);
    expect(getTowerStats(data, 'Frost', 1).canHitAir).toBe(false);
  });
});

describe('canPlace', () => {
  it('reports failures in the contract order and never mutates', () => {
    const { ctx, state } = bareState(GamePhase.Build);
    expect(canPlace(state, ctx, 'Arrow', { x: 5, y: 1 })).toEqual({ ok: false, reason: 'tile_not_buildable' }); // path
    expect(canPlace(state, ctx, 'Arrow', { x: 1, y: 10 })).toEqual({ ok: false, reason: 'tile_not_buildable' }); // core
    expect(canPlace(state, ctx, 'Arrow', { x: -1, y: 3 })).toEqual({ ok: false, reason: 'tile_not_buildable' }); // off-grid
    state.towers.push({ id: 't1', type: 'Arrow', level: 1, tile: BEND1[0], targeting: 'First', totalSpent: 50, cooldownMs: 0, kills: 0, damageDealt: 0, placedOnWave: 1 });
    state.gold = 0;
    expect(canPlace(state, ctx, 'Arrow', BEND1[0])).toEqual({ ok: false, reason: 'tile_occupied' });
    expect(canPlace(state, ctx, 'Arrow', BEND1[1])).toEqual({ ok: false, reason: 'not_enough_gold' });
    state.gold = 50;
    expect(canPlace(state, ctx, 'Arrow', BEND1[1])).toEqual({ ok: true });
    expect(state.gold).toBe(50);
    expect(state.towers).toHaveLength(1);
    state.phase = GamePhase.Combat;
    expect(canPlace(state, ctx, 'Arrow', BEND1[1])).toEqual({ ok: false, reason: 'wrong_phase' });
    state.phase = GamePhase.Lost;
    expect(canPlace(state, ctx, 'Arrow', BEND1[1])).toEqual({ ok: false, reason: 'game_over' });
  });

  it('a new tower defaults to First targeting and costs its base cost', async () => {
    const { data: d, game } = await newGame();
    const before = game.state.gold;
    expect(game.commands.placeTower('Sniper', BEND1[0])).toEqual({ ok: true });
    expect(game.state.towers[0].targeting).toBe('First');
    expect(game.state.towers[0].totalSpent).toBe(d.towers.towers.Sniper.cost);
    expect(before - game.state.gold).toBe(150);
    game.destroy();
  });
});
