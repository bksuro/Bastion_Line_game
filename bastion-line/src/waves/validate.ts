/**
 * validateWavePlan: every hard rule of prompts/01-wave-director.md (SPEC.md section 3).
 * Defensive about shape too, because Milestone 2 feeds it raw model output.
 */
import { ENEMY_TYPES } from '../types';
import type { EnemyType, ValidateWavePlan } from '../types';
import { isUnlocked, minThreat, threatBudget } from './budget';

export const WAVE_RULES = {
  minGroups: 1,
  maxGroups: 4,
  minCount: 1,
  maxCount: 30,
  minIntervalMs: 300,
  maxIntervalMs: 3000,
  minDelayMs: 0,
  maxDelayMs: 20000,
  maxPreviewChars: 80,
  maxReasonWords: 25,
} as const;

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export function wordCount(text: string): number {
  const t = text.trim();
  return t.length === 0 ? 0 : t.split(/\s+/).length;
}

export const validateWavePlan: ValidateWavePlan = (data, plan, wave) => {
  const problems: string[] = [];
  if (!plan || typeof plan !== 'object') return ['plan is not an object'];

  if (plan.wave !== wave) problems.push(`wave is ${String(plan.wave)}, expected ${wave}`);

  const groups = Array.isArray(plan.groups) ? plan.groups : null;
  if (!groups) {
    problems.push('groups is not an array');
  } else if (groups.length < WAVE_RULES.minGroups || groups.length > WAVE_RULES.maxGroups) {
    problems.push(`${groups.length} groups, expected ${WAVE_RULES.minGroups}-${WAVE_RULES.maxGroups}`);
  }

  let computed = 0;
  const countByType: Partial<Record<EnemyType, number>> = {};
  const groupsByType: Partial<Record<EnemyType, number>> = {};
  (groups ?? []).forEach((g, i) => {
    const label = `group ${i + 1}`;
    if (!g || typeof g !== 'object') {
      problems.push(`${label} is not an object`);
      return;
    }
    const known = ENEMY_TYPES.includes(g.enemy);
    if (!known) {
      problems.push(`${label}: unknown enemy ${String(g.enemy)}`);
    } else if (!isUnlocked(data.enemies.enemies[g.enemy], wave)) {
      problems.push(`${label}: ${g.enemy} is not unlocked on wave ${wave}`);
    }
    if (!isInt(g.count) || g.count < WAVE_RULES.minCount || g.count > WAVE_RULES.maxCount) {
      problems.push(`${label}: count ${String(g.count)} outside ${WAVE_RULES.minCount}-${WAVE_RULES.maxCount}`);
    }
    if (!isInt(g.spawnIntervalMs) || g.spawnIntervalMs < WAVE_RULES.minIntervalMs || g.spawnIntervalMs > WAVE_RULES.maxIntervalMs) {
      problems.push(`${label}: spawnIntervalMs ${String(g.spawnIntervalMs)} outside ${WAVE_RULES.minIntervalMs}-${WAVE_RULES.maxIntervalMs}`);
    }
    if (!isInt(g.startDelayMs) || g.startDelayMs < WAVE_RULES.minDelayMs || g.startDelayMs > WAVE_RULES.maxDelayMs) {
      problems.push(`${label}: startDelayMs ${String(g.startDelayMs)} outside ${WAVE_RULES.minDelayMs}-${WAVE_RULES.maxDelayMs}`);
    }
    if (known && isInt(g.count)) {
      computed += g.count * data.enemies.enemies[g.enemy].threatCost;
      countByType[g.enemy] = (countByType[g.enemy] ?? 0) + g.count;
      groupsByType[g.enemy] = (groupsByType[g.enemy] ?? 0) + 1;
    }
  });

  // Boss rule: on its boss waves exactly one group with count 1; never elsewhere.
  for (const type of ENEMY_TYPES) {
    const def = data.enemies.enemies[type];
    if (def.bossWaves.length === 0) continue;
    if (def.bossWaves.includes(wave)) {
      if ((groupsByType[type] ?? 0) !== 1 || (countByType[type] ?? 0) !== 1) {
        problems.push(`wave ${wave} must have exactly one ${type} group with count 1`);
      }
    } else if ((countByType[type] ?? 0) > 0) {
      problems.push(`${type} is only allowed on waves ${def.bossWaves.join(', ')}`);
    }
  }

  const budget = threatBudget(data, wave);
  const min = minThreat(data, wave);
  if (plan.totalThreat !== computed) {
    problems.push(`totalThreat is ${String(plan.totalThreat)}, recomputed ${computed}`);
  }
  if (computed > budget) problems.push(`threat ${computed} is over the budget ${budget}`);
  if (computed < min) problems.push(`threat ${computed} is under the minimum ${min}`);

  if (typeof plan.previewText !== 'string' || plan.previewText.trim().length === 0) {
    problems.push('previewText is missing');
  } else if (plan.previewText.length > WAVE_RULES.maxPreviewChars) {
    problems.push(`previewText is ${plan.previewText.length} chars, max ${WAVE_RULES.maxPreviewChars}`);
  }
  if (typeof plan.reason !== 'string') {
    problems.push('reason is missing');
  } else if (wordCount(plan.reason) > WAVE_RULES.maxReasonWords) {
    problems.push(`reason is ${wordCount(plan.reason)} words, max ${WAVE_RULES.maxReasonWords}`);
  }

  return problems;
};
