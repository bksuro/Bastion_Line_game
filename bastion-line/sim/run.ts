/**
 * Headless balance sim (`npm run sim`). QA & Balance (agent 8), SPEC.md section 8.
 *
 * Drives the REAL createGame (fallback agents, no persistence, the real public/maps/easy.json) with the
 * four scripted builds of tools/balance-sim.mjs (Sensible, NoAir, NoUpgrades, ArrowsOnly). The player
 * model is copied from that file: at the start of each build phase the script buys in list order while
 * the next item is affordable (it stops at the first unaffordable item), each new tower goes on the free
 * buildable tile with the most path in range (row-major scan, strictly better wins, path sampled every
 * 0.05 tiles), then Space is pressed at once. Prints a table and compares it with SPEC.md section 8.
 *
 *   npm run sim                 summary + comparison with the SPEC table
 *   npm run sim -- --verbose    plus a per-wave trace for every build
 *   npm run sim -- --late-start the player never presses Space (the build timer auto-starts the wave)
 */
import towers from '../data/towers.json';
import enemies from '../data/enemies.json';
import economy from '../data/economy.json';
import waves from '../data/waves.easy.json';
import easyMap from '../public/maps/easy.json';
import { FIXED_STEP_MS, GamePhase } from '../src/types';
import type { GameData, GameInstance, GameState, MapQueries, TargetingMode, TileCoord, TowerInstance, TowerType } from '../src/types';
import { createGame, createGameContext, loadGameData } from '../src/core';
import { parseTiledMap } from '../src/map';
import { createFallbackAgentService } from '../src/agents';
import { getTowerStats } from '../src/towers';

const VERBOSE = process.argv.includes('--verbose');
const LATE_START = process.argv.includes('--late-start');
/** Hard stop per wave: 15 minutes of game time (the balance sim's WAVE_TIMEOUT_MS). */
const MAX_STEPS_PER_WAVE = 15 * 60 * 60;

/* ------------------------------------------------------------------ */
/* Builds (copied from tools/balance-sim.mjs)                          */
/* ------------------------------------------------------------------ */

type Action = { kind: 'P'; type: TowerType; mode: TargetingMode } | { kind: 'U'; n: number };
interface Build {
  list: Action[];
  filler: (state: GameState) => Action | null;
}

const P = (type: TowerType, mode: TargetingMode = 'First'): Action => ({ kind: 'P', type, mode });
const U = (...ns: number[]): Action[] => ns.map((n) => ({ kind: 'U', n }));

/** n = 1-based placement order; the builds never sell, so it is the index in state.towers + 1. */
const towerN = (state: GameState, t: TowerInstance): number => state.towers.indexOf(t) + 1;

const upgradeLowest = (data: GameData, types: TowerType[]) => (state: GameState): Action | null => {
  const c = state.towers.filter((t) => types.includes(t.type) && t.level < data.towers.maxLevel);
  if (!c.length) return null;
  c.sort((a, b) => a.level - b.level || towerN(state, a) - towerN(state, b));
  return { kind: 'U', n: towerN(state, c[0]) };
};

const cycle = (actions: Action[]) => {
  let i = 0;
  return (): Action => actions[i++ % actions.length];
};

function makeBuilds(data: GameData): Record<string, Build> {
  return {
    Sensible: {
      list: [
        P('Arrow'), P('Arrow'), P('Arrow'), P('Arrow'),
        P('Frost'), P('Cannon'),
        ...U(1, 2),
        P('Sniper'),
        ...U(6, 3, 4, 5),
        P('Cannon'),
        ...U(7, 1, 2, 6),
        P('Sniper'),
        ...U(7, 9, 8, 6, 3, 4),
        P('Sniper'), P('Arrow'),
        ...U(1, 2, 9, 10, 7, 10, 11, 9, 10),
      ],
      filler: (st) => upgradeLowest(data, ['Arrow', 'Sniper'])(st) ?? upgradeLowest(data, ['Frost', 'Cannon'])(st),
    },
    NoAir: {
      list: [P('Arrow'), P('Arrow'), P('Cannon'), P('Frost'), P('Cannon'), ...U(3, 5, 4), P('Cannon'), ...U(3, 5, 6, 4), P('Cannon'), P('Frost')],
      filler: (st) => upgradeLowest(data, ['Frost', 'Cannon'])(st) ?? P('Cannon'),
    },
    NoUpgrades: {
      list: [],
      filler: cycle([P('Arrow'), P('Arrow'), P('Frost'), P('Cannon'), P('Arrow'), P('Sniper', 'Strongest'), P('Cannon'), P('Arrow')]),
    },
    ArrowsOnly: {
      list: [P('Arrow'), P('Arrow'), P('Arrow'), P('Arrow')],
      filler: (st) =>
        st.towers.length < 12 && (st.towers.length < 8 || st.towers.length % 2 === 0)
          ? P('Arrow')
          : upgradeLowest(data, ['Arrow'])(st) ?? (st.towers.length < 12 ? P('Arrow') : null),
    },
  };
}

