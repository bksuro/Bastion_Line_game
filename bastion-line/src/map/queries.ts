/**
 * MapDef -> MapQueries (agent 3). Pure TS, no Phaser. Tile units throughout;
 * pixel conversion helpers take the tile size explicitly (economy.grid.tileSize).
 */
import type { CreateMapQueries, MapDef, TileCoord, Vec2 } from '../types';
import type { MapDefExt, MapQueriesExt, SegmentRange } from './mapTypes';
import {
  fallbackSegments,
  pathLengthWithin,
  pointAt,
  projectOntoPath,
  segmentAt,
  tileCenter,
  tileKey,
} from './geometry';

function segmentsOf(map: MapDef): SegmentRange[] {
  const ext = (map as Partial<MapDefExt>).segments;
  return Array.isArray(ext) && ext.length > 0 ? ext.map((s) => ({ ...s })) : fallbackSegments(map.path);
}

/** Typed variant of createMapQueries for callers that want the extra queries. */
export function createMapQueriesExt(map: MapDef): MapQueriesExt {
  if (map.path.length < 2) throw new Error('createMapQueries: the path needs at least 2 waypoints');
  const segments = segmentsOf(map);
  const pathKeys = new Set(map.pathTiles.map(tileKey));
  const buildKeys = new Set(map.buildableTiles.map(tileKey));
  const coreKey = tileKey(map.core);
  const pathLength = map.path[map.path.length - 1].distance;
  const clamp = (d: number) => Math.max(0, Math.min(pathLength, d));
  const segAt = (d: number) => segmentAt(segments, clamp(d));

  return {
    cols: map.cols,
    rows: map.rows,
    pathLength,
    path: map.path,
    pathTiles: map.pathTiles,
    buildableTiles: map.buildableTiles,
    core: map.core,
    segments,
    isBuildable: (tile) => buildKeys.has(tileKey(tile)),
    isInBounds: (tile) => tile.x >= 0 && tile.y >= 0 && tile.x < map.cols && tile.y < map.rows,
    isPathTile: (tile) => pathKeys.has(tileKey(tile)),
    isCoreTile: (tile) => tileKey(tile) === coreKey,
    positionAt: (distance) => {
      const d = clamp(distance);
      return { pos: pointAt(map.path, d), segment: segmentAt(segments, d) };
    },
    segmentAt: segAt,
    segmentForTile: (tile) => segAt(projectOntoPath(map.path, tileCenter(tile)).distance),
    tileCenter,
    tileAt: (pos) => {
      const t = { x: Math.floor(pos.x), y: Math.floor(pos.y) };
      return t.x >= 0 && t.y >= 0 && t.x < map.cols && t.y < map.rows ? t : null;
    },
    projectOntoPath: (pos) => projectOntoPath(map.path, pos),
    pathCoverage: (tile, range) => pathLengthWithin(map.path, tileCenter(tile), range),
  };
}

export const createMapQueries: CreateMapQueries = (map) => createMapQueriesExt(map);

/** Tile -> pixel centre of that tile. */
export function tileToWorld(tile: TileCoord, tileSize: number): Vec2 {
  return { x: (tile.x + 0.5) * tileSize, y: (tile.y + 0.5) * tileSize };
}

/** Position in tile units -> pixels. */
export function tilesToWorld(pos: Vec2, tileSize: number): Vec2 {
  return { x: pos.x * tileSize, y: pos.y * tileSize };
}

/** Pixel -> position in tile units (float). */
export function worldToTiles(px: Vec2, tileSize: number): Vec2 {
  return { x: px.x / tileSize, y: px.y / tileSize };
}

/** Pixel -> the tile under it (may be off-grid; check with isInBounds). */
export function worldToTile(px: Vec2, tileSize: number): TileCoord {
  return { x: Math.floor(px.x / tileSize), y: Math.floor(px.y / tileSize) };
}
