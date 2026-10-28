/**
 * Read-only placement check (types.ts CanPlace). Never mutates state.
 * Failure order: phase -> 'tile_not_buildable' -> 'tile_occupied' -> 'not_enough_gold'.
 */
import { GamePhase } from '../types';
import type { CanPlace } from '../types';

export const canPlace: CanPlace = (state, ctx, type, tile) => {
  if (state.phase === GamePhase.Won || state.phase === GamePhase.Lost) return { ok: false, reason: 'game_over' };
  if (state.phase !== GamePhase.Build) return { ok: false, reason: 'wrong_phase' };
  if (!ctx.mapQueries.isBuildable(tile)) return { ok: false, reason: 'tile_not_buildable' };
  if (state.towers.some((t) => t.tile.x === tile.x && t.tile.y === tile.y)) return { ok: false, reason: 'tile_occupied' };
  if (state.gold < ctx.data.towers.towers[type].cost) return { ok: false, reason: 'not_enough_gold' };
  return { ok: true };
};
