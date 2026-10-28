/**
 * One fixed combat step (SPEC.md section 4 "Firing", "Projectiles", "Kills"; types.ts StepSystem).
 * Order, matching tools/balance-sim.mjs:
 *   1. towers: cooldown -= dt (floored at 0); when ready and a target exists, fire a homing
 *      projectile ('p' id, stats snapshot) and set cooldownMs = fireRateMs.
 *   2. projectiles (including the ones fired this step): home on the target, hit when the remaining
 *      distance <= this step's travel + target radius; dead target -> single-target fizzles,
 *      splash detonates at lastTargetPos.
 * Never removes entries from state.enemies / state.projectiles (core's cleanup does).
 */
import { GameEvents } from '../types';
import type { EnemyInstance, GameContext, GameState, ProjectileInstance, StepSystem, TowerInstance } from '../types';
import { getTowerStats } from '../towers';
import { addGold } from '../economy';
import { pickTarget, towerCentre } from './targeting';

const fireTowers = (state: GameState, ctx: GameContext, dtMs: number): void => {
  for (const tower of state.towers) {
    tower.cooldownMs = Math.max(0, tower.cooldownMs - dtMs);
    if (tower.cooldownMs > 0) continue;
    const stats = getTowerStats(ctx.data, tower.type, tower.level);
    const target = pickTarget(state.enemies, tower, stats);
    if (!target) continue;
    const id = `p${state.nextId}`;
    state.nextId += 1;
    const projectile: ProjectileInstance = {
      id,
      towerId: tower.id,
      towerType: tower.type,
      targetId: target.id,
      lastTargetPos: { x: target.pos.x, y: target.pos.y },
      pos: towerCentre(tower),
      damage: stats.damage,
      speed: stats.projectileSpeed,
      splashRadius: stats.splashRadius,
      slowPct: stats.slowPct,
      slowMs: stats.slowMs,
      canHitAir: stats.canHitAir,
      spent: false,
    };
    state.projectiles.push(projectile);
    tower.cooldownMs = stats.fireRateMs;
    ctx.events.emit(GameEvents.TowerFired, { towerId: tower.id, projectileId: id, targetId: target.id });
  }
};

/** Applies one projectile's damage (and slow) to one enemy; handles the kill. */
const applyHit = (
  state: GameState,
  ctx: GameContext,
  p: ProjectileInstance,
  enemy: EnemyInstance,
  tower: TowerInstance | undefined,
): void => {
  if (!enemy.alive) return;
  const dealt = Math.min(enemy.hp, p.damage);
  enemy.hp -= p.damage;
  if (tower) tower.damageDealt += dealt;
  if (p.slowPct > 0) {
    enemy.slowPct = Math.max(enemy.slowPct, p.slowPct);
    enemy.slowRemainingMs = Math.max(enemy.slowRemainingMs, p.slowMs);
  }
  ctx.events.emit(GameEvents.EnemyDamaged, {
    enemyId: enemy.id,
    amount: dealt,
    hpLeft: Math.max(0, enemy.hp),
    towerId: p.towerId,
  });
  if (enemy.hp <= 0) {
    enemy.alive = false;
    if (tower) tower.kills += 1;
    const gold = ctx.data.enemies.enemies[enemy.type].goldReward;
    ctx.events.emit(GameEvents.EnemyKilled, { enemy, towerId: p.towerId, gold });
    addGold(state, ctx, gold, 'kill');
  }
};

const stepProjectiles = (state: GameState, ctx: GameContext, dtMs: number): void => {
  const byId = new Map<string, EnemyInstance>();
  for (const e of state.enemies) byId.set(e.id, e);
  const towersById = new Map<string, TowerInstance>();
  for (const t of state.towers) towersById.set(t.id, t);

  for (const p of state.projectiles) {
    if (p.spent) continue;
    const target = byId.get(p.targetId);
    const targetAlive = target !== undefined && target.alive;
    if (targetAlive) {
      p.lastTargetPos = { x: target.pos.x, y: target.pos.y };
    } else if (p.splashRadius <= 0) {
      p.spent = true; // fizzle
      continue;
    }
    const dx = p.lastTargetPos.x - p.pos.x;
    const dy = p.lastTargetPos.y - p.pos.y;
    const dist = Math.hypot(dx, dy);
    const step = (p.speed * dtMs) / 1000;
    const radius = targetAlive ? ctx.data.enemies.enemies[target.type].radius : 0;
    if (dist > step + radius) {
      p.pos = { x: p.pos.x + (dx / dist) * step, y: p.pos.y + (dy / dist) * step };
      continue;
    }

    // Hit.
    p.spent = true;
    const impact = { x: p.lastTargetPos.x, y: p.lastTargetPos.y };
    const tower = towersById.get(p.towerId);
    let victims: EnemyInstance[];
    if (p.splashRadius > 0) {
      victims = state.enemies.filter(
        (e) =>
          e.alive &&
          (!e.flying || p.canHitAir) &&
          Math.hypot(e.pos.x - impact.x, e.pos.y - impact.y) <= p.splashRadius,
      );
    } else {
      victims = targetAlive ? [target] : [];
    }
    p.pos = impact;
    ctx.events.emit(GameEvents.ProjectileHit, {
      projectileId: p.id,
      towerType: p.towerType,
      pos: impact,
      enemyIds: victims.map((e) => e.id),
    });
    for (const e of victims) applyHit(state, ctx, p, e, tower);
  }
};

export const stepCombat: StepSystem = (state, ctx, dtMs) => {
  fireTowers(state, ctx, dtMs);
  stepProjectiles(state, ctx, dtMs);
};
