/**
 * Integrator smoke test (agent 7): the real game, built headless exactly as GameScene builds it
 * (SPEC.md 2.1 minus the UI line), with fallback agents, an in-memory save store and the real
 * public/maps/easy.json. Plays wave 1 to the payout and checks the match comes back to Build for wave 2.
 * QA (agent 8) owns the full suites; this only proves the pieces fit.
 */
import { describe, expect, it } from 'vitest';
import towers from '../data/towers.json';
import enemies from '../data/enemies.json';
import economy from '../data/economy.json';
import waves from '../data/waves.easy.json';
import easyMap from '../public/maps/easy.json';
import { FIXED_STEP_MS, GameEvents, GamePhase, type GoldChangeReason } from '../src/types';
import { createGame, createGameContext, loadGameData } from '../src/core';
import { parseTiledMap, type MapDefExt } from '../src/map';
import { createFallbackAgentService } from '../src/agents';
import { createSaveStore } from '../src/save';

/** Generous cap: wave 1 (8 Grunts at 1.2 t/s over 45 tiles) clears well inside 2 minutes of game time. */
const MAX_STEPS = 120 * 60;

async function buildGame() {
  const data = loadGameData({ towers, enemies, economy, waves });
  const map = parseTiledMap(easyMap);
  const ctx = createGameContext(data, map, createFallbackAgentService(data));
  const saves = createSaveStore(null);
  const game = await createGame(ctx, { mapId: 'easy', difficulty: map.difficulty, saves, resume: null });
  return { data, map, ctx, saves, game };
}

describe('integration smoke: headless wave 1', () => {
  it('the real easy map matches economy.grid and the balance-sim path length', () => {
    const data = loadGameData({ towers, enemies, economy, waves });
    const map = parseTiledMap(easyMap) as MapDefExt;
    expect(map.cols).toBe(data.economy.grid.cols);
    expect(map.rows).toBe(data.economy.grid.rows);
    expect(map.tileSize).toBe(data.economy.grid.tileSize);
    expect(map.pathLength).toBeCloseTo(data.economy.simPathLengthTiles, 6);
  });

  it('enemy HP growth is the Gate 1 x1.10 read from data', () => {
    expect(economy.enemyHpMultiplierPerWave).toBe(1.1);
  });

  it('starts wave 1, plays it out and returns to Build for wave 2', async () => {
    const { data, game, saves } = await buildGame();
    const { state, commands } = game;

    expect(state.phase).toBe(GamePhase.Build);
    expect(state.wave).toBe(1);
    expect(state.buildTimerMs).toBeNull(); // wave 1 is untimed
    expect(state.currentPlan?.wave).toBe(1);
    expect(state.narration).not.toBeNull();

    const { events } = game.ctx;
    let spawned = 0;
    let killed = 0;
    const goldReasons: GoldChangeReason[] = [];
    const phases: string[] = [];
    events.on(GameEvents.EnemySpawned, () => (spawned += 1));
    events.on(GameEvents.EnemyKilled, () => (killed += 1));
    events.on(GameEvents.GoldChanged, ({ reason }) => goldReasons.push(reason));
    events.on(GameEvents.PhaseChanged, ({ to }) => phases.push(to));

    // Two Arrows inside bend 1 so the wave produces kills as well as the clear bonus.
    expect(commands.placeTower('Arrow', { x: 16, y: 2 })).toEqual({ ok: true });
    expect(commands.placeTower('Arrow', { x: 17, y: 2 })).toEqual({ ok: true });
    const goldAfterBuild = state.gold;
    expect(goldAfterBuild).toBe(data.economy.startGold - 2 * data.towers.towers.Arrow.cost);

    expect(commands.startWave()).toEqual({ ok: true });
    expect(state.phase).toBe(GamePhase.Combat);

    let steps = 0;
    while (state.phase === GamePhase.Combat && steps < MAX_STEPS) {
      game.step(FIXED_STEP_MS);
      steps += 1;
    }

    expect(state.phase).toBe(GamePhase.Build);
    expect(state.wave).toBe(2);

    const planned = data.waves.waves[0].groups.reduce((n, g) => n + g.count, 0);
    expect(spawned).toBe(planned);
    expect(killed).toBeGreaterThan(0);
    expect(goldReasons).toContain('kill');
    expect(goldReasons).toContain('waveClear');
    expect(state.gold).toBeGreaterThan(goldAfterBuild);
    expect(phases).toEqual([GamePhase.Combat, GamePhase.Build]);

    expect(state.enemies).toHaveLength(0);
    expect(state.projectiles).toHaveLength(0);
    expect(state.waveHistory).toHaveLength(1);
    expect(state.buildTimerMs).toBe(data.economy.earlyStart.buildTimerMs);
    expect(state.currentPlan?.wave).toBe(2);

    // The payout autosaved the run, and resuming it lands in Build for wave 2 with the same towers and gold.
    const run = saves.loadRun('easy');
    expect(run?.wave).toBe(2);
    const resumeCtx = createGameContext(data, parseTiledMap(easyMap), createFallbackAgentService(data));
    const resumed = await createGame(resumeCtx, { mapId: 'easy', difficulty: 'Easy', saves, resume: run });
    expect(resumed.state.phase).toBe(GamePhase.Build);
    expect(resumed.state.wave).toBe(2);
    expect(resumed.state.gold).toBe(state.gold);
    expect(resumed.state.towers.map((t) => t.id)).toEqual(state.towers.map((t) => t.id));

    resumed.destroy();
    game.destroy();
  });
});
