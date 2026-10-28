/**
 * createGame: state, the phase state machine, the fixed-step loop and every GameCommand
 * (SPEC.md sections 1.4, 2.3, 4 and 5). Plain TypeScript, runs headless.
 */
import { FIXED_STEP_MS, GameEvents, GamePhase, SAVE_KEYS, TARGETING_MODES, TOWER_TYPES } from '../types';
import type {
  AgentSource,
  CommandFailure,
  CommandResult,
  CreateGame,
  GameCommands,
  GameInstance,
  GameState,
  HintAction,
  HintInput,
  HintResult,
  NarrationInput,
  NarrationResult,
  StarCount,
  TileCoord,
  TowerInstance,
  WaveDirectorInput,
  WavePlan,
  WaveRecord,
  WaveStats,
} from '../types';
import { createSpawnState, isWaveClear, stepSpawner, validateWavePlan } from '../waves';
import { stepEnemies } from '../enemies';
import { stepCombat } from '../combat';
import { canPlace, sellRefund, upgradeCost } from '../towers';
import { addGold, buildTimerFor, computeStars, earlyStartBonus, waveClearBonus } from '../economy';
import {
  buildHintInput,
  buildNarrationInput,
  buildWaveDirectorInput,
  fallbackHint,
  fallbackNarration,
  scriptedWave,
  selectBossTaunt,
  validateNarration,
} from '../agents';
import { restoreRun, serializeRun } from '../save';
import { createInitialState } from './state';

const OK: CommandResult = { ok: true };

const HINT_ACTIONS: readonly HintAction[] = ['place', 'upgrade', 'retarget', 'sell', 'none'];

/** True when a hint has a known action and the fields that action requires (HintResult docs). */
function isValidHint(h: HintResult | null | undefined): h is HintResult {
  if (!h || typeof h !== 'object' || !HINT_ACTIONS.includes(h.action) || typeof h.message !== 'string') return false;
  const hasTile = !!h.tile && Number.isInteger(h.tile.x) && Number.isInteger(h.tile.y);
  switch (h.action) {
    case 'place':
      return TOWER_TYPES.includes(h.towerType as never) && hasTile;
    case 'upgrade':
    case 'sell':
      return typeof h.towerId === 'string' && h.towerId.length > 0;
    case 'retarget':
      return typeof h.towerId === 'string' && h.towerId.length > 0 && TARGETING_MODES.includes(h.targeting as never);
    default:
      return true;
  }
}
const fail = (reason: CommandFailure): CommandResult => ({ ok: false, reason });

/** Float slack for the step accumulator (speed x FIXED_STEP_MS is not always exact in binary). */
const STEP_EPSILON = 1e-7;
/** At most this many fixed steps per step() call, times speed (SPEC.md 1.4). */
const MAX_STEPS_PER_CALL = 10;

function emptyStats(state: GameState, earlyStart: boolean, earlyStartBonus: number): WaveStats {
  return {
    wave: state.wave,
    enemies: {},
    kills: {},
    leaks: {},
    coreDamage: 0,
    killGold: 0,
    goldStart: state.buildGoldStart,
    earlyStart,
    earlyStartBonus,
    planSource: state.planSources[state.wave] ?? 'fallback',
  };
}

function toRecord(stats: WaveStats, goldEnd: number): WaveRecord {
  return {
    wave: stats.wave,
    enemies: { ...stats.enemies },
    kills: { ...stats.kills },
    leaks: { ...stats.leaks },
    coreDamage: stats.coreDamage,
    goldStart: stats.goldStart,
    goldEnd,
    earlyStart: stats.earlyStart,
    earlyStartBonus: stats.earlyStartBonus,
    planSource: stats.planSource,
  };
}

const near = (a: TileCoord, b: TileCoord): boolean => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;

