#!/usr/bin/env node
/**
 * Bastion Line - headless balance sim (Spec Writer, phase 1).
 *
 * Run:   node tools/balance-sim.mjs            (summary tables)
 *        node tools/balance-sim.mjs --verbose  (adds a per-wave trace for every build)
 *        node tools/balance-sim.mjs --late-start (player never presses Space: no early bonus)
 *        node tools/balance-sim.mjs --data <dir> (tuning experiments against a copy of data/)
 *
 * Plain Node (no deps, no TypeScript). It reads data/*.json directly; every stat, cost, gold
 * value, HP growth, clear bonus and early-start rule comes from those files. The only things
 * defined here are (a) the reference map layout from SPEC.md section 2 and (b) the 4 scripted
 * player builds. It follows the simulation rules of SPEC.md section 4 (fixed 1000/60 ms steps,
 * per-step order spawner -> enemies -> towers -> projectiles -> cleanup, homing projectiles,
 * splash, Frost slow, Euclidean range on the real 2D path geometry). Enemies move along a 1D
 * path distance that is mapped onto the reference polyline.
 *
 * Player model: at the start of each build phase the build script buys in list order while the
 * next item is affordable (it stops at the first unaffordable item, so order is respected), then
 * presses Space immediately. The early bonus is therefore
 * floor(maxBonus * (buildTimerMs - REACTION_MS) / buildTimerMs) on timed waves.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const argData = process.argv.indexOf('--data');
const DATA_DIR = argData > 0 ? resolve(process.argv[argData + 1]) : resolve(here, '..', 'data');
const load = (f) => JSON.parse(readFileSync(resolve(DATA_DIR, f), 'utf8'));
const TOWERS = load('towers.json');
const ENEMIES = load('enemies.json');
const ECON = load('economy.json');
const WAVES = load('waves.easy.json');

const VERBOSE = process.argv.includes('--verbose');
const DT = 1000 / 60;
// Time the player waits before pressing Space. --late-start = never press it (auto-start, no bonus).
const REACTION_MS = process.argv.includes('--late-start') ? ECON.earlyStart.buildTimerMs : 0;
const WAVE_TIMEOUT_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Reference map (SPEC.md section 2). Waypoints are tile-centre coords. */
/* ------------------------------------------------------------------ */
const COLS = ECON.grid.cols;
const ROWS = ECON.grid.rows;
const WAYPOINTS = [
  { x: -0.5, y: 1.5 }, // spawn, just off the left edge, row 1
  { x: 18.5, y: 1.5 }, // bend 1 (tile 18,1)
  { x: 18.5, y: 10.5 }, // bend 2 (tile 18,10)
  { x: 1.5, y: 10.5 }, // core (tile 1,10)
];
const CORE = { x: 1, y: 10 };
const seg = [];
let PATH_LEN = 0;
for (let i = 1; i < WAYPOINTS.length; i++) {
  const a = WAYPOINTS[i - 1], b = WAYPOINTS[i];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  seg.push({ a, b, start: PATH_LEN, len });
  PATH_LEN += len;
}
const BEND_DIST = [seg[1].start, seg[2].start];
if (Math.abs(PATH_LEN - ECON.simPathLengthTiles) > 1e-6) {
  throw new Error(`Reference waypoints give a ${PATH_LEN}-tile path but economy.simPathLengthTiles is ${ECON.simPathLengthTiles}`);
}
function posAt(d) {
  const dd = Math.max(0, Math.min(PATH_LEN, d));
  for (const s of seg) {
    if (dd <= s.start + s.len) {
      const t = (dd - s.start) / s.len;
      return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t };
    }
  }
  return { ...WAYPOINTS[WAYPOINTS.length - 1] };
}
// Path tiles: every tile the polyline passes through (on grid), plus the core.
const pathTiles = new Set();
for (let d = 0; d <= PATH_LEN; d += 0.05) {
  const p = posAt(d);
  const tx = Math.floor(p.x), ty = Math.floor(p.y);
  if (tx >= 0 && tx < COLS && ty >= 0 && ty < ROWS) pathTiles.add(`${tx},${ty}`);
}
pathTiles.add(`${CORE.x},${CORE.y}`);
const buildable = [];
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (!pathTiles.has(`${x},${y}`)) buildable.push({ x, y });
/** Path length (tiles) within range r of a tile centre. */
const coverageCache = new Map();
function coverage(tile, r) {
  const k = `${tile.x},${tile.y},${r}`;
  if (coverageCache.has(k)) return coverageCache.get(k);
  let c = 0;
  const step = 0.05;
  for (let d = 0; d <= PATH_LEN; d += step) {
    const p = posAt(d);
    if (Math.hypot(p.x - (tile.x + 0.5), p.y - (tile.y + 0.5)) <= r) c += step;
  }
  coverageCache.set(k, c);
  return c;
}

