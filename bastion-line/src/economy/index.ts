/**
 * src/economy entry module (SPEC.md section 2.1). Owner: agent 5 (Waves, Economy & Agents).
 * Other folders import only from this file. Every number comes from data/economy.json.
 */
import { GameEvents } from '../types';
import type { WaveClearBonus, EarlyStartBonus, ComputeStars, AddGold, GameData } from '../types';

/** base + perWave * N (25 + 5N), paid on every cleared wave including the last. */
export const waveClearBonus: WaveClearBonus = (data, wave) => {
  const b = data.economy.waveClearBonus;
  return b.base + b.perWave * wave;
};

/** floor(maxBonus * remainingMs / buildTimerMs); 0 when untimed (null) or the timer ran out. */
export const earlyStartBonus: EarlyStartBonus = (data, remainingMs) => {
  if (remainingMs === null || !(remainingMs > 0)) return 0;
  const e = data.economy.earlyStart;
  const r = Math.min(remainingMs, e.buildTimerMs);
  return Math.floor((e.maxBonus * r) / e.buildTimerMs);
};

/** Lost: 0. No core damage: 3. coreHp >= 50% of start: 2. Any other win: 1. */
export const computeStars: ComputeStars = (data, won, coreHp) => {
  if (!won) return 0;
  const s = data.economy.stars;
  const start = data.economy.startCoreHp;
  if (s.threeStarRequiresNoCoreDamage && coreHp === start) return 3;
  if (coreHp >= s.twoStarMinHpPct * start) return 2;
  return s.oneStarOnClear ? 1 : 0;
};

/** The ONLY way any system changes gold. delta may be negative. */
export const addGold: AddGold = (state, ctx, delta, reason) => {
  state.gold += delta;
  ctx.events.emit(GameEvents.GoldChanged, { gold: state.gold, delta, reason });
};

/** true when the build phase of `wave` has the auto-start countdown (waves 2+, wave 1 only if firstWaveTimed). */
export function isBuildTimed(data: GameData, wave: number): boolean {
  return wave >= 2 || data.economy.earlyStart.firstWaveTimed;
}

/** Initial buildTimerMs for the build phase of `wave` (null = untimed). */
export function buildTimerFor(data: GameData, wave: number): number | null {
  return isBuildTimed(data, wave) ? data.economy.earlyStart.buildTimerMs : null;
}