/** SPEC.md section 8 table (HP growth x1.10). */
const EXPECTED: Record<string, { won: boolean; hp: number; lostOn: number | null; stars: number }> = {
  Sensible: { won: true, hp: 19, lostOn: null, stars: 2 },
  NoAir: { won: false, hp: 0, lostOn: 11, stars: 0 },
  NoUpgrades: { won: false, hp: 0, lostOn: 20, stars: 0 },
  ArrowsOnly: { won: false, hp: 0, lostOn: 19, stars: 0 },
};
/** --late-start numbers quoted under the SPEC.md section 8 table. */
const EXPECTED_LATE: Record<string, { won: boolean; hp: number; lostOn: number | null; stars: number }> = {
  Sensible: { won: true, hp: 19, lostOn: null, stars: 2 },
  NoAir: { won: false, hp: 0, lostOn: 11, stars: 0 },
  NoUpgrades: { won: true, hp: 9, lostOn: null, stars: 1 },
  ArrowsOnly: { won: false, hp: 0, lostOn: 19, stars: 0 },
};
const HP_TOLERANCE = 3;

/* ------------------------------------------------------------------ */
/* Tile choice (balance-sim bestFreeTile, on the real map)             */
/* ------------------------------------------------------------------ */

function makeTilePicker(data: GameData, cols: number, rows: number, pathLength: number, q: MapQueries) {
  const cache = new Map<string, number>();
  const coverage = (tile: TileCoord, r: number): number => {
    const k = `${tile.x},${tile.y},${r}`;
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    let c = 0;
    const step = 0.05;
    for (let d = 0; d <= pathLength; d += step) {
      const p = q.positionAt(d).pos;
      if (Math.hypot(p.x - (tile.x + 0.5), p.y - (tile.y + 0.5)) <= r) c += step;
    }
    cache.set(k, c);
    return c;
  };
  return (state: GameState, type: TowerType): TileCoord | null => {
    const r = getTowerStats(data, type, 1).range;
    const used = new Set(state.towers.map((t) => `${t.tile.x},${t.tile.y}`));
    let best: TileCoord | null = null;
    let bestC = -1;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const t = { x, y };
        if (!q.isBuildable(t) || used.has(`${x},${y}`)) continue;
        const c = coverage(t, r);
        if (c > bestC + 1e-9) {
          best = t;
          bestC = c;
        }
      }
    }
    return best;
  };
}

/* ------------------------------------------------------------------ */
/* Driving the real game                                               */
/* ------------------------------------------------------------------ */

type Outcome = 'done' | 'wait' | 'skip';

function tryAction(game: GameInstance, data: GameData, pick: (s: GameState, t: TowerType) => TileCoord | null, a: Action): Outcome {
  const { state, commands } = game;
  if (a.kind === 'P') {
    if (state.gold < data.towers.towers[a.type].cost) return 'wait';
    const tile = pick(state, a.type);
    if (!tile) return 'skip';
    const res = commands.placeTower(a.type, tile);
    if (!res.ok) throw new Error(`placeTower ${a.type} at ${tile.x},${tile.y} failed: ${res.reason}`);
    if (a.mode !== 'First') {
      const placed = state.towers[state.towers.length - 1];
      const r2 = commands.setTargeting(placed.id, a.mode);
      if (!r2.ok) throw new Error(`setTargeting failed: ${r2.reason}`);
    }
    return 'done';
  }
  const t = state.towers[a.n - 1];
  if (!t || t.level >= data.towers.maxLevel) return 'skip';
  const cost = data.towers.towers[t.type].upgradeCosts[t.level - 1];
  if (state.gold < cost) return 'wait';
  const res = commands.upgradeTower(t.id);
  if (!res.ok) throw new Error(`upgradeTower ${t.id} failed: ${res.reason}`);
  return 'done';
}

interface WaveTrace {
  wave: number;
  hp: number;
  leaks: string;
  goldDelta: number;
  gold: number;
  towers: number;
}
interface RunResult {
  name: string;
  won: boolean;
  hp: number;
  lostOn: number | null;
  stars: number;
  towers: string;
  leaks: string;
  trace: WaveTrace[];
}

