/**
 * Agent 5's quick sanity checks (not the QA suite). Run: npx tsx tests/sanity/match.sanity.ts (moved out of src/ by the Integrator)
 * Plays the scripted waves headless with a simple Sensible-like buyer and checks the agent-5 rules.
 */
import towers from '../../data/towers.json';
import enemies from '../../data/enemies.json';
import economy from '../../data/economy.json';
import waves from '../../data/waves.easy.json';
import easyMap from '../../public/maps/easy.json';
import { FIXED_STEP_MS, GamePhase } from '../../src/types';
import type { GameInstance, TowerType } from '../../src/types';
import { createGame, createGameContext, loadGameData } from '../../src/core';
import { parseTiledMap } from '../../src/map';
import { createFallbackAgentService, buildDebriefInput, buildHintInput, fallbackHint, validateNarration } from '../../src/agents';
import { minThreat, threatBudget, unlockedEnemies, validateWavePlan } from '../../src/waves';
import { computeStars, earlyStartBonus, waveClearBonus } from '../../src/economy';
import { createSaveStore } from '../../src/save';

let failures = 0;
const check = (cond: boolean, msg: string): void => {
  if (!cond) {
    failures += 1;
    console.error(`FAIL ${msg}`);
  }
};

const data = loadGameData({ towers, enemies, economy, waves });
const map = parseTiledMap(easyMap);

// waves
for (const w of data.waves.waves) {
  const p = validateWavePlan(data, w, w.wave);
  check(p.length === 0, `wave ${w.wave} invalid: ${p.join('; ')}`);
}
check(threatBudget(data, 1) === 10 && threatBudget(data, 20) === 86 && minThreat(data, 20) === 69, 'budget table');
check(unlockedEnemies(data, 9).join() === 'Grunt,Runner,Brute,Flyer', 'unlock w9');
check(unlockedEnemies(data, 10).join() === 'Grunt,Runner,Brute,Flyer,Boss', 'unlock w10');
check(!unlockedEnemies(data, 11).includes('Boss') && unlockedEnemies(data, 20).includes('Boss'), 'unlock w11/w20');
// economy
check(waveClearBonus(data, 1) === 30 && waveClearBonus(data, 20) === 125, 'clear bonus');
check(earlyStartBonus(data, null) === 0 && earlyStartBonus(data, 20000) === 5 && earlyStartBonus(data, 3999) === 0 && earlyStartBonus(data, 4000) === 1, 'early bonus');
check(computeStars(data, false, 20) === 0 && computeStars(data, true, 20) === 3 && computeStars(data, true, 10) === 2 && computeStars(data, true, 9) === 1, 'stars');

const BUY: ({ place: TowerType } | { upgrade: TowerType })[] = [
  { place: 'Arrow' }, { place: 'Arrow' }, { place: 'Arrow' }, { place: 'Arrow' }, { place: 'Frost' }, { place: 'Cannon' },
  { place: 'Sniper' }, { upgrade: 'Arrow' }, { upgrade: 'Arrow' }, { upgrade: 'Cannon' }, { upgrade: 'Sniper' },
  { place: 'Cannon' }, { place: 'Sniper' }, { upgrade: 'Arrow' }, { upgrade: 'Arrow' }, { upgrade: 'Cannon' },
  { upgrade: 'Sniper' }, { upgrade: 'Frost' }, { place: 'Sniper' },
];

function bestTile(game: GameInstance, type: TowerType): { x: number; y: number } | null {
  const r = data.towers.towers[type].range;
  let best: { x: number; y: number } | null = null;
  let bestCover = -1;
  for (const t of map.buildableTiles) {
    if (game.state.towers.some((tw) => tw.tile.x === t.x && tw.tile.y === t.y)) continue;
    const cover = map.pathTiles.filter((p) => Math.hypot(p.x - t.x, p.y - t.y) <= r).length;
    if (cover > bestCover) {
      bestCover = cover;
      best = t;
    }
  }
  return best;
}

function buyPhase(game: GameInstance, cursor: { i: number }): void {
  for (;;) {
    const item = BUY[cursor.i % BUY.length];
    let ok = false;
    if ('place' in item) {
      const tile = bestTile(game, item.place);
      ok = !!tile && game.commands.placeTower(item.place, tile).ok;
    } else {
      const cands = game.state.towers.filter((t) => t.type === item.upgrade && t.level < 4).sort((a, b) => a.level - b.level);
      ok = cands.length > 0 && game.commands.upgradeTower(cands[0].id).ok;
      if (cands.length === 0) ok = true; // skip
    }
    if (!ok) return;
    cursor.i += 1;
    if (cursor.i > 400) return;
  }
}

