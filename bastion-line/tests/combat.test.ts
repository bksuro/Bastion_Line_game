/** SPEC.md section 8: targeting tie-breaks and air rules; section 4 firing, projectiles, splash, slow, kills. */
import { describe, expect, it } from 'vitest';
import { GameEvents, GamePhase } from '../src/types';
import type { GameEventName } from '../src/types';
import { selectTarget, stepCombat } from '../src/combat';
import { stepEnemies } from '../src/enemies';
import { getTowerStats } from '../src/towers';
import { BEND1, bareState, makeEnemy, makeTower } from './helpers';

/*
 * Tower on (16,2), centre (16.5, 2.5). Row 1 of the path runs along y = 1.5 with path distance d = x + 0.5,
 * so d = 16 -> (15.5, 1.5) and d = 18 -> (17.5, 1.5) are both sqrt(2) away, d = 17 -> (16.5, 1.5) is 1 away.
 */
const TILE = BEND1[0];

describe('selectTarget: modes and tie-breaks', () => {
  it('First = highest pathDistance', () => {
    const { ctx, state } = bareState();
    const t = makeTower(state, 'Arrow', TILE, 'First');
    makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: 16 });
    const lead = makeEnemy(state, ctx, 'Grunt', { id: 'e2', pathDistance: 18 });
    makeEnemy(state, ctx, 'Grunt', { id: 'e3', pathDistance: 17 });
    expect(selectTarget(state, ctx, t)).toBe(lead);
  });

  it('First tie: lowest id, compared numerically (e9 before e10)', () => {
    const { ctx, state } = bareState();
    const t = makeTower(state, 'Arrow', TILE, 'First');
    makeEnemy(state, ctx, 'Grunt', { id: 'e10', pathDistance: 17 });
    const e9 = makeEnemy(state, ctx, 'Grunt', { id: 'e9', pathDistance: 17 });
    expect(selectTarget(state, ctx, t)).toBe(e9);
  });

  it('Strongest = highest current hp, ties by First, then lowest id', () => {
    const { ctx, state } = bareState();
    const t = makeTower(state, 'Arrow', TILE, 'Strongest');
    makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: 18, hp: 50 });
    const strong = makeEnemy(state, ctx, 'Grunt', { id: 'e2', pathDistance: 16, hp: 59 });
    expect(selectTarget(state, ctx, t)).toBe(strong);
    const tiedAhead = makeEnemy(state, ctx, 'Grunt', { id: 'e3', pathDistance: 17, hp: 59 });
    expect(selectTarget(state, ctx, t)).toBe(tiedAhead);
    const tiedLowId = makeEnemy(state, ctx, 'Grunt', { id: 'e0', pathDistance: 17, hp: 59 });
    expect(selectTarget(state, ctx, t)).toBe(tiedLowId);
  });

  it('Strongest uses current hp, not maxHp', () => {
    const { ctx, state } = bareState();
    const t = makeTower(state, 'Arrow', TILE, 'Strongest');
    makeEnemy(state, ctx, 'Brute', { id: 'e1', pathDistance: 16, hp: 10, maxHp: 240 });
    const g = makeEnemy(state, ctx, 'Grunt', { id: 'e2', pathDistance: 16.5, hp: 60 });
    expect(selectTarget(state, ctx, t)).toBe(g);
  });

  it('Closest = smallest distance, ties by First, then lowest id', () => {
    const { ctx, state } = bareState();
    const t = makeTower(state, 'Arrow', TILE, 'Closest');
    makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: 16 });
    const ahead = makeEnemy(state, ctx, 'Grunt', { id: 'e2', pathDistance: 18 });
    expect(selectTarget(state, ctx, t)).toBe(ahead); // equal distance sqrt(2): First wins
    const nearest = makeEnemy(state, ctx, 'Grunt', { id: 'e3', pathDistance: 17 });
    expect(selectTarget(state, ctx, t)).toBe(nearest);
    const same = makeEnemy(state, ctx, 'Grunt', { id: 'e0', pathDistance: 17 });
    expect(selectTarget(state, ctx, t)).toBe(same);
  });

  it('only enemies within range (Euclidean from tile centre) and alive are candidates', () => {
    const { ctx, state } = bareState();
    const t = makeTower(state, 'Arrow', TILE, 'First');
    makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: 13 }); // ~4.1 tiles away
    expect(selectTarget(state, ctx, t)).toBeNull();
    makeEnemy(state, ctx, 'Grunt', { id: 'e2', pathDistance: 18, alive: false });
    expect(selectTarget(state, ctx, t)).toBeNull();
    // Exactly at range 2.5 counts: (16.5, 0) is not on the path, so use a hand-set pos.
    const edge = makeEnemy(state, ctx, 'Grunt', { id: 'e3', pathDistance: 5, pos: { x: 16.5, y: 5.0 } });
    expect(selectTarget(state, ctx, t)).toBe(edge);
  });
});

