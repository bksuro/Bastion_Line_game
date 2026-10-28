/**
 * src/waves entry module (SPEC.md section 2.1). Owner: agent 5 (Waves, Economy & Agents).
 * Other folders import only from this file.
 */
import type { ThreatBudget, MinThreat, UnlockedEnemies, ValidateWavePlan, StepSystem, IsWaveClear } from '../types';
import * as budget from './budget';
import * as validate from './validate';
import * as spawner from './spawner';

export const threatBudget: ThreatBudget = budget.threatBudget;
export const minThreat: MinThreat = budget.minThreat;
export const unlockedEnemies: UnlockedEnemies = budget.unlockedEnemies;
export const validateWavePlan: ValidateWavePlan = validate.validateWavePlan;
export const stepSpawner: StepSystem = spawner.stepSpawner;
export const isWaveClear: IsWaveClear = spawner.isWaveClear;

/* Extras for agent 5's own folders and QA. */
export { isUnlocked, bossWavesOf } from './budget';
export { wordCount, WAVE_RULES } from './validate';
export { createSpawnState } from './spawner';
