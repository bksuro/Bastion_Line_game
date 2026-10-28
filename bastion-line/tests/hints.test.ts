/** SPEC.md section 8: a failed AI hint followed by the fallback uses exactly one hint (sections 3 and 5). */
import { describe, expect, it } from 'vitest';
import { GameEvents } from '../src/types';
import type { AgentResponse, AgentService, GameData, HintInput, HintResult } from '../src/types';
import { createFallbackAgentService, fallbackHint } from '../src/agents';
import { loadData, makeRunSave, newGame } from './helpers';

/**
 * A stand-in for the Milestone 2 AI service: the AI attempt (and its one retry) fails, then the
 * service returns the scripted fallback with source 'fallback', as the AgentService contract says.
 */
function failingAiThenFallback(calls: { ai: number }) {
  return (data: GameData): AgentService => {
    const fb = createFallbackAgentService(data);
    return {
      ...fb,
      getHint: async (input: HintInput): Promise<AgentResponse<HintResult>> => {
        for (let attempt = 0; attempt < 2; attempt++) {
          calls.ai += 1;
          await Promise.resolve(); // the AI call "times out"
        }
        return { data: fallbackHint(data, input), source: 'fallback', fallbackReason: 'timeout' };
      },
    };
  };
}

/** A service that breaks the never-reject contract: core must still show the fallback hint. */
function rejectingHintService(data: GameData): AgentService {
  return { ...createFallbackAgentService(data), getHint: () => Promise.reject(new Error('network down')) };
}

/** A service that returns malformed hints (bad action, missing required fields). */
function malformedHintService(bad: unknown) {
  return (data: GameData): AgentService => ({
    ...createFallbackAgentService(data),
    getHint: async (): Promise<AgentResponse<HintResult>> => ({ data: bad as HintResult, source: 'ai' }),
  });
}

describe('hint validation', () => {
  const base = { towerType: null, towerId: null, tile: null, targeting: null, message: 'Do it.' };
  it.each([
    ['unknown action', { ...base, action: 'explode' }],
    ['place without tile', { ...base, action: 'place', towerType: 'Arrow' }],
    ['place without towerType', { ...base, action: 'place', tile: { x: 1, y: 1 } }],
    ['upgrade without towerId', { ...base, action: 'upgrade' }],
    ['sell without towerId', { ...base, action: 'sell' }],
    ['retarget without targeting', { ...base, action: 'retarget', towerId: 't1' }],
    ['missing message', { ...base, action: 'none', message: undefined }],
  ])('%s: core shows the fallback hint instead, using exactly one hint', async (_label, bad) => {
    const { game } = await newGame({ agents: malformedHintService(bad) });
    const sources: string[] = [];
    game.ctx.events.on(GameEvents.HintShown, ({ source }) => sources.push(source));
    expect(await game.commands.requestHint()).toEqual({ ok: true });
    expect(sources).toEqual(['fallback']);
    expect(game.state.hintsLeft).toBe(2);
    expect(game.state.activeHint?.action).not.toBe('explode');
    game.destroy();
  });

  it('a well-formed AI hint is shown as-is', async () => {
    const good: HintResult = { ...base, action: 'place', towerType: 'Frost', tile: { x: 2, y: 3 }, message: 'Build Frost.' };
    const { game } = await newGame({ agents: malformedHintService(good) });
    const sources: string[] = [];
    game.ctx.events.on(GameEvents.HintShown, ({ source }) => sources.push(source));
    expect(await game.commands.requestHint()).toEqual({ ok: true });
    expect(sources).toEqual(['ai']);
    expect(game.state.activeHint).toEqual(good);
    game.destroy();
  });
});

describe('hint consumption', () => {
  it('failed AI attempt + fallback: exactly one hint used, one hint:shown, source fallback', async () => {
    const calls = { ai: 0 };
    const { game } = await newGame({ agents: failingAiThenFallback(calls) });
    const shown: { source: string; hintsLeft: number }[] = [];
    game.ctx.events.on(GameEvents.HintShown, ({ source, hintsLeft }) => shown.push({ source, hintsLeft }));
    const before = game.state.hintsLeft;
    expect(before).toBe(3);
    expect(await game.commands.requestHint()).toEqual({ ok: true });
    expect(calls.ai).toBe(2);
    expect(game.state.hintsLeft).toBe(before - 1);
    expect(shown).toEqual([{ source: 'fallback', hintsLeft: before - 1 }]);
    expect(game.state.activeHint).not.toBeNull();
    expect(game.state.hintsUsed).toHaveLength(1);
    game.destroy();
  });

  it('a rejecting service still shows the fallback and uses exactly one hint', async () => {
    const { game } = await newGame({ agents: rejectingHintService });
    let shown = 0;
    game.ctx.events.on(GameEvents.HintShown, () => (shown += 1));
    expect(await game.commands.requestHint()).toEqual({ ok: true });
    expect(game.state.hintsLeft).toBe(2);
    expect(shown).toBe(1);
    expect(game.state.activeHint?.message.length).toBeGreaterThan(0);
    game.destroy();
  });

  it('hintsLeft is not touched while the hint is in flight (only when shown)', async () => {
    const { game } = await newGame({ agents: failingAiThenFallback({ ai: 0 }) });
    const p = game.commands.requestHint();
    expect(game.state.hintsLeft).toBe(3);
    await p;
    expect(game.state.hintsLeft).toBe(2);
    game.destroy();
  });

  it('three hints per map, then no_hints_left; double presses never overspend', async () => {
    const { game } = await newGame();
    const results = await Promise.all([game.commands.requestHint(), game.commands.requestHint(), game.commands.requestHint(), game.commands.requestHint()]);
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results[3]).toEqual({ ok: false, reason: 'no_hints_left' });
    expect(game.state.hintsLeft).toBe(0);
    expect(await game.commands.requestHint()).toEqual({ ok: false, reason: 'no_hints_left' });
    game.destroy();
  });

  it('hints are Build-only', async () => {
    const { game } = await newGame();
    game.commands.startWave();
    expect(await game.commands.requestHint()).toEqual({ ok: false, reason: 'wrong_phase' });
    expect(game.state.hintsLeft).toBe(3);
    game.destroy();
  });

  it('fallback rule 1: Flyers next and no air tower -> place a Sniper near bend_2', async () => {
    const data = loadData();
    const { game } = await newGame({ resume: makeRunSave(data, 7, { gold: 200 }) });
    await game.commands.requestHint();
    const h = game.state.activeHint!;
    expect(h.action).toBe('place');
    expect(h.towerType).toBe('Sniper');
    expect(h.tile).not.toBeNull();
    expect(h.message.split(/\s+/).length).toBeLessThanOrEqual(20);
    game.destroy();
  });
});
