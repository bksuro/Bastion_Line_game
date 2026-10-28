/** SPEC.md section 5 fallbacks: agent inputs and the stock narration/debrief length rules. */
import { describe, expect, it } from 'vitest';
import { GamePhase } from '../src/types';
import { buildDebriefInput, buildHintInput, buildWaveDirectorInput, fallbackDebrief, fallbackNarration, validateNarration } from '../src/agents';
import { BEND1, loadData, makeRunSave, newGame, playCombat } from './helpers';

const data = loadData();

describe('fallback narration', () => {
  it('meets the Narrator rules (intro <= 100, 20 captions <= 70, taunts for 10 and 20)', async () => {
    const { game } = await newGame();
    const n = game.state.narration!;
    expect(validateNarration(n)).toEqual([]);
    expect(n.intro.length).toBeLessThanOrEqual(100);
    expect(n.captions.map((c) => c.wave)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const c of n.captions) expect(c.text.length).toBeLessThanOrEqual(70);
    for (const w of ['10', '20'] as const) {
      for (const k of ['Arrow', 'Frost', 'Cannon', 'Sniper', 'mixed'] as const) expect(n.bossTaunts[w][k].length).toBeGreaterThan(0);
    }
    expect(validateNarration(fallbackNarration({ id: 'easy', name: 'x', difficulty: 'Easy', setting: 'y', boss_names: { '10': 'a', '20': 'b' }, player_stars_on_this_map: 3, attempt_number: 9 }))).toEqual([]);
    game.destroy();
  });
});

describe('agent inputs', () => {
  it('Wave Director input lists the Boss only on its waves and carries the budget', async () => {
    const { game } = await newGame({ resume: makeRunSave(data, 10) });
    const i10 = buildWaveDirectorInput(game.state, game.ctx, 10);
    expect(i10.unlocked_enemies).toContain('Boss');
    expect(i10.threat_budget).toBe(28);
    expect(buildWaveDirectorInput(game.state, game.ctx, 11).unlocked_enemies).not.toContain('Boss');
    game.destroy();
  });

  it('hint input marks every leak as core_approach and hints_left_after_this = hintsLeft - 1', async () => {
    const { game } = await newGame();
    game.commands.startWave(); // no towers: every Grunt leaks
    playCombat(game);
    expect(game.state.phase).toBe(GamePhase.Build);
    const input = buildHintInput(game.state, game.ctx);
    expect(input.last_wave_leaks.length).toBeGreaterThan(0);
    expect(input.last_wave_leaks.every((l) => l.leakedAt === 'core_approach')).toBe(true);
    expect(input.hints_left_after_this).toBe(game.state.hintsLeft - 1);
    expect(input.buildable_tiles.length).toBeLessThanOrEqual(15);
    expect(input.next_wave.groups.map((g) => g.enemy)).toEqual(data.waves.waves[1].groups.map((g) => g.enemy));
    game.destroy();
  });

  it('debrief fallback respects the Match Analyst limits', async () => {
    const { game } = await newGame();
    game.commands.placeTower('Arrow', BEND1[0]);
    game.commands.startWave();
    playCombat(game);
    const d = fallbackDebrief(buildDebriefInput(game.state, game.ctx));
    expect(d.headline.length).toBeLessThanOrEqual(60);
    expect(d.held.length).toBeGreaterThanOrEqual(1);
    expect(d.held.length).toBeLessThanOrEqual(2);
    for (const h of d.held) expect(h.length).toBeLessThanOrEqual(100);
    expect(d.damage.length).toBeLessThanOrEqual(3);
    expect(d.tryNext.length).toBeLessThanOrEqual(140);
    game.destroy();
  });
});
