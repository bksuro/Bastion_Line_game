/**
 * FallbackAgentService: the prototype's only AgentService. Every method resolves (never rejects)
 * with source 'fallback'. Milestone 2 puts an AI service behind the same interface and reuses these
 * functions as its fallbacks.
 */
import type { AgentResponse, AgentService, CreateFallbackAgentService, GameData, WavePlan } from '../types';
import { fallbackHint } from './hint';
import { fallbackNarration } from './narration';
import { fallbackDebrief } from './debrief';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The scripted wave from data/waves.<map>.json (a copy, so callers may not mutate the data). */
export function scriptedWave(data: GameData, wave: number): WavePlan {
  const list = data.waves.waves;
  const found = list.find((w) => w.wave === wave) ?? list[Math.min(Math.max(wave, 1), list.length) - 1];
  return clone(found);
}

const ok = <T>(data: T): AgentResponse<T> => ({ data, source: 'fallback' });

export const createFallbackAgentService: CreateFallbackAgentService = (data) => {
  const service: AgentService = {
    planWave: async (input) => ok(scriptedWave(data, input.wave)),
    getHint: async (input) => ok(fallbackHint(data, input)),
    getNarration: async (input) => ok(fallbackNarration(input)),
    getDebrief: async (input) => ok(fallbackDebrief(input)),
  };
  return service;
};