const phaseOf = (state: GameState): GamePhase => state.phase;
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function runBuild(name: string, data: GameData): Promise<RunResult> {
  const map = parseTiledMap(easyMap);
  const ctx = createGameContext(data, map, createFallbackAgentService(data));
  const game = await createGame(ctx, { mapId: 'easy', difficulty: map.difficulty, saves: null, resume: null });
  const { state, commands } = game;
  const build = makeBuilds(data)[name];
  const pick = makeTilePicker(data, map.cols, map.rows, map.pathLength, ctx.mapQueries);
  const trace: WaveTrace[] = [];
  let cursor = 0;

  while (phaseOf(state) === GamePhase.Build) {
    // Buy phase (balance-sim buyPhase).
    for (;;) {
      let a: Action | null;
      if (cursor < build.list.length) a = build.list[cursor];
      else {
        a = build.filler(state);
        if (!a) break;
      }
      const r = tryAction(game, data, pick, a);
      if (r === 'wait') break;
      if (cursor < build.list.length) cursor += 1;
      else if (r === 'skip') break;
    }

    const wave = state.wave;
    if (LATE_START && state.buildTimerMs !== null) {
      while (phaseOf(state) === GamePhase.Build) game.step(FIXED_STEP_MS);
    } else {
      const res = commands.startWave();
      if (!res.ok) throw new Error(`startWave failed on wave ${wave}: ${res.reason}`);
    }
    await tick(); // let the fire-and-forget planWave for the next wave resolve, as in the browser

    let steps = 0;
    while (phaseOf(state) === GamePhase.Combat && steps < MAX_STEPS_PER_WAVE) {
      game.step(FIXED_STEP_MS);
      steps += 1;
    }
    if (phaseOf(state) === GamePhase.Combat) throw new Error(`${name}: wave ${wave} did not finish in ${MAX_STEPS_PER_WAVE} steps`);
    const rec = state.waveHistory[state.waveHistory.length - 1];
    const leaks = rec && rec.wave === wave ? Object.entries(rec.leaks).map(([k, v]) => `${v} ${k}`).join(', ') : '';
    trace.push({
      wave,
      hp: state.coreHp,
      leaks,
      goldDelta: rec?.wave === wave ? rec.goldEnd - rec.goldStart : 0,
      gold: state.gold,
      towers: state.towers.length,
    });
  }

  const won = state.phase === GamePhase.Won;
  const result: RunResult = {
    name,
    won,
    hp: state.coreHp,
    lostOn: won ? null : state.wave,
    stars: state.stars ?? 0,
    towers: state.towers.map((t) => `${t.type[0]}${t.level}`).join(' '),
    leaks:
      state.waveHistory
        .filter((w) => Object.keys(w.leaks).length > 0)
        .map((w) => `w${w.wave}:` + Object.entries(w.leaks).map(([k, v]) => `${v}${k[0]}`).join(''))
        .join(' ') || 'none',
    trace,
  };
  game.destroy();
  return result;
}

const table = (head: string[], rows: (string | number)[][]): string =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');

async function main(): Promise<void> {
  const data = loadGameData({ towers, enemies, economy, waves });
  const expected = LATE_START ? EXPECTED_LATE : EXPECTED;
  console.log(`Bastion Line QA sim (real createGame)  |  HP growth x${data.economy.enemyHpMultiplierPerWave}/wave  |  ${LATE_START ? 'late start (no early bonus)' : 'Space pressed at once'}\n`);

  const results: RunResult[] = [];
  for (const name of Object.keys(EXPECTED)) results.push(await runBuild(name, data));

  let mismatches = 0;
  const rows = results.map((r) => {
    const e = expected[r.name];
    const ok = r.won === e.won && Math.abs(r.hp - e.hp) <= HP_TOLERANCE;
    if (!ok) mismatches += 1;
    const exp = `${e.won ? 'Win' : 'Loss'} ${e.hp} HP${e.lostOn ? ` w${e.lostOn}` : ''}`;
    return [r.name, r.won ? 'Win' : 'Loss', r.hp, r.lostOn ?? '-', r.stars, exp, ok ? 'match' : 'MISMATCH', r.towers, r.leaks];
  });
  console.log(table(['Build', 'Result', 'Final HP', 'Wave lost', 'Stars', 'SPEC 8', 'Check', 'Towers (type+level)', 'Leaks'], rows));

  if (VERBOSE) {
    for (const r of results) {
      console.log(`\n${r.name}`);
      console.log(table(['Wave', 'HP after', 'Gold delta', 'Gold after', 'Towers', 'Leaks'], r.trace.map((w) => [w.wave, w.hp, w.goldDelta, w.gold, w.towers, w.leaks || '-'])));
    }
  }

  console.log(`\n${mismatches === 0 ? 'All 4 builds match SPEC.md section 8 (same result, within 3 HP).' : `${mismatches} build(s) differ from SPEC.md section 8.`}`);
  if (mismatches > 0) process.exitCode = 1;
}

void main();