describe('air rules', () => {
  it('Frost and Cannon never target Flyers; Arrow and Sniper do', () => {
    const { ctx, state } = bareState();
    const flyer = makeEnemy(state, ctx, 'Flyer', { id: 'e1', pathDistance: 18 });
    const grunt = makeEnemy(state, ctx, 'Grunt', { id: 'e2', pathDistance: 16 });
    for (const type of ['Frost', 'Cannon'] as const) {
      expect(selectTarget(state, ctx, makeTower(state, type, TILE, 'First'))).toBe(grunt);
    }
    expect(selectTarget(state, ctx, makeTower(state, 'Arrow', TILE, 'First'))).toBe(flyer);
    expect(selectTarget(state, ctx, makeTower(state, 'Sniper', TILE, 'First'))).toBe(flyer);
    grunt.alive = false;
    expect(selectTarget(state, ctx, makeTower(state, 'Cannon', TILE, 'First'))).toBeNull();
  });

  it('Cannon splash damages ground enemies in radius (primary included) but never a Flyer', () => {
    const { ctx, state } = bareState();
    const t = makeTower(state, 'Cannon', TILE, 'First');
    const primary = makeEnemy(state, ctx, 'Brute', { id: 'e1', pathDistance: 17 });
    const side = makeEnemy(state, ctx, 'Brute', { id: 'e2', pathDistance: 16.4 });
    const flyer = makeEnemy(state, ctx, 'Flyer', { id: 'e3', pathDistance: 16.8 });
    const far = makeEnemy(state, ctx, 'Brute', { id: 'e4', pathDistance: 15.5 }); // 1.5 from impact
    const hits: string[][] = [];
    ctx.events.on(GameEvents.ProjectileHit, ({ enemyIds }) => hits.push(enemyIds));
    for (let i = 0; i < 60 && hits.length === 0; i++) stepCombat(state, ctx, 1000 / 60);
    const dmg = getTowerStats(ctx.data, 'Cannon', 1).damage;
    expect(hits).toHaveLength(1);
    expect(hits[0].sort()).toEqual(['e1', 'e2']);
    expect(primary.hp).toBe(240 - dmg);
    expect(side.hp).toBe(240 - dmg);
    expect(flyer.hp).toBe(90);
    expect(far.hp).toBe(240);
    expect(t.damageDealt).toBe(2 * dmg);
  });

  it('Frost slow (max pct, max duration, no stacking) never touches a Flyer', () => {
    const { ctx, state } = bareState();
    makeTower(state, 'Frost', TILE, 'First', 2);
    const g = makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: 17, slowPct: 0, slowRemainingMs: 3000 });
    const flyer = makeEnemy(state, ctx, 'Flyer', { id: 'e2', pathDistance: 17.2 });
    let hit = false;
    ctx.events.on(GameEvents.ProjectileHit, () => (hit = true));
    for (let i = 0; i < 60 && !hit; i++) stepCombat(state, ctx, 1000 / 60);
    expect(hit).toBe(true);
    expect(g.slowPct).toBe(40);
    expect(g.slowRemainingMs).toBe(3000); // max(current 3000, 1875)
    expect(flyer.slowPct).toBe(0);
    expect(flyer.hp).toBe(90);
  });
});