/* ------------------------------------------------------------------ */
/* Data-derived helpers (same formulas as the game)                    */
/* ------------------------------------------------------------------ */
function towerStats(type, level) {
  const d = TOWERS.towers[type], m = d.levelMultipliers, i = level - 1;
  return {
    damage: d.damage * m.damage[i],
    range: d.range * m.range[i],
    fireRateMs: d.fireRateMs * m.fireRate[i],
    canHitAir: d.canHitAir,
    splashRadius: d.splashRadius,
    slowPct: d.slowPct,
    slowMs: d.slowMs * m.slowDuration[i],
    projectileSpeed: d.projectileSpeed,
  };
}
const enemyHp = (type, wave) => Math.round(ENEMIES.enemies[type].hp * ECON.enemyHpMultiplierPerWave ** (wave - 1));
const clearBonus = (n) => ECON.waveClearBonus.base + ECON.waveClearBonus.perWave * n;
function earlyBonus(wave) {
  const timed = wave >= 2 || ECON.earlyStart.firstWaveTimed;
  if (!timed) return 0;
  const remaining = Math.max(0, ECON.earlyStart.buildTimerMs - REACTION_MS);
  return Math.floor((ECON.earlyStart.maxBonus * remaining) / ECON.earlyStart.buildTimerMs);
}
function stars(won, hp) {
  if (!won) return 0;
  if (ECON.stars.threeStarRequiresNoCoreDamage && hp === ECON.startCoreHp) return 3;
  if (hp >= ECON.stars.twoStarMinHpPct * ECON.startCoreHp) return 2;
  return ECON.stars.oneStarOnClear ? 1 : 0;
}
const budget = (n) => Math.floor(ECON.threat.wave1Budget * ECON.threat.budgetGrowth ** (n - 1) + 0.5);

/* ------------------------------------------------------------------ */
/* Builds                                                              */
/* ------------------------------------------------------------------ */
// ['P', type, slot|'auto', targeting?]  place;  ['U', n]  upgrade the n-th placed tower (1-based)
const P = (type, slot = 'auto', mode = 'First') => ['P', type, slot, mode];
const U = (...ns) => ns.map((n) => ['U', n]);

/** Filler used once a build's list is exhausted: returns the next action or null. */
const upgradeLowest = (types) => (st) => {
  const c = st.towers.filter((t) => types.includes(t.type) && t.level < TOWERS.maxLevel);
  if (!c.length) return null;
  c.sort((a, b) => a.level - b.level || a.n - b.n);
  return ['U', c[0].n];
};
const cycle = (actions) => {
  let i = 0;
  return () => actions[i++ % actions.length];
};

const BUILDS = {
  Sensible: {
    note: '4 Arrows, Frost and Cannon at the bends by w4, Sniper by w6, upgrades, 2nd Cannon and Sniper, a 3rd Sniper for the late Flyer waves, then upgrade everything (air first)',
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
    filler: (st) => upgradeLowest(['Arrow', 'Sniper'])(st) ?? upgradeLowest(['Frost', 'Cannon'])(st),
  },
  NoAir: {
    note: '2 Arrows never upgraded, then only Frost and Cannons, all upgraded',
    list: [P('Arrow'), P('Arrow'), P('Cannon'), P('Frost'), P('Cannon'), ...U(3, 5, 4), P('Cannon'), ...U(3, 5, 6, 4), P('Cannon'), P('Frost')],
    filler: (st) => upgradeLowest(['Frost', 'Cannon'])(st) ?? P('Cannon'),
  },
  NoUpgrades: {
    note: 'same tower mix as Sensible, new towers only, spreading to worse tiles',
    list: [],
    filler: cycle([P('Arrow'), P('Arrow'), P('Frost'), P('Cannon'), P('Arrow'), P('Sniper', 'auto', 'Strongest'), P('Cannon'), P('Arrow')]),
  },
  ArrowsOnly: {
    note: '12 Arrows, all upgraded, no splash or slow',
    list: [P('Arrow'), P('Arrow'), P('Arrow'), P('Arrow')],
    filler: (st) => (st.towers.length < 12 && (st.towers.length < 8 || st.towers.length % 2 === 0) ? P('Arrow') : upgradeLowest(['Arrow'])(st) ?? (st.towers.length < 12 ? P('Arrow') : null)),
  },
};