export const createGame: CreateGame = async (ctx, opts) => {
  const { data, events, agents } = ctx;
  const saves = opts.saves;
  const progress = saves ? saves.loadProgress() : null;
  const bestStars: StarCount = progress?.bestStars[opts.mapId] ?? 0;

  const state: GameState = opts.resume
    ? restoreRun(ctx, opts.resume)
    : createInitialState(data, opts.mapId, opts.difficulty, (progress?.attempts[opts.mapId] ?? 0) + 1);

  let destroyed = false;
  let accumulatorMs = 0;
  /** Bumped whenever an outstanding planWave result must be ignored (payout, game over, destroy). */
  let planToken = 0;
  let hintsInFlight = 0;

  const isOver = (): boolean => state.phase === GamePhase.Won || state.phase === GamePhase.Lost;

  /* ---------------- agent calls (never reject; invalid output falls back) ---------------- */

  async function safePlanWave(input: WaveDirectorInput): Promise<{ plan: WavePlan; source: AgentSource }> {
    try {
      const res = await agents.planWave(input);
      const problems = validateWavePlan(data, res.data, input.wave);
      if (problems.length === 0) return { plan: res.data, source: res.source };
      console.warn(`[core] plan for wave ${input.wave} rejected: ${problems.join('; ')}`);
    } catch (err) {
      console.warn(`[core] planWave(${input.wave}) failed`, err);
    }
    return { plan: scriptedWave(data, input.wave), source: 'fallback' };
  }

  async function safeNarration(input: NarrationInput): Promise<{ narration: NarrationResult; source: AgentSource }> {
    try {
      const res = await agents.getNarration(input);
      if (validateNarration(res.data).length === 0) return { narration: res.data, source: res.source };
      console.warn('[core] narration rejected, using stock text');
    } catch (err) {
      console.warn('[core] getNarration failed', err);
    }
    return { narration: fallbackNarration(input), source: 'fallback' };
  }

  async function safeHint(input: HintInput): Promise<{ hint: HintResult; source: AgentSource }> {
    try {
      const res = await agents.getHint(input);
      if (res && isValidHint(res.data)) return { hint: res.data, source: res.source };
      if (res) console.warn('[core] getHint returned an invalid hint; using the fallback');
    } catch (err) {
      console.warn('[core] getHint failed', err);
    }
    return { hint: fallbackHint(data, input), source: 'fallback' };
  }

  /* ---------------- per-wave tallies: core's own listeners (SPEC.md 2.3) ---------------- */

  const unsubscribers: (() => void)[] = [
    events.on(GameEvents.EnemySpawned, ({ enemy }) => {
      const s = state.currentWaveStats;
      if (s) s.enemies[enemy.type] = (s.enemies[enemy.type] ?? 0) + 1;
    }),
    events.on(GameEvents.EnemyKilled, ({ enemy, gold }) => {
      const s = state.currentWaveStats;
      if (!s) return;
      s.kills[enemy.type] = (s.kills[enemy.type] ?? 0) + 1;
      s.killGold += gold;
    }),
    events.on(GameEvents.EnemyLeaked, ({ enemy, coreDamage }) => {
      const s = state.currentWaveStats;
      if (!s) return;
      s.leaks[enemy.type] = (s.leaks[enemy.type] ?? 0) + 1;
      s.coreDamage += coreDamage;
    }),
  ];

  /* ---------------- game over ---------------- */

  function endGame(won: boolean): void {
    const from = state.phase;
    planToken += 1;
    if (!won && state.currentWaveStats) {
      // The lost wave goes into the match log too, so the Match Analyst sees where the core fell.
      state.waveHistory.push(toRecord(state.currentWaveStats, state.gold));
    }
    state.currentWaveStats = null;
    state.phase = won ? GamePhase.Won : GamePhase.Lost;
    state.stars = computeStars(data, won, state.coreHp);
    state.buildTimerMs = null;
    state.nextPlan = null;
    accumulatorMs = 0;
    if (saves) {
      saves.deleteRun(state.mapId);
      const p = saves.loadProgress();
      p.attempts[state.mapId] = (p.attempts[state.mapId] ?? 0) + 1;
      const prev = p.bestStars[state.mapId] ?? 0;
      p.bestStars[state.mapId] = (Math.max(prev, state.stars) as StarCount);
      saves.writeProgress(p);
    }
    events.emit(GameEvents.PhaseChanged, { from, to: state.phase, wave: state.wave });
    events.emit(GameEvents.GameOver, {
      result: won ? 'win' : 'loss',
      stars: state.stars,
      wave: state.wave,
      coreHp: state.coreHp,
    });
  }

  /** Lost transition: run after every system call in a fixed step. true = the game just ended. */
  function checkLost(): boolean {
    if (state.coreHp > 0 || isOver()) return isOver();
    endGame(false);
    return true;
  }

  /* ---------------- wave start ---------------- */

  function bossTauntFor(wave: number): string | null {
    const n = state.narration;
    if (!n) return null;
    const key = String(wave);
    if (key !== '10' && key !== '20') return null;
    return n.bossTaunts[key]?.[selectBossTaunt(state, ctx)] ?? null;
  }

  function requestNextPlan(wave: number): void {
    const token = ++planToken;
    const input = buildWaveDirectorInput(state, ctx, wave);
    void safePlanWave(input).then(({ plan, source }) => {
      if (destroyed || token !== planToken) return;
      if (state.phase !== GamePhase.Combat || state.wave !== wave - 1) return;
      state.nextPlan = plan;
      state.planSources[wave] = source;
      events.emit(GameEvents.WavePlanned, { plan, source });
    });
  }

  function beginWave(manual: boolean): void {
    const n = state.wave;
    const remaining = state.buildTimerMs;
    const bonus = manual ? earlyStartBonus(data, remaining) : 0;
    const earlyStart = manual && remaining !== null && remaining > 0;
    if (bonus > 0) addGold(state, ctx, bonus, 'earlyStart');

    if (!state.currentPlan) {
      state.currentPlan = scriptedWave(data, n);
      state.planSources[n] = 'fallback';
    }
    const plan = state.currentPlan;

    state.currentWaveStats = emptyStats(state, earlyStart, bonus);
    for (const t of state.towers) t.cooldownMs = 0;
    state.activeHint = null;
    state.activeBossTaunt = bossTauntFor(n);
    state.spawn = createSpawnState(plan);
    state.buildTimerMs = null;
    accumulatorMs = 0;

    state.phase = GamePhase.Combat;
    events.emit(GameEvents.PhaseChanged, { from: GamePhase.Build, to: GamePhase.Combat, wave: n });
    events.emit(GameEvents.WaveStarted, { wave: n, plan, earlyStartBonus: bonus });

    if (n < data.economy.waveCount) requestNextPlan(n + 1);
  }

  /* ---------------- payout and the next build phase ---------------- */

  function payout(): void {
    const n = state.wave;
    const stats = state.currentWaveStats ?? emptyStats(state, false, 0);
    const bonus = waveClearBonus(data, n);
    events.emit(GameEvents.Payout, { wave: n, waveClearBonus: bonus, killGoldThisWave: stats.killGold, gold: state.gold + bonus });
    addGold(state, ctx, bonus, 'waveClear');

    const record = toRecord(stats, state.gold);
    state.waveHistory.push(record);
    if (state.currentPlan) state.playedPlans[n] = state.currentPlan;
    state.currentWaveStats = null;
    state.spawn = null;
    state.activeBossTaunt = null;
    events.emit(GameEvents.WaveCleared, { wave: n, record });

    if (n >= data.economy.waveCount) {
      endGame(true);
      return;
    }

    const next = n + 1;
    planToken += 1; // a planWave result arriving from now on is too late
    if (state.nextPlan) {
      state.currentPlan = state.nextPlan;
    } else {
      state.currentPlan = scriptedWave(data, next);
      state.planSources[next] = 'fallback';
      events.emit(GameEvents.WavePlanned, { plan: state.currentPlan, source: 'fallback' });
    }
    state.nextPlan = null;
    state.wave = next;
    state.phase = GamePhase.Build;
    state.buildTimerMs = buildTimerFor(data, next);
    state.buildGoldStart = state.gold;
    accumulatorMs = 0;
    events.emit(GameEvents.PhaseChanged, { from: GamePhase.Combat, to: GamePhase.Build, wave: next });

    if (saves) {
      saves.writeRun(serializeRun(state));
      events.emit(GameEvents.GameSaved, { wave: next, key: `${SAVE_KEYS.runPrefix}${state.mapId}` });
    }
  }

  /* ---------------- fixed step ---------------- */

  function cleanup(): void {
    if (state.enemies.some((e) => !e.alive)) {
      const alive = state.enemies.filter((e) => e.alive);
      state.enemies.length = 0;
      state.enemies.push(...alive);
    }
    if (state.projectiles.some((p) => p.spent)) {
      const live = state.projectiles.filter((p) => !p.spent);
      state.projectiles.length = 0;
      state.projectiles.push(...live);
    }
  }

  function fixedStep(): void {
    const dt = FIXED_STEP_MS;
    state.elapsedMs += dt;
    stepSpawner(state, ctx, dt);
    if (checkLost()) return;
    stepEnemies(state, ctx, dt);
    if (checkLost()) return;
    stepCombat(state, ctx, dt);
    if (checkLost()) return;
    cleanup();
    if (isWaveClear(state)) payout();
  }

  function step(dtRealMs: number): void {
    if (destroyed || state.paused || isOver()) return;
    if (!(dtRealMs > 0) || !Number.isFinite(dtRealMs)) return;

    if (state.phase === GamePhase.Build) {
      if (state.buildTimerMs === null) return;
      state.buildTimerMs = Math.max(0, state.buildTimerMs - dtRealMs);
      events.emit(GameEvents.BuildTimerTick, { remainingMs: state.buildTimerMs });
      if (state.buildTimerMs <= 0) beginWave(false);
      return;
    }

    if (state.phase !== GamePhase.Combat) return;
    accumulatorMs += dtRealMs * state.speed;
    const maxSteps = MAX_STEPS_PER_CALL * state.speed;
    let steps = 0;
    while (accumulatorMs + STEP_EPSILON >= FIXED_STEP_MS && steps < maxSteps) {
      accumulatorMs -= FIXED_STEP_MS;
      steps += 1;
      fixedStep();
      if (state.phase !== GamePhase.Combat) {
        accumulatorMs = 0;
        return;
      }
    }
    // Hit the cap (a long frame): drop the backlog instead of spiralling.
    if (steps >= maxSteps) accumulatorMs = 0;
    if (accumulatorMs < 0) accumulatorMs = 0;
  }

  /* ---------------- commands ---------------- */

  /** Phase gate: 'game_over' after Won/Lost, 'wrong_phase' outside Build (or Combat when allowed). */
  function gate(allowCombat: boolean): CommandResult | null {
    if (destroyed || isOver()) return fail('game_over');
    if (state.phase === GamePhase.Build) return null;
    if (allowCombat && state.phase === GamePhase.Combat) return null;
    return fail('wrong_phase');
  }

  /** Marks the latest hint of this build phase as followed when the player does what it said. */
  function markFollowed(action: HintAction, matches: (hint: HintResult) => boolean): void {
    const hint = state.activeHint;
    if (!hint || hint.action !== action || state.phase !== GamePhase.Build || !matches(hint)) return;
    for (let i = state.hintsUsed.length - 1; i >= 0; i--) {
      const rec = state.hintsUsed[i];
      if (rec.wave !== state.wave) break;
      if (rec.action === action && !rec.followed) {
        rec.followed = true;
        break;
      }
    }
  }

  const findTower = (id: string): TowerInstance | undefined => state.towers.find((t) => t.id === id);

  const commands: GameCommands = {
    placeTower(type, tile) {
      const g = gate(false);
      if (g) return g;
      const check = canPlace(state, ctx, type, tile);
      if (!check.ok) return check;
      const cost = data.towers.towers[type].cost;
      if (state.gold < cost) return fail('not_enough_gold');
      const id = `t${state.nextId}`;
      state.nextId += 1;
      const tower: TowerInstance = {
        id,
        type,
        level: 1,
        tile: { x: tile.x, y: tile.y },
        targeting: 'First',
        totalSpent: cost,
        cooldownMs: 0,
        kills: 0,
        damageDealt: 0,
        placedOnWave: state.wave,
      };
      state.towers.push(tower);
      events.emit(GameEvents.TowerPlaced, { tower, cost });
      addGold(state, ctx, -cost, 'place');
      markFollowed('place', (h) => h.towerType === type && (!h.tile || near(h.tile, tile)));
      return OK;
    },

    upgradeTower(towerId) {
      const g = gate(false);
      if (g) return g;
      const tower = findTower(towerId);
      if (!tower) return fail('unknown_tower');
      const cost = upgradeCost(data, tower.type, tower.level);
      if (cost === null || tower.level >= data.towers.maxLevel) return fail('max_level');
      if (state.gold < cost) return fail('not_enough_gold');
      tower.level = (tower.level + 1) as TowerInstance['level'];
      tower.totalSpent += cost;
      events.emit(GameEvents.TowerUpgraded, { tower, cost });
      addGold(state, ctx, -cost, 'upgrade');
      markFollowed('upgrade', (h) => h.towerId === towerId);
      return OK;
    },

    sellTower(towerId) {
      const g = gate(false);
      if (g) return g;
      const idx = state.towers.findIndex((t) => t.id === towerId);
      if (idx < 0) return fail('unknown_tower');
      const tower = state.towers[idx];
      const refund = sellRefund(data, tower.totalSpent);
      state.towers.splice(idx, 1);
      events.emit(GameEvents.TowerSold, { towerId, type: tower.type, tile: { ...tower.tile }, refund });
      addGold(state, ctx, refund, 'sell');
      markFollowed('sell', (h) => h.towerId === towerId);
      return OK;
    },

    setTargeting(towerId, mode) {
      const g = gate(true);
      if (g) return g;
      const tower = findTower(towerId);
      if (!tower) return fail('unknown_tower');
      tower.targeting = mode;
      events.emit(GameEvents.TowerRetargeted, { towerId, mode });
      markFollowed('retarget', (h) => h.towerId === towerId && (h.targeting === null || h.targeting === mode));
      return OK;
    },

    startWave() {
      const g = gate(false);
      if (g) return g;
      beginWave(true);
      return OK;
    },

    setSpeed(speed) {
      if (destroyed || isOver()) return fail('game_over');
      if (state.speed !== speed) {
        state.speed = speed;
        events.emit(GameEvents.SpeedChanged, { speed });
      }
      return OK;
    },

    togglePause() {
      if (destroyed || isOver()) return fail('game_over');
      state.paused = !state.paused;
      events.emit(GameEvents.PauseChanged, { paused: state.paused });
      return OK;
    },

    async requestHint() {
      const g = gate(false);
      if (g) return g;
      // Hints already being fetched are reserved, so a double press can't overspend.
      if (state.hintsLeft - hintsInFlight <= 0) return fail('no_hints_left');
      const wave = state.wave;
      hintsInFlight += 1;
      let shown: { hint: HintResult; source: AgentSource };
      try {
        shown = await safeHint(buildHintInput(state, ctx));
      } finally {
        hintsInFlight -= 1;
      }
      if (destroyed || isOver()) return fail('game_over');
      if (state.phase !== GamePhase.Build || state.wave !== wave) return fail('wrong_phase');
      // A hint is used up only when one is shown (here), never on a failed AI attempt.
      state.hintsLeft -= 1;
      state.activeHint = shown.hint;
      state.hintsUsed.push({ wave, action: shown.hint.action, towerType: shown.hint.towerType, followed: false });
      events.emit(GameEvents.HintShown, { hint: shown.hint, source: shown.source, hintsLeft: state.hintsLeft });
      return OK;
    },
  };

  /* ---------------- map start: narration + wave-1 plan, or the stored ones on resume ---------------- */

  if (opts.resume) {
    // No agent calls on resume (SPEC.md 5): stored narration and pendingPlan; stock text if missing.
    if (!state.narration) state.narration = fallbackNarration(buildNarrationInput(state, ctx, bestStars));
    events.emit(GameEvents.NarrationReady, { narration: state.narration, source: 'fallback' });
    if (state.currentPlan) {
      events.emit(GameEvents.WavePlanned, { plan: state.currentPlan, source: state.planSources[state.wave] ?? 'fallback' });
    }
  } else {
    const narr = await safeNarration(buildNarrationInput(state, ctx, bestStars));
    state.narration = narr.narration;
    events.emit(GameEvents.NarrationReady, { narration: narr.narration, source: narr.source });
    const first = await safePlanWave(buildWaveDirectorInput(state, ctx, state.wave));
    state.currentPlan = first.plan;
    state.planSources[state.wave] = first.source;
    events.emit(GameEvents.WavePlanned, { plan: first.plan, source: first.source });
  }
  state.phase = GamePhase.Build;
  state.buildGoldStart = state.gold;

  const instance: GameInstance = {
    state,
    ctx,
    commands,
    step,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      planToken += 1;
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
    },
  };
  return instance;
};

/** Loop constants, exported for tests. */
export const LOOP_LIMITS = { MAX_STEPS_PER_CALL, STEP_EPSILON } as const;
