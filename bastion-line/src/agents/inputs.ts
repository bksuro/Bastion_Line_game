/**
 * Agent input builders (snake_case keys verbatim from prompts/*.md) and the boss-taunt picker.
 */
import { ENEMY_TYPES, GamePhase, PATH_SEGMENTS, TOWER_TYPES } from '../types';
import type {
  AgentTowerSummary,
  BuildDebriefInput,
  BuildHintInput,
  BuildNarrationInput,
  BuildWaveDirectorInput,
  EnemyCounts,
  EnemyType,
  GameContext,
  GameState,
  HintInput,
  PathSegmentId,
  SelectBossTaunt,
  TileCoord,
  TowerInstance,
  TowerType,
  WavePlan,
} from '../types';
import { threatBudget, unlockedEnemies } from '../waves';

/** Max tiles sent to the Tactical Advisor (prompts/02: "~15 most relevant tiles"). */
export const HINT_TILE_LIMIT = 15;
/** Share of total tower spend a type must exceed to be "dominant" for the boss taunt. */
export const DOMINANT_SHARE = 0.4;

const towerSummary = (ctx: GameContext, t: TowerInstance): AgentTowerSummary => ({
  id: t.id,
  type: t.type,
  level: t.level,
  pathSegment: ctx.mapQueries.segmentForTile(t.tile),
  targeting: t.targeting,
});

/** Counts -> [{enemy, count}] in ENEMY_TYPES order, zero counts dropped. */
const countList = (counts: EnemyCounts): { enemy: EnemyType; count: number }[] =>
  ENEMY_TYPES.filter((e) => (counts[e] ?? 0) > 0).map((e) => ({ enemy: e, count: counts[e] as number }));

const planCounts = (plan: WavePlan): EnemyCounts => {
  const out: EnemyCounts = {};
  for (const g of plan.groups) out[g.enemy] = (out[g.enemy] ?? 0) + g.count;
  return out;
};

const mixOf = (plan: WavePlan): EnemyType[] => ENEMY_TYPES.filter((e) => plan.groups.some((g) => g.enemy === e && g.count > 0));

/** The plan used for an earlier wave: played plans first, then the running one. */
function planFor(state: GameState, wave: number): WavePlan | null {
  return state.playedPlans[wave] ?? (state.currentPlan && state.currentPlan.wave === wave ? state.currentPlan : null);
}

export const buildWaveDirectorInput: BuildWaveDirectorInput = (state, ctx, wave) => {
  const last = state.waveHistory.length > 0 ? state.waveHistory[state.waveHistory.length - 1] : null;
  const previous_mixes: EnemyType[][] = [];
  for (let w = Math.max(1, wave - 3); w < wave; w++) {
    const plan = planFor(state, w);
    if (plan) previous_mixes.push(mixOf(plan));
  }
  return {
    map: state.mapId,
    difficulty: state.difficulty,
    wave,
    threat_budget: threatBudget(ctx.data, wave),
    unlocked_enemies: unlockedEnemies(ctx.data, wave),
    gold: state.gold,
    core_hp: state.coreHp,
    core_hp_max: state.coreHpMax,
    towers: state.towers.map((t) => towerSummary(ctx, t)),
    last_wave: last
      ? { groups: countList(last.enemies), leaks: countList(last.leaks), core_damage: last.coreDamage }
      : null,
    previous_mixes,
  };
};

/**
 * Free buildable tiles ranked by how much path an Arrow-range circle on them covers. To keep every
 * stretch represented, the best few of each path segment are kept (15 / 5 = 3 each), listed in
 * PATH_SEGMENTS order and best-first within a segment.
 */
