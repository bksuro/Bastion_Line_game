/**
 * Spawner and wave-clear check (SPEC.md section 4).
 * Enemy i of a group spawns at startDelayMs + i * spawnIntervalMs of wave time. As in
 * tools/balance-sim.mjs, the due check uses the wave time at the start of the step, then the
 * step advances the clock.
 */
import type { IsWaveClear, SpawnState, StepSystem, WavePlan } from '../types';
import { spawnEnemy } from '../enemies';

/** Fresh spawn cursor for a plan (core calls this at wave start). */
export function createSpawnState(plan: WavePlan): SpawnState {
  return {
    waveElapsedMs: 0,
    spawnedPerGroup: plan.groups.map(() => 0),
    totalToSpawn: plan.groups.reduce((sum, g) => sum + g.count, 0),
    totalSpawned: 0,
  };
}

export const stepSpawner: StepSystem = (state, ctx, dtMs) => {
  const spawn = state.spawn;
  const plan = state.currentPlan;
  if (!spawn || !plan) return;
  const t = spawn.waveElapsedMs;
  plan.groups.forEach((g, i) => {
    while (spawn.spawnedPerGroup[i] < g.count && g.startDelayMs + spawn.spawnedPerGroup[i] * g.spawnIntervalMs <= t) {
      spawnEnemy(state, ctx, g.enemy);
      spawn.spawnedPerGroup[i] += 1;
      spawn.totalSpawned += 1;
    }
  });
  spawn.waveElapsedMs = t + dtMs;
};

export const isWaveClear: IsWaveClear = (state) => {
  const spawn = state.spawn;
  if (!spawn) return false;
  if (spawn.totalSpawned < spawn.totalToSpawn) return false;
  return !state.enemies.some((e) => e.alive) && !state.projectiles.some((p) => !p.spent);
};
