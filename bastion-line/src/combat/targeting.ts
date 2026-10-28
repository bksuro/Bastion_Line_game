/**
 * Target selection (SPEC.md section 4 "Targeting").
 * Candidates: alive enemies within range (Euclidean, tower tile centre to enemy pos);
 * canHitAir false excludes flying enemies.
 *   First:     highest pathDistance.
 *   Strongest: highest current hp, ties by First.
 *   Closest:   smallest distance, ties by First.
 *   Final tie: lowest id.
 */
import type { EnemyInstance, SelectTarget, TowerInstance, TowerStats, Vec2 } from '../types';
import { getTowerStats } from '../towers';

/** Tile centre of a tower in tile units. */
export const towerCentre = (tower: TowerInstance): Vec2 => ({ x: tower.tile.x + 0.5, y: tower.tile.y + 0.5 });

/**
 * Orders ids like "e9" < "e10" by their numeric suffix (ids share one counter, SPEC.md 2.3).
 * Falls back to plain string order if an id has no numeric suffix.
 */
export const compareIds = (a: string, b: string): number => {
  const na = Number(a.replace(/^\D+/, ''));
  const nb = Number(b.replace(/^\D+/, ''));
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
};

/** true if `e` beats `b` under First (higher pathDistance, then lower id). */
const beatsFirst = (e: EnemyInstance, b: EnemyInstance): boolean =>
  e.pathDistance > b.pathDistance || (e.pathDistance === b.pathDistance && compareIds(e.id, b.id) < 0);

/** Picks the target from `enemies` for a tower with the given stats; shared by selectTarget and stepCombat. */
export const pickTarget = (
  enemies: readonly EnemyInstance[],
  tower: TowerInstance,
  stats: TowerStats,
): EnemyInstance | null => {
  const c = towerCentre(tower);
  let best: EnemyInstance | null = null;
  let bestDist = 0;
  for (const e of enemies) {
    if (!e.alive || (e.flying && !stats.canHitAir)) continue;
    const dist = Math.hypot(e.pos.x - c.x, e.pos.y - c.y);
    if (dist > stats.range) continue;
    if (best === null) {
      best = e;
      bestDist = dist;
      continue;
    }
    let better: boolean;
    if (tower.targeting === 'Strongest') better = e.hp > best.hp || (e.hp === best.hp && beatsFirst(e, best));
    else if (tower.targeting === 'Closest') better = dist < bestDist || (dist === bestDist && beatsFirst(e, best));
    else better = beatsFirst(e, best);
    if (better) {
      best = e;
      bestDist = dist;
    }
  }
  return best;
};

export const selectTarget: SelectTarget = (state, ctx, tower) =>
  pickTarget(state.enemies, tower, getTowerStats(ctx.data, tower.type, tower.level));