function relevantTiles(state: GameState, ctx: GameContext): HintInput['buildable_tiles'] {
  const range = ctx.data.towers.towers.Arrow.range;
  const occupied = new Set(state.towers.map((t) => `${t.tile.x},${t.tile.y}`));
  const scored: { tile: TileCoord; seg: PathSegmentId; cover: number }[] = [];
  for (const tile of ctx.map.buildableTiles) {
    if (occupied.has(`${tile.x},${tile.y}`)) continue;
    let cover = 0;
    for (const p of ctx.map.pathTiles) {
      if (Math.hypot(p.x - tile.x, p.y - tile.y) <= range) cover += 1;
    }
    if (cover === 0) continue;
    scored.push({ tile, seg: ctx.mapQueries.segmentForTile(tile), cover });
  }
  const perSegment = Math.ceil(HINT_TILE_LIMIT / PATH_SEGMENTS.length);
  const out: HintInput['buildable_tiles'] = [];
  for (const seg of PATH_SEGMENTS) {
    scored
      .filter((s) => s.seg === seg)
      .sort((a, b) => b.cover - a.cover || a.tile.y - b.tile.y || a.tile.x - b.tile.x)
      .slice(0, perSegment)
      .forEach((s) => out.push({ x: s.tile.x, y: s.tile.y, nearPath: seg }));
  }
  return out.slice(0, HINT_TILE_LIMIT);
}

export const buildHintInput: BuildHintInput = (state, ctx) => {
  const last = state.waveHistory.length > 0 ? state.waveHistory[state.waveHistory.length - 1] : null;
  return {
    wave: state.wave,
    gold: state.gold,
    core_hp: state.coreHp,
    hints_left_after_this: Math.max(0, state.hintsLeft - 1),
    towers: state.towers.map((t) => ({
      id: t.id,
      type: t.type,
      level: t.level,
      tile: { x: t.tile.x, y: t.tile.y },
      targeting: t.targeting,
      totalSpent: t.totalSpent,
    })),
    buildable_tiles: relevantTiles(state, ctx),
    path_segments: [...PATH_SEGMENTS],
    next_wave: { groups: state.currentPlan ? countList(planCounts(state.currentPlan)) : [] },
    // Leaks are stored as counts only; every leak happens at the end of the path (SPEC.md 5).
    last_wave_leaks: last ? countList(last.leaks).map((l) => ({ ...l, leakedAt: 'core_approach' as PathSegmentId })) : [],
  };
};

export const buildNarrationInput: BuildNarrationInput = (state, ctx, bestStars) => ({
  id: state.mapId,
  name: ctx.map.name,
  difficulty: state.difficulty,
  setting: ctx.map.setting,
  boss_names: { '10': ctx.map.bossNames['10'], '20': ctx.map.bossNames['20'] },
  player_stars_on_this_map: bestStars,
  attempt_number: state.attemptNumber,
});

export const buildDebriefInput: BuildDebriefInput = (state, ctx) => {
  const won = state.phase === GamePhase.Won;
  const cleared = state.waveHistory.filter((r) => won || r.wave < state.wave).length;
  return {
    map: state.mapId,
    difficulty: state.difficulty,
    result: won ? 'win' : 'loss',
    stars: state.stars ?? 0,
    waves_cleared: cleared,
    final_core_hp: state.coreHp,
    final_towers: state.towers.map((t) => ({ ...towerSummary(ctx, t), kills: t.kills, placedOnWave: t.placedOnWave })),
    waves: state.waveHistory.map((r) => ({
      wave: r.wave,
      enemies: { ...r.enemies },
      leaks: { ...r.leaks },
      coreDamage: r.coreDamage,
      goldStart: r.goldStart,
      goldEnd: r.goldEnd,
      earlyStart: r.earlyStart,
    })),
    hints_used: state.hintsUsed.map((h) => ({ ...h })),
  };
};

/** Type with the most gold spent across current towers; 'mixed' if none exceeds 40% (or no towers). */
export const selectBossTaunt: SelectBossTaunt = (state) => {
  const spent: Record<TowerType, number> = { Arrow: 0, Frost: 0, Cannon: 0, Sniper: 0 };
  let total = 0;
  for (const t of state.towers) {
    spent[t.type] += t.totalSpent;
    total += t.totalSpent;
  }
  if (total <= 0) return 'mixed';
  let best: TowerType = TOWER_TYPES[0];
  for (const type of TOWER_TYPES) if (spent[type] > spent[best]) best = type;
  return spent[best] / total > DOMINANT_SHARE ? best : 'mixed';
};
