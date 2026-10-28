/**
 * Tactical Advisor fallback: the rule-based hint of SPEC.md section 5, first match wins.
 *   1. Flyers next and no air tower at a bend -> place a Sniper (Arrow if the Sniper is unaffordable)
 *      on the best listed tile near bend_2.
 *   2. Brutes or the Boss next and an upgrade is affordable -> upgrade the highest-DPS tower.
 *   3. Leaks last wave -> place the cheapest affordable tower near core_approach.
 *   4. Otherwise 'none' with a save-gold message.
 * Works only from HintInput + GameData (no map access), so "at a bend" is judged against the
 * bend-tagged tiles listed in buildable_tiles (see isNearBend).
 */
import { TOWER_TYPES } from '../types';
import type { EnemyType, GameData, HintInput, HintResult, PathSegmentId, TileCoord, TowerType } from '../types';
import { getTowerStats, upgradeCost } from '../towers';

/** A tower within this many tiles (Euclidean, tile to tile) of a bend-tagged tile counts as "at a bend". */
const BEND_RADIUS_TILES = 1.5;

const none = (message: string): HintResult => ({ action: 'none', towerType: null, towerId: null, tile: null, targeting: null, message });

const place = (towerType: TowerType, tile: TileCoord, message: string): HintResult => ({
  action: 'place',
  towerType,
  towerId: null,
  tile: { x: tile.x, y: tile.y },
  targeting: null,
  message,
});

const segmentWords: Record<PathSegmentId, string> = {
  entrance: 'the entrance',
  bend_1: 'the first bend',
  long_straight: 'the long straight',
  bend_2: 'the second bend',
  core_approach: 'the core',
};

const article = (word: string): string => (/^[AEIOU]/i.test(word) ? 'an' : 'a');

function bestTileNear(input: HintInput, segment: PathSegmentId): TileCoord | null {
  // buildHintInput lists tiles best-first within each segment.
  return input.buildable_tiles.find((t) => t.nearPath === segment) ?? input.buildable_tiles[0] ?? null;
}

function isNearBend(input: HintInput, tile: TileCoord): boolean {
  const bendTiles = input.buildable_tiles.filter((t) => t.nearPath === 'bend_1' || t.nearPath === 'bend_2');
  // No free bend tile listed means the bends are fully built up: treat every tower as at a bend.
  if (bendTiles.length === 0) return true;
  return bendTiles.some((b) => Math.hypot(b.x - tile.x, b.y - tile.y) <= BEND_RADIUS_TILES);
}

function nextHas(input: HintInput, enemy: EnemyType): boolean {
  return input.next_wave.groups.some((g) => g.enemy === enemy && g.count > 0);
}

export function fallbackHint(data: GameData, input: HintInput): HintResult {
  const towers = data.towers.towers;

  // 1. Air threat with no air coverage at a bend.
  if (nextHas(input, 'Flyer')) {
    const covered = input.towers.some((t) => towers[t.type].canHitAir && isNearBend(input, t.tile));
    if (!covered) {
      const type: TowerType | null =
        input.gold >= towers.Sniper.cost ? 'Sniper' : input.gold >= towers.Arrow.cost ? 'Arrow' : null;
      const tile = bestTileNear(input, 'bend_2');
      if (type && tile) {
        return place(type, tile, `Flyers are coming; ${article(type)} ${type} by the second bend can shoot them down.`);
      }
    }
  }

  // 2. Heavy units next and an upgrade is affordable.
  const heavy: EnemyType | null = nextHas(input, 'Boss') ? 'Boss' : nextHas(input, 'Brute') ? 'Brute' : null;
  if (heavy) {
    let best: { id: string; type: TowerType; dps: number } | null = null;
    for (const t of input.towers) {
      const cost = upgradeCost(data, t.type, t.level);
      if (cost === null || cost > input.gold) continue;
      const s = getTowerStats(data, t.type, t.level);
      const dps = (s.damage * 1000) / s.fireRateMs;
      if (!best || dps > best.dps) best = { id: t.id, type: t.type, dps };
    }
    if (best) {
      const who = heavy === 'Boss' ? 'the boss is coming' : 'Brutes are coming';
      return {
        action: 'upgrade',
        towerType: best.type,
        towerId: best.id,
        tile: null,
        targeting: null,
        message: `Upgrade your strongest ${best.type}; ${who} and need more damage.`,
      };
    }
  }

  // 3. Leaks last wave: shore up the core approach.
  const leaked = input.last_wave_leaks.filter((l) => l.count > 0);
  if (leaked.length > 0) {
    const affordable = TOWER_TYPES.filter((t) => towers[t].cost <= input.gold).sort((a, b) => towers[a].cost - towers[b].cost);
    const segment: PathSegmentId = leaked[0].leakedAt;
    const tile = bestTileNear(input, segment);
    if (affordable.length > 0 && tile) {
      const type = affordable[0];
      return place(type, tile, `Enemies slipped through last wave; ${article(type)} ${type} near ${segmentWords[segment]} closes the gap.`);
    }
  }

  // 4. Nothing urgent.
  return none('Your defense looks ready for this wave; save your gold for the bigger waves ahead.');
}
