/**
 * Match Analyst fallback: a stats-only debrief built from the match log (WaveRecords).
 * Every claim is a number from the input; length limits of prompts/04-match-analyst.md are met.
 */
import { ENEMY_TYPES } from '../types';
import type { DebriefInput, DebriefResult, EnemyCounts, EnemyType, PathSegmentId } from '../types';

export const DEBRIEF_LIMITS = {
  headlineChars: 60,
  heldChars: 100,
  causeChars: 100,
  tryNextChars: 140,
  maxDamage: 3,
} as const;

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`);

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

function topEnemy(counts: EnemyCounts): { enemy: EnemyType; count: number } | null {
  let best: { enemy: EnemyType; count: number } | null = null;
  for (const type of ENEMY_TYPES) {
    const c = counts[type] ?? 0;
    if (c > 0 && (!best || c > best.count)) best = { enemy: type, count: c };
  }
  return best;
}

const SEGMENT_WORDS: Record<PathSegmentId, string> = {
  entrance: 'the entrance',
  bend_1: 'the first bend',
  long_straight: 'the long straight',
  bend_2: 'the second bend',
  core_approach: 'the core approach',
};

const TRY_NEXT: Record<EnemyType, string> = {
  Grunt: 'Place two Arrows on the inside of the first bend before wave 2 and upgrade them early.',
  Runner: 'Add a Frost tower at the first bend by wave 3 so fast Runners stay in range longer.',
  Brute: 'Build a Cannon at a bend by wave 4 and upgrade your strongest tower before Brutes arrive.',
  Flyer: 'Build a Sniper or extra Arrows near a bend by wave 7; only they can hit Flyers.',
  Boss: 'Save gold before wave 10 and upgrade your best Cannon and Sniper so the boss dies on the path.',
};

export function fallbackDebrief(input: DebriefInput): DebriefResult {
  const total = input.waves.length;
  const clean = input.waves.filter((w) => w.coreDamage === 0).length;

  const headline =
    input.result === 'win'
      ? `Victory with ${plural(input.stars, 'star')} and ${input.final_core_hp} core HP left`
      : `Lost on wave ${input.waves_cleared + 1} after ${plural(input.waves_cleared, 'wave')} cleared`;

  const held: string[] = [];
  held.push(`You cleared ${plural(input.waves_cleared, 'wave')}; ${clean} of ${total} played had no core damage.`);
  const towerKills = input.final_towers.reduce((s, t) => s + t.kills, 0);
  const topTower = [...input.final_towers].sort((a, b) => b.kills - a.kills || a.id.localeCompare(b.id))[0];
  if (topTower && topTower.kills > 0 && towerKills > 0) {
    const share = Math.round((topTower.kills / towerKills) * 100);
    held.push(`Your level ${topTower.level} ${topTower.type} at ${SEGMENT_WORDS[topTower.pathSegment]} made ${share}% of your towers' kills.`);
  }

  const damage = input.waves
    .filter((w) => w.coreDamage > 0)
    .map((w) => ({ w, top: topEnemy(w.leaks) }))
    .filter((x): x is { w: (typeof input.waves)[number]; top: { enemy: EnemyType; count: number } } => x.top !== null)
    .sort((a, b) => b.w.coreDamage - a.w.coreDamage || a.w.wave - b.w.wave)
    .slice(0, DEBRIEF_LIMITS.maxDamage)
    .map(({ w, top }) => ({
      wave: w.wave,
      enemy: top.enemy,
      coreDamage: w.coreDamage,
      cause: clip(`${plural(top.count, top.enemy)} got past your towers on wave ${w.wave}.`, DEBRIEF_LIMITS.causeChars),
    }));

  // The enemy type that leaked most over the match decides the one strategy.
  const leaksByType: EnemyCounts = {};
  for (const w of input.waves) {
    for (const type of ENEMY_TYPES) {
      const c = w.leaks[type] ?? 0;
      if (c > 0) leaksByType[type] = (leaksByType[type] ?? 0) + c;
    }
  }
  const worst = topEnemy(leaksByType);
  let tryNext: string;
  if (worst) tryNext = TRY_NEXT[worst.enemy];
  else if (input.result === 'win') tryNext = 'Flawless. Try a harder map, or win again with a build that skips your favourite tower.';
  else tryNext = 'Spend your gold every build phase and upgrade towers on the bends before wave 10.';

  return {
    headline: clip(headline, DEBRIEF_LIMITS.headlineChars),
    held: held.slice(0, 2).map((h) => clip(h, DEBRIEF_LIMITS.heldChars)),
    damage,
    tryNext: clip(tryNext, DEBRIEF_LIMITS.tryNextChars),
  };
}
