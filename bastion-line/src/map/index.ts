/**
 * src/map entry module (SPEC.md section 2.1). Owner: agent 3 (Map & Enemies).
 * Other folders import only from this file. Pure TS, no Phaser.
 *
 * Contract exports: parseTiledMap, createMapQueries.
 * Extras: createMapQueriesExt (same object, typed with the extra queries), pixel helpers and local types.
 */
export { parseTiledMap } from './tiled';
export { createMapQueries, createMapQueriesExt, tileToWorld, tilesToWorld, worldToTiles, worldToTile } from './queries';
export { tileKey, tileCenter } from './geometry';
export type { MapDefExt, MapQueriesExt, SegmentRange, DecorTile, DecorKind, PathTile, PathProjection } from './mapTypes';
