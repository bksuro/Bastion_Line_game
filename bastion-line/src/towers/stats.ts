/**
 * Tower stat lookups (SPEC.md section 3 "Towers", section 4 "Spending"). Pure data, no state.
 * Every number comes from data/towers.json; nothing is hard-coded here.
 */
import type { GetTowerStats, UpgradeCost, SellRefund } from '../types';

/** Effective stats at a level: base stat x levelMultipliers[level - 1]. Float, never rounded. */
export const getTowerStats: GetTowerStats = (data, type, level) => {
  const def = data.towers.towers[type];
  const m = def.levelMultipliers;
  const i = level - 1;
  return {
    damage: def.damage * m.damage[i],
    range: def.range * m.range[i],
    fireRateMs: def.fireRateMs * m.fireRate[i],
    canHitAir: def.canHitAir,
    splashRadius: def.splashRadius,
    slowPct: def.slowPct,
    slowMs: def.slowMs * m.slowDuration[i],
    projectileSpeed: def.projectileSpeed,
  };
};

/** upgradeCosts[level - 1] (read from data, never recomputed); null at maxLevel. */
export const upgradeCost: UpgradeCost = (data, type, level) => {
  if (level >= data.towers.maxLevel) return null;
  const cost = data.towers.towers[type].upgradeCosts[level - 1];
  return cost === undefined ? null : cost;
};

/**
 * floor(totalSpent * sellRefundPct), exact. The raw float product can land just under an integer
 * (90 * 0.7 = 62.99999999999999), so it is rounded to 6 decimals before the floor.
 */
export const sellRefund: SellRefund = (data, totalSpent) =>
  Math.floor(Math.round(totalSpent * data.towers.sellRefundPct * 1e6) / 1e6);
