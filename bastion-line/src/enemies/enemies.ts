/**
 * Enemy HP scaling, spawning and movement (agent 3). Pure TS, no Phaser.
 * Rules: SPEC.md section 4 (Movement) and 2.3 (Leak, nextId).
 */
import type { EnemyHpForWave, EnemyInstance, SpawnEnemy, StepSystem } from '../types';
import { GameEvents } from '../types';

/** Absorbs float drift from repeated 1000/60 ms steps, so a 1500 ms slow lasts exactly 90 steps. */
const SLOW_EPSILON_MS = 1e-6;

export const enemyHpForWave: EnemyHpForWave = (data, type, wave) => {
  const def = data.enemies.enemies[type];
  return Math.round(def.hp * data.economy.enemyHpMultiplierPerWave ** (wave - 1));
};

export const spawnEnemy: SpawnEnemy = (state, ctx, type) => {
  const def = ctx.data.enemies.enemies[type];
  const hp = enemyHpForWave(ctx.data, type, state.wave);
  const id = `e${state.nextId}`;
  state.nextId += 1;
  const { pos, segment } = ctx.mapQueries.positionAt(0);
  const enemy: EnemyInstance = {
    id,
    type,
    hp,
    maxHp: hp,
    speed: def.speed,
    pathDistance: 0,
    pos,
    segment,
    flying: def.flying,
    slowPct: 0,
    slowRemainingMs: 0,
    wave: state.wave,
    alive: true,
  };
  state.enemies.push(enemy);
  ctx.events.emit(GameEvents.EnemySpawned, { enemy });
  return enemy;
};

/**
 * Per live enemy, in array order: advance by speed * (1 - slowPct/100) * dt, decay the slow (reset
 * slowPct at 0), then leak at pathDistance >= pathLength or update pos/segment. Same order as
 * tools/balance-sim.mjs. Stops at the first leak that takes coreHp to 0 (core ends the game after
 * this call; the sim stops there too).
 */
export const stepEnemies: StepSystem = (state, ctx, dtMs) => {
  const pathLength = ctx.map.pathLength;
  for (const e of state.enemies) {
    if (!e.alive) continue;
    e.pathDistance += (e.speed * (1 - e.slowPct / 100) * dtMs) / 1000;
    if (e.slowRemainingMs > 0 || e.slowPct !== 0) {
      e.slowRemainingMs -= dtMs;
      if (e.slowRemainingMs <= SLOW_EPSILON_MS) {
        e.slowRemainingMs = 0;
        e.slowPct = 0;
      }
    }
    const { pos, segment } = ctx.mapQueries.positionAt(e.pathDistance);
    e.pos = pos;
    e.segment = segment;
    if (e.pathDistance >= pathLength) {
      const coreDamage = ctx.data.enemies.enemies[e.type].coreDamage;
      e.alive = false;
      state.coreHp = Math.max(0, state.coreHp - coreDamage);
      ctx.events.emit(GameEvents.EnemyLeaked, { enemy: e, coreDamage });
      ctx.events.emit(GameEvents.CoreDamaged, { coreHp: state.coreHp, amount: coreDamage, enemy: e.type });
      if (state.coreHp <= 0) return;
    }
  }
};