/* ------------------------------------------------------------------ */
/* Simulation                                                          */
/* ------------------------------------------------------------------ */
function bestFreeTile(st, type) {
  const r = towerStats(type, 1).range;
  const used = new Set(st.towers.map((t) => `${t.tile.x},${t.tile.y}`));
  let best = null, bestC = -1;
  for (const t of buildable) {
    if (used.has(`${t.x},${t.y}`)) continue;
    const c = coverage(t, r);
    if (c > bestC + 1e-9) { best = t; bestC = c; }
  }
  return best;
}

function tryAction(st, a) {
  if (a[0] === 'P') {
    const [, type, slot, mode] = a;
    const cost = TOWERS.towers[type].cost;
    if (st.gold < cost) return 'wait';
    const tile = slot === 'auto' ? bestFreeTile(st, type) : slot;
    if (!tile) return 'skip';
    st.gold -= cost;
    st.towers.push({ n: st.towers.length + 1, type, level: 1, tile, mode, spent: cost, cd: 0, kills: 0, dmg: 0 });
    return 'done';
  }
  const t = st.towers.find((x) => x.n === a[1]);
  if (!t || t.level >= TOWERS.maxLevel) return 'skip';
  const cost = TOWERS.towers[t.type].upgradeCosts[t.level - 1];
  if (st.gold < cost) return 'wait';
  st.gold -= cost; t.spent += cost; t.level += 1;
  return 'done';
}

function buyPhase(st, build) {
  for (;;) {
    let a;
    if (st.cursor < build.list.length) a = build.list[st.cursor];
    else { a = build.filler(st); if (!a) return; }
    const r = tryAction(st, a);
    if (r === 'wait') return;
    if (st.cursor < build.list.length) st.cursor++;
    else if (r === 'skip') return; // filler produced something impossible: stop for this phase
  }
}

function selectTarget(t, s, enemies) {
  const cx = t.tile.x + 0.5, cy = t.tile.y + 0.5;
  let best = null;
  for (const e of enemies) {
    if (!e.alive || (e.flying && !s.canHitAir)) continue;
    const dist = Math.hypot(e.pos.x - cx, e.pos.y - cy);
    if (dist > s.range) continue;
    if (!best) { best = { e, dist }; continue; }
    const b = best.e;
    let better;
    if (t.mode === 'Strongest') better = e.hp > b.hp || (e.hp === b.hp && (e.d > b.d || (e.d === b.d && e.id < b.id)));
    else if (t.mode === 'Closest') better = dist < best.dist || (dist === best.dist && (e.d > b.d || (e.d === b.d && e.id < b.id)));
    else better = e.d > b.d || (e.d === b.d && e.id < b.id);
    if (better) best = { e, dist };
  }
  return best ? best.e : null;
}

function applyHit(st, p, e) {
  if (!e.alive) return;
  const dealt = Math.min(e.hp, p.damage);
  e.hp -= p.damage;
  e.dmgTaken += dealt;
  const tw = st.towers.find((x) => x.n === p.tower);
  if (tw) tw.dmg += dealt;
  if (p.slowPct > 0) { e.slowPct = Math.max(e.slowPct, p.slowPct); e.slowMs = Math.max(e.slowMs, p.slowMs); }
  if (e.hp <= 0 && !e.immortal) {
    e.alive = false;
    const g = ENEMIES.enemies[e.type].goldReward;
    st.gold += g; st.earned += g; st.wave_.killGold += g; st.wave_.kills++;
    if (tw) tw.kills++;
    if (e.type === 'Boss') st.wave_.boss = { killedAt: e.d, hp: e.maxHp, dmg: e.dmgTaken };
  }
}

