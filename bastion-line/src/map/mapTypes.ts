/**
 * src/map local types (agent 3). Extensions of the frozen contract in src/types.ts.
 * Other folders may import these through src/map/index.ts; the contract types stay authoritative.
 */
import type { MapDef, MapQueries, PathSegmentId, PathWaypoint, TileCoord, Vec2 } from '../types';

/** One named stretch of the path, by path distance: start inclusive, end exclusive (the last one ends at pathLength). */
export interface SegmentRange {
  id: PathSegmentId;
  start: number;
  end: number;
}

export type DecorKind = 'tree' | 'rock' | 'farmhouse' | 'pond' | string;

/** A decoration tile from the Tiled `decor` layer. Blocked decor is never buildable. */
export interface DecorTile extends TileCoord {
  kind: DecorKind;
  blocked: boolean;
}

/** A path tile with the segment of its centre (from the Tiled `path` layer). */
export interface PathTile extends TileCoord {
  segment: PathSegmentId;
  /** Path distance of the tile centre. */
  distance: number;
}

/**
 * What parseTiledMap actually returns: a MapDef plus the fields the contract has no room for.
 * `segments` is needed because MapDef.path only tags the waypoints, not the segment boundaries
 * (SPEC.md 2.4: entrance 0-16.5, bend_1 16.5-21.5, ...). createMapQueries reads it when present.
 */
export interface MapDefExt extends MapDef {
  segments: SegmentRange[];
  /** Same tiles as pathTiles, in path order, with their segment tags and centre distances. */
  taggedPathTiles: PathTile[];
  decor: DecorTile[];
  /** Tile size in pixels from the Tiled file (must equal economy.grid.tileSize). */
  tileSize: number;
}

/** Closest point on the path polyline to a position. */
export interface PathProjection {
  /** Path distance of the closest point. */
  distance: number;
  /** Euclidean distance (tiles) from the position to the path. */
  offset: number;
  pos: Vec2;
}

/** Everything createMapQueries returns; assignable to the contract's MapQueries. */
export interface MapQueriesExt extends MapQueries {
  readonly cols: number;
  readonly rows: number;
  readonly pathLength: number;
  /** Ordered waypoints (the path polyline), first = spawn, last = core. */
  readonly path: readonly PathWaypoint[];
  readonly pathTiles: readonly TileCoord[];
  readonly buildableTiles: readonly TileCoord[];
  readonly core: TileCoord;
  readonly segments: readonly SegmentRange[];
  isInBounds(tile: TileCoord): boolean;
  isPathTile(tile: TileCoord): boolean;
  isCoreTile(tile: TileCoord): boolean;
  /** Segment at a path distance (clamped to [0, pathLength]). */
  segmentAt(distance: number): PathSegmentId;
  /** Centre of a tile in tile units: (x + 0.5, y + 0.5). */
  tileCenter(tile: TileCoord): Vec2;
  /** Tile containing a position in tile units, or null when off the grid. */
  tileAt(pos: Vec2): TileCoord | null;
  /** Closest point on the path to a position (ties: the smaller path distance). */
  projectOntoPath(pos: Vec2): PathProjection;
  /** Length of path (tiles) within `range` of a tile centre (Euclidean), e.g. how much path a tower covers. */
  pathCoverage(tile: TileCoord, range: number): number;
}