describe('firing, projectiles and kills', () => {
  it('fires when ready, sets cooldown = fireRateMs, and stays ready with no target', () => {
    const { ctx, state } = bareState();
    const t = makeTower(state, 'Arrow', TILE);
    stepCombat(state, ctx, 1000 / 60);
    expect(state.projectiles).toHaveLength(0);
    expect(t.cooldownMs).toBe(0);
    makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: 17 });
    stepCombat(state, ctx, 1000 / 60);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0].id).toMatch(/^p\d+$/);
    expect(t.cooldownMs).toBe(700);
  });

  it('a kill: alive=false, kills++, damageDealt capped at hp left, enemy:killed then gold:changed(kill)', () => {
    const { ctx, state } = bareState();
    const t = makeTower(state, 'Sniper', TILE);
    const e = makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: 17, hp: 30 });
    const order: GameEventName[] = [];
    ctx.events.on(GameEvents.EnemyKilled, () => order.push(GameEvents.EnemyKilled));
    ctx.events.on(GameEvents.GoldChanged, ({ reason }) => {
      order.push(GameEvents.GoldChanged);
      expect(reason).toBe('kill');
    });
    const gold = state.gold;
    for (let i = 0; i < 30 && e.alive; i++) stepCombat(state, ctx, 1000 / 60);
    expect(e.alive).toBe(false);
    expect(t.kills).toBe(1);
    expect(t.damageDealt).toBe(30);
    expect(state.gold - gold).toBe(4);
    expect(order).toEqual([GameEvents.EnemyKilled, GameEvents.GoldChanged]);
    // Systems never splice the arrays; core's cleanup does.
    expect(state.enemies).toContain(e);
  });

  it('kill gold is paid once even when two shots are in flight', () => {
    const { ctx, state } = bareState();
    makeTower(state, 'Sniper', TILE);
    makeTower(state, 'Sniper', BEND1[1]);
    const e = makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: 17, hp: 1 });
    let kills = 0;
    ctx.events.on(GameEvents.EnemyKilled, () => (kills += 1));
    const gold = state.gold;
    for (let i = 0; i < 30; i++) stepCombat(state, ctx, 1000 / 60);
    expect(e.alive).toBe(false);
    expect(kills).toBe(1);
    expect(state.gold - gold).toBe(4);
    expect(state.projectiles.every((p) => p.spent)).toBe(true);
  });

  it('a single-target shot fizzles when its target died first; splash detonates at lastTargetPos', () => {
    const { ctx, state } = bareState();
    makeTower(state, 'Arrow', TILE);
    const e = makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: 17 });
    stepCombat(state, ctx, 1000 / 60);
    expect(state.projectiles).toHaveLength(1);
    e.alive = false;
    let hits = 0;
    ctx.events.on(GameEvents.ProjectileHit, () => (hits += 1));
    stepCombat(state, ctx, 1000 / 60);
    expect(state.projectiles[0].spent).toBe(true);
    expect(hits).toBe(0);

    const b = bareState();
    makeTower(b.state, 'Cannon', TILE);
    const target = makeEnemy(b.state, b.ctx, 'Grunt', { id: 'e1', pathDistance: 17 });
    const bystander = makeEnemy(b.state, b.ctx, 'Grunt', { id: 'e2', pathDistance: 16.9 });
    stepCombat(b.state, b.ctx, 1000 / 60);
    target.alive = false;
    const ids: string[][] = [];
    b.ctx.events.on(GameEvents.ProjectileHit, ({ enemyIds, pos }) => {
      ids.push(enemyIds);
      expect(pos).toEqual(b.state.projectiles[0].lastTargetPos);
    });
    for (let i = 0; i < 60 && ids.length === 0; i++) stepCombat(b.state, b.ctx, 1000 / 60);
    expect(ids).toEqual([['e2']]);
    expect(bystander.hp).toBeLessThan(60);
  });

  it('slowed enemies move at speed x (1 - slowPct/100) and the slow resets at 0', () => {
    const { ctx, state } = bareState(GamePhase.Combat);
    const e = makeEnemy(state, ctx, 'Grunt', { id: 'e1', pathDistance: 0, slowPct: 40, slowRemainingMs: 1000 / 60 * 2 });
    stepEnemies(state, ctx, 1000 / 60);
    expect(e.pathDistance).toBeCloseTo((1.2 * 0.6) / 60, 10);
    expect(e.slowPct).toBe(40);
    stepEnemies(state, ctx, 1000 / 60);
    expect(e.slowPct).toBe(0);
    expect(e.slowRemainingMs).toBe(0);
    const d = e.pathDistance;
    stepEnemies(state, ctx, 1000 / 60);
    expect(e.pathDistance - d).toBeCloseTo(1.2 / 60, 10);
  });
});