function playWave(st, n, opts) {
  const plan = WAVES.waves[n - 1];
  const groups = plan.groups.map((g) => ({ ...g, spawned: 0 }));
  const enemies = [], projectiles = [];
  let t = 0, nextId = 0;
  st.wave_ = { killGold: 0, kills: 0, leaks: {}, coreDamage: 0, boss: null };
  for (const tw of st.towers) tw.cd = 0;
  const stats = new Map(st.towers.map((tw) => [tw.n, towerStats(tw.type, tw.level)]));
  for (;;) {
    // 1 spawner
    for (const g of groups) {
      while (g.spawned < g.count && g.startDelayMs + g.spawned * g.spawnIntervalMs <= t) {
        const def = ENEMIES.enemies[g.enemy];
        const hp = enemyHp(g.enemy, n);
        const immortal = opts.immortalBoss === n && g.enemy === 'Boss';
        enemies.push({ id: nextId++, type: g.enemy, hp: immortal ? 1e12 : hp, maxHp: hp, speed: def.speed, d: 0, pos: posAt(0), flying: def.flying, radius: def.radius, slowPct: 0, slowMs: 0, alive: true, dmgTaken: 0, immortal });
        g.spawned++;
      }
    }
    // 2 enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      e.d += (e.speed * (1 - e.slowPct / 100) * DT) / 1000;
      e.slowMs -= DT;
      if (e.slowMs <= 0) { e.slowMs = 0; e.slowPct = 0; }
      if (e.d >= PATH_LEN) {
        e.alive = false;
        const dmg = ENEMIES.enemies[e.type].coreDamage;
        st.hp -= dmg; st.wave_.coreDamage += dmg;
        st.wave_.leaks[e.type] = (st.wave_.leaks[e.type] ?? 0) + 1;
        if (e.type === 'Boss') st.wave_.boss = { killedAt: null, hp: e.maxHp, dmg: e.dmgTaken };
        if (st.hp <= 0) { st.hp = 0; return false; }
      } else e.pos = posAt(e.d);
    }
    // 3 towers
    for (const tw of st.towers) {
      const s = stats.get(tw.n);
      tw.cd = Math.max(0, tw.cd - DT);
      if (tw.cd > 0) continue;
      const target = selectTarget(tw, s, enemies);
      if (!target) continue;
      projectiles.push({ tower: tw.n, target, last: { ...target.pos }, pos: { x: tw.tile.x + 0.5, y: tw.tile.y + 0.5 }, damage: s.damage, speed: s.projectileSpeed, splash: s.splashRadius, slowPct: s.slowPct, slowMs: s.slowMs, air: s.canHitAir, done: false });
      tw.cd = s.fireRateMs;
    }
    // 4 projectiles
    for (const p of projectiles) {
      const alive = p.target.alive;
      if (alive) p.last = { ...p.target.pos };
      else if (p.splash === 0) { p.done = true; continue; }
      const dx = p.last.x - p.pos.x, dy = p.last.y - p.pos.y;
      const dist = Math.hypot(dx, dy);
      const travel = (p.speed * DT) / 1000;
      if (dist <= travel + (alive ? p.target.radius : 0)) {
        p.done = true;
        if (p.splash > 0) {
          for (const e of enemies) {
            if (!e.alive || (e.flying && !p.air)) continue;
            if (Math.hypot(e.pos.x - p.last.x, e.pos.y - p.last.y) <= p.splash) applyHit(st, p, e);
          }
        } else applyHit(st, p, p.target);
      } else { p.pos.x += (dx / dist) * travel; p.pos.y += (dy / dist) * travel; }
    }
    // 5 cleanup
    for (let i = enemies.length - 1; i >= 0; i--) if (!enemies[i].alive) enemies.splice(i, 1);
    for (let i = projectiles.length - 1; i >= 0; i--) if (projectiles[i].done) projectiles.splice(i, 1);
    t += DT;
    const allSpawned = groups.every((g) => g.spawned >= g.count);
    if (allSpawned && enemies.length === 0 && projectiles.length === 0) return true;
    if (t > WAVE_TIMEOUT_MS) throw new Error(`wave ${n} timed out`);
  }
}

