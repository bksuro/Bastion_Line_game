/**
 * src/agents entry module (SPEC.md section 2.1). Owner: agent 5 (Waves, Economy & Agents).
 * Other folders import only from this file.
 */
import type { CreateFallbackAgentService, BuildWaveDirectorInput, BuildHintInput, BuildNarrationInput, BuildDebriefInput, SelectBossTaunt } from '../types';
import * as service from './service';
import * as inputs from './inputs';

export const createFallbackAgentService: CreateFallbackAgentService = service.createFallbackAgentService;
export const buildWaveDirectorInput: BuildWaveDirectorInput = inputs.buildWaveDirectorInput;
export const buildHintInput: BuildHintInput = inputs.buildHintInput;
export const buildNarrationInput: BuildNarrationInput = inputs.buildNarrationInput;
export const buildDebriefInput: BuildDebriefInput = inputs.buildDebriefInput;
export const selectBossTaunt: SelectBossTaunt = inputs.selectBossTaunt;

/* Extras: the individual fallbacks (core uses them if an AgentService ever misbehaves; QA may test them). */
export { scriptedWave } from './service';
export { fallbackHint } from './hint';
export { fallbackNarration, validateNarration, NARRATION_LIMITS } from './narration';
export { fallbackDebrief, DEBRIEF_LIMITS } from './debrief';
export { HINT_TILE_LIMIT, DOMINANT_SHARE } from './inputs';
