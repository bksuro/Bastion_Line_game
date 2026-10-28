/**
 * Threat budget and the unlock rule (SPEC.md section 3). Pure data lookups, no state.
 */
import { ENEMY_TYPES } from '../types';
import type { EnemyDef, GameData, MinThreat, ThreatBudget, UnlockedEnemies } from '../types';

/** budget_N = floor(wave1Budget * budgetGrowth^(N-1) + 0.5) (round half up). */
export const threatBudget: ThreatBudget = (data, wave) => {
  const t = data.economy.threat;
  return Math.floor(t.wave1Budget * t.budgetGrowth ** (wave - 1) + 0.5);
};

/** ceil(minSpendPct * budget_N). */
export const minThreat: MinThreat = (data, wave) => {
  return Math.ceil(data.economy.threat.minSpendPct * threatBudget(data, wave));
};

/**
 * UNLOCK RULE: unlocked on wave N iff (bossWaves is empty and unlockWave <= N) or bossWaves includes N.
 * So the Boss is listed on waves 10 and 20 only.
 */
export function isUnlocked(def: EnemyDef, wave: number): boolean {
  if (def.bossWaves.length > 0) return def.bossWaves.includes(wave);
  return def.unlockWave <= wave;
}

export const unlockedEnemies: UnlockedEnemies = (data, wave) => {
  return ENEMY_TYPES.filter((type) => isUnlocked(data.enemies.enemies[type], wave));
};

/** The waves on which some boss-type enemy must appear (union of every bossWaves list). */
export function bossWavesOf(data: GameData): number[] {
  const out = new Set<number>();
  for (const type of ENEMY_TYPES) for (const w of data.enemies.enemies[type].bossWaves) out.add(w);
  return [...out].sort((a, b) => a - b);
}