async function main(): Promise<void> {
  const saves = createSaveStore(null);
  const ctx = createGameContext(data, map, createFallbackAgentService(data));
  check(true, '');
  const game = await createGame(ctx, { mapId: 'easy', difficulty: 'Easy', saves, resume: null });
  check(game.state.narration !== null && validateNarration(game.state.narration).length === 0, 'narration valid');
  check(game.state.currentPlan?.wave === 1 && game.state.buildTimerMs === null, 'wave 1 untimed with plan');
  check(game.state.attemptNumber === 1, 'attempt 1');

  const hintRes = await game.commands.requestHint();
  check(hintRes.ok && game.state.hintsLeft === 2 && game.state.activeHint !== null, 'hint used once');
  const hint2 = fallbackHint(data, buildHintInput(game.state, ctx));
  check(hint2.message.split(/\s+/).length <= 20, 'hint <= 20 words');

  const cursor = { i: 0 };
  let saw10Taunt: string | null = null;
  for (let guard = 0; guard < 5_000_000; guard++) {
    const s = game.state;
    if (s.phase === GamePhase.Won || s.phase === GamePhase.Lost) break;
    if (s.phase === GamePhase.Build) {
      buyPhase(game, cursor);
      const g0 = s.gold;
      check(game.commands.startWave().ok, 'startWave');
      if (s.wave >= 2) check(s.gold - g0 === 5, `early bonus wave ${s.wave}`);
      if (s.wave === 10) saw10Taunt = s.activeBossTaunt;
      await Promise.resolve();
      await Promise.resolve();
      continue;
    }
    game.step(FIXED_STEP_MS);
  }
  const s = game.state;
  console.log(`result ${s.phase} wave ${s.wave} coreHp ${s.coreHp} stars ${s.stars} towers ${s.towers.map((t) => t.type[0] + t.level).join(' ')}`);
  console.log('leaks', s.waveHistory.filter((r) => r.coreDamage > 0).map((r) => `w${r.wave}:${JSON.stringify(r.leaks)}`).join(' ') || 'none');
  check(saw10Taunt !== null, 'boss taunt on wave 10');
  check(s.enemies.length === 0 || s.phase === GamePhase.Lost, 'cleanup');
  check(saves.loadRun('easy') === null, 'run deleted at game over');
  check(saves.loadProgress().attempts.easy === 1, 'attempts++');
  const dbIn = buildDebriefInput(s, ctx);
  const db = await ctx.agents.getDebrief(dbIn);
  console.log('debrief', JSON.stringify(db.data));
  check(db.data.headline.length <= 60 && db.data.tryNext.length <= 140, 'debrief lengths');

  // resume: play wave 1 with a store, then restore.
  const saves2 = createSaveStore(null);
  const ctx2 = createGameContext(data, map, createFallbackAgentService(data));
  const g2 = await createGame(ctx2, { mapId: 'easy', difficulty: 'Easy', saves: saves2, resume: null });
  g2.commands.placeTower('Arrow', bestTile(g2, 'Arrow')!);
  g2.commands.placeTower('Arrow', bestTile(g2, 'Arrow')!);
  g2.commands.startWave();
  while (g2.state.phase === GamePhase.Combat) g2.step(FIXED_STEP_MS * 3);
  const run = saves2.loadRun('easy');
  check(run !== null && run.wave === 2 && run.pendingPlan?.wave === 2, 'run saved at payout');
  let calls = 0;
  const counting = createFallbackAgentService(data);
  const spy = { ...counting, planWave: (i: Parameters<typeof counting.planWave>[0]) => { calls++; return counting.planWave(i); }, getNarration: (i: Parameters<typeof counting.getNarration>[0]) => { calls++; return counting.getNarration(i); } };
  const ctx3 = createGameContext(data, map, spy);
  const g3 = await createGame(ctx3, { mapId: 'easy', difficulty: 'Easy', saves: saves2, resume: run });
  check(calls === 0, 'no agent calls on resume');
  check(g3.state.wave === 2 && g3.state.towers.length === 2 && g3.state.nextId === g2.state.nextId && g3.state.buildTimerMs === 20000, 'restored');

  // lost transition
  const ctx4 = createGameContext(data, map, createFallbackAgentService(data));
  const g4 = await createGame(ctx4, { mapId: 'easy', difficulty: 'Easy', saves: null, resume: null });
  g4.state.coreHp = 1;
  g4.commands.startWave();
  let over = 0;
  ctx4.events.on('game:over', () => over++);
  while (g4.state.phase === GamePhase.Combat) g4.step(FIXED_STEP_MS);
  check(g4.state.phase === GamePhase.Lost && g4.state.stars === 0 && over === 1, 'lost transition');

  console.log(failures === 0 ? 'ALL SANITY CHECKS PASSED' : `${failures} FAILURES`);
}

void main();