function runBuild(name, opts = {}) {
  const build = BUILDS[name];
  const st = { gold: ECON.startGold, hp: ECON.startCoreHp, earned: ECON.startGold, towers: [], cursor: 0 };
  const trace = [], checkpoints = {}, bosses = {};
  let lostOn = null;
  for (let n = 1; n <= ECON.waveCount; n++) {
    checkpoints[n] = { earned: st.earned, owned: st.towers.reduce((s, t) => s + t.spent, 0) };
    buyPhase(st, build);
    const bonus = earlyBonus(n);
    st.gold += bonus; st.earned += bonus;
    checkpoints[n].afterBuy = st.towers.map((t) => `${t.type[0]}${t.level}`).join(' ');
    checkpoints[n].ownedAfterBuy = st.towers.reduce((s, t) => s + t.spent, 0);
    const ok = playWave(st, n, opts);
    if (st.wave_.boss) bosses[n] = st.wave_.boss;
    trace.push({ n, hp: st.hp, leaks: st.wave_.leaks, killGold: st.wave_.killGold, gold: st.gold, towers: st.towers.length });
    if (!ok) { lostOn = n; break; }
    const cb = clearBonus(n);
    st.gold += cb; st.earned += cb;
  }
  const won = lostOn === null;
  return { name, won, lostOn, hp: st.hp, stars: stars(won, st.hp), trace, checkpoints, bosses, towers: st.towers, earned: st.earned };
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */
const table = (head, rows) => {
  const out = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  return out.join('\n');
};
const leakStr = (tr) => tr.filter((w) => Object.keys(w.leaks).length).map((w) => `w${w.n}:` + Object.entries(w.leaks).map(([k, v]) => `${v}${k[0]}`).join('')).join(' ') || 'none';

// Sanity: every scripted wave obeys budget / unlock / Boss rules.
const unlockedOn = (type, n) => {
  const d = ENEMIES.enemies[type];
  return d.bossWaves.length ? d.bossWaves.includes(n) : d.unlockWave <= n;
};
const waveProblems = [];
WAVES.waves.forEach((w, i) => {
  const n = i + 1, b = budget(n);
  const total = w.groups.reduce((s, g) => s + g.count * ENEMIES.enemies[g.enemy].threatCost, 0);
  if (w.wave !== n) waveProblems.push(`w${n}: wave field ${w.wave}`);
  if (total !== w.totalThreat) waveProblems.push(`w${n}: totalThreat ${w.totalThreat} != ${total}`);
  if (total > b || total < Math.ceil(ECON.threat.minSpendPct * b)) waveProblems.push(`w${n}: threat ${total} outside [${Math.ceil(ECON.threat.minSpendPct * b)}, ${b}]`);
  for (const g of w.groups) if (!unlockedOn(g.enemy, n)) waveProblems.push(`w${n}: ${g.enemy} not unlocked`);
  const boss = w.groups.filter((g) => g.enemy === 'Boss');
  const needBoss = ENEMIES.enemies.Boss.bossWaves.includes(n);
  if (needBoss && !(boss.length === 1 && boss[0].count === 1)) waveProblems.push(`w${n}: needs exactly one Boss`);
});

console.log(`Bastion Line balance sim  |  HP growth x${ECON.enemyHpMultiplierPerWave}/wave  |  path ${PATH_LEN} tiles (bends at ${BEND_DIST.join(', ')})  |  early bonus ${earlyBonus(2)}/wave on waves 2-${ECON.waveCount}`);
console.log(`Scripted waves: ${waveProblems.length ? 'PROBLEMS: ' + waveProblems.join('; ') : 'all 20 pass budget/unlock/Boss rules'}\n`);

const results = Object.keys(BUILDS).map((n) => runBuild(n));
console.log(table(['Build', 'Result', 'Final HP', 'Wave lost', 'Stars', 'Towers (type+level)', 'Leaks (wave:count+type initial)'],
  results.map((r) => [r.name, r.won ? 'Win' : 'Loss', r.hp, r.lostOn ?? '-', r.stars, r.towers.map((t) => `${t.type[0]}${t.level}`).join(' '), leakStr(r.trace)])));

const S = results.find((r) => r.name === 'Sensible');
console.log('\nSensible build economy (gold earned = start + kill gold + clear bonuses + early bonuses, before that wave\'s build phase)\n');
console.log(table(['Before wave', 'Gold earned to date', 'Value of towers owned', 'Defense after buying (type+level)'],
  [5, 10, 15, 20].filter((n) => S.checkpoints[n]).map((n) => [n, S.checkpoints[n].earned, S.checkpoints[n].ownedAfterBuy, S.checkpoints[n].afterBuy])));
console.log(`\nTotal gold over the match (Sensible): ${S.earned}`);

console.log('\nBoss check (Sensible). "Potential damage" = damage the same defense deals to an unkillable Boss over its whole walk.\n');
const bossRows = [];
for (const n of ENEMIES.enemies.Boss.bossWaves) {
  const b = S.bosses[n];
  if (!b) continue;
  const probe = runBuild('Sensible', { immortalBoss: n }).bosses[n];
  bossRows.push([n, b.hp, b.killedAt === null ? `LEAKED (${Math.round(b.dmg)} dmg dealt)` : `killed at ${b.killedAt.toFixed(1)} / ${PATH_LEN} tiles (${Math.round((100 * b.killedAt) / PATH_LEN)}%)`, Math.round(probe.dmg), `${(probe.dmg / b.hp).toFixed(2)}x`]);
}
console.log(table(['Wave', 'Boss HP', 'Outcome', 'Potential damage', 'Margin'], bossRows));

if (VERBOSE) {
  for (const r of results) {
    console.log(`\n${r.name}: ${BUILDS[r.name].note}`);
    console.log(table(['Wave', 'HP after', 'Kill gold', 'Gold after combat', 'Towers', 'Leaks'],
      r.trace.map((w) => [w.n, w.hp, w.killGold, w.gold, w.towers, Object.entries(w.leaks).map(([k, v]) => `${v} ${k}`).join(', ') || '-'])));
  }
}
