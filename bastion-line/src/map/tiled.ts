/**
 * Tiled JSON -> MapDef (agent 3). Pure TS, no Phaser; throws on invalid input.
 *
 * Expected Tiled layout (see public/maps/easy.json):
 * - Map properties: id, name, difficulty, setting, boss10, boss20 (all strings).
 * - One embedded tileset whose tiles carry properties: kind = ground | path | core | decor,
 *   segment = <PathSegmentId> on path tiles, decor = <kind> and blocked = true on decor tiles.
 * - Tile layers `path` (path tiles tagged by segment + exactly one core tile) and optional `decor`.
 * - Object layer with a polyline object named/typed `path` (pixels; first point = spawn, last = core centre).
 * - Optional object layer `segments`: one object per segment, name = segment id, float properties start/end
 *   (path distance in tiles). Without it the segments come from fallbackSegments.
 */
import type { Difficulty, MapId, ParseTiledMap, PathSegmentId, PathWaypoint, TileCoord, Vec2 } from '../types';
import { PATH_SEGMENTS } from '../types';
import type { DecorTile, MapDefExt, PathTile, SegmentRange } from './mapTypes';
import {
  cumulativeDistances,
  fallbackSegments,
  pointAt,
  projectOntoPath,
  segmentAt,
  tileCenter,
  tileKey,
} from './geometry';

const MAP_IDS: readonly MapId[] = ['easy', 'medium', 'hard'];
const DIFFICULTIES: readonly Difficulty[] = ['Easy', 'Medium', 'Hard'];
/** Tiled stores flip/rotation flags in the top bits of a gid. */
const GID_MASK = 0x1fffffff;
/** Blocked decor must be more than this many tiles (centre to centre) from every path tile (SPEC.md 2.4). */
const DECOR_MIN_PATH_DISTANCE = 3;
const EPS = 1e-6;

type Json = Record<string, unknown>;
type PropMap = Record<string, unknown>;

interface TileInfo {
  kind: string;
  props: PropMap;
}

function fail(msg: string): never {
  throw new Error(`parseTiledMap: ${msg}`);
}

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${what} must be a finite number`);
  return v;
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(`${what} must be a non-empty string`);
  return v;
}

function readProps(v: unknown): PropMap {
  const out: PropMap = {};
  if (v === undefined) return out;
  if (!Array.isArray(v)) fail('properties must be an array');
  for (const p of v) {
    if (!isObj(p) || typeof p.name !== 'string') fail('invalid property entry');
    out[p.name] = p.value;
  }
  return out;
}

function flattenLayers(v: unknown): Json[] {
  if (!Array.isArray(v)) fail('layers must be an array');
  const out: Json[] = [];
  for (const l of v) {
    if (!isObj(l)) fail('invalid layer');
    if (l.type === 'group') out.push(...flattenLayers(l.layers));
    else out.push(l);
  }
  return out;
}

function readTileData(layer: Json, cols: number, rows: number): number[] {
  let data: unknown = layer.data;
  if (layer.encoding === 'base64' || layer.compression) fail(`layer "${String(layer.name)}": only CSV/array tile data is supported`);
  if (typeof data === 'string') data = data.split(',').map((s) => Number(s.trim()));
  if (!Array.isArray(data) || data.length !== cols * rows) {
    fail(`layer "${String(layer.name)}" must have ${cols * rows} tiles`);
  }
  return data.map((g, i) => {
    if (typeof g !== 'number' || !Number.isInteger(g) || g < 0) fail(`layer "${String(layer.name)}" tile ${i} is not a gid`);
    return g & GID_MASK;
  });
}

function readTilesets(v: unknown): (gid: number) => TileInfo | null {
  if (!Array.isArray(v) || v.length === 0) fail('tilesets must be a non-empty array');
  const sets: { firstgid: number; count: number; tiles: Map<number, TileInfo> }[] = [];
  for (const ts of v) {
    if (!isObj(ts)) fail('invalid tileset');
    if (ts.source !== undefined) fail('external tilesets are not supported; embed the tileset');
    const firstgid = num(ts.firstgid, 'tileset.firstgid');
    const count = num(ts.tilecount, 'tileset.tilecount');
    const tiles = new Map<number, TileInfo>();
    if (Array.isArray(ts.tiles)) {
      for (const t of ts.tiles) {
        if (!isObj(t)) fail('invalid tileset tile');
        const props = readProps(t.properties);
        tiles.set(num(t.id, 'tile.id'), { kind: typeof props.kind === 'string' ? props.kind : 'ground', props });
      }
    }
    sets.push({ firstgid, count, tiles });
  }
  sets.sort((a, b) => a.firstgid - b.firstgid);
  return (gid) => {
    if (gid === 0) return null;
    for (let i = sets.length - 1; i >= 0; i--) {
      const s = sets[i];
      if (gid >= s.firstgid) {
        const local = gid - s.firstgid;
        if (local >= s.count) fail(`gid ${gid} is outside its tileset`);
        return s.tiles.get(local) ?? { kind: 'ground', props: {} };
      }
    }
    fail(`gid ${gid} has no tileset`);
  };
}

function isSegmentId(v: unknown): v is PathSegmentId {
  return typeof v === 'string' && (PATH_SEGMENTS as readonly string[]).includes(v);
}

function readPolyline(layers: Json[], tileSize: number): Vec2[] {
  for (const l of layers) {
    if (l.type !== 'objectgroup' || !Array.isArray(l.objects)) continue;
    for (const o of l.objects) {
      if (!isObj(o) || !Array.isArray(o.polyline)) continue;
      if (o.name !== 'path' && o.type !== 'path' && o.class !== 'path') continue;
      const ox = num(o.x, 'path.x') + (typeof l.offsetx === 'number' ? l.offsetx : 0);
      const oy = num(o.y, 'path.y') + (typeof l.offsety === 'number' ? l.offsety : 0);
      const pts = o.polyline.map((p, i) => {
        if (!isObj(p)) fail(`path point ${i} is invalid`);
        return { x: (ox + num(p.x, 'path point x')) / tileSize, y: (oy + num(p.y, 'path point y')) / tileSize };
      });
      if (pts.length < 2) fail('path polyline needs at least 2 points');
      return pts;
    }
  }
  fail('no polyline object named "path" found');
}

function readSegments(layers: Json[], pathLength: number): SegmentRange[] | null {
  const layer = layers.find((l) => l.type === 'objectgroup' && l.name === 'segments');
  if (!layer) return null;
  if (!Array.isArray(layer.objects) || layer.objects.length === 0) fail('segments layer is empty');
  const ranges = layer.objects.map((o): SegmentRange => {
    if (!isObj(o)) fail('invalid segment object');
    if (!isSegmentId(o.name)) fail(`unknown segment "${String(o.name)}"`);
    const p = readProps(o.properties);
    return { id: o.name, start: num(p.start, `${o.name}.start`), end: num(p.end, `${o.name}.end`) };
  });
  ranges.sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const r of ranges) {
    if (Math.abs(r.start - cursor) > EPS) fail(`segment ${r.id} starts at ${r.start}, expected ${cursor}`);
    if (r.end <= r.start) fail(`segment ${r.id} is empty`);
    cursor = r.end;
  }
  if (Math.abs(cursor - pathLength) > EPS) fail(`segments end at ${cursor} but the path is ${pathLength} tiles`);
  ranges[ranges.length - 1].end = pathLength;
  return ranges;
}

export const parseTiledMap: ParseTiledMap = (json) => {
  if (!isObj(json)) fail('input is not an object');
  if (json.orientation !== undefined && json.orientation !== 'orthogonal') fail('only orthogonal maps are supported');
  if (json.infinite === true) fail('infinite maps are not supported');
  const cols = num(json.width, 'width');
  const rows = num(json.height, 'height');
  const tileSize = num(json.tilewidth, 'tilewidth');
  if (num(json.tileheight, 'tileheight') !== tileSize) fail('tiles must be square');
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) fail('invalid map size');

  const props = readProps(json.properties);
  const id = props.id;
  if (typeof id !== 'string' || !(MAP_IDS as readonly string[]).includes(id)) fail(`property id must be one of ${MAP_IDS.join(', ')}`);
  const difficulty = props.difficulty;
  if (typeof difficulty !== 'string' || !(DIFFICULTIES as readonly string[]).includes(difficulty)) {
    fail(`property difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  }

  const tileInfo = readTilesets(json.tilesets);
  const layers = flattenLayers(json.layers);
  const tileLayer = (name: string) => layers.find((l) => l.type === 'tilelayer' && l.name === name);

  // Path polyline -> waypoints.
  const points = readPolyline(layers, tileSize);
  const dists = cumulativeDistances(points);
  const pathLength = dists[dists.length - 1];
  if (pathLength <= 0) fail('path has zero length');
  const segments = readSegments(layers, pathLength);
  const rawPath: PathWaypoint[] = points.map((p, i) => ({ x: p.x, y: p.y, distance: dists[i], segment: 'entrance' }));
  const segs = segments ?? fallbackSegments(rawPath);
  const path = rawPath.map((w) => ({ ...w, segment: segmentAt(segs, w.distance) }));

  // Path and core tiles.
  const pathLayer = tileLayer('path');
  if (!pathLayer) fail('missing tile layer "path"');
  const pathData = readTileData(pathLayer, cols, rows);
  const tagged: PathTile[] = [];
  let core: TileCoord | null = null;
  pathData.forEach((gid, i) => {
    const info = tileInfo(gid);
    if (!info) return;
    const tile = { x: i % cols, y: Math.floor(i / cols) };
    if (info.kind === 'core') {
      if (core) fail('more than one core tile');
      core = tile;
    } else if (info.kind === 'path') {
      const proj = projectOntoPath(path, tileCenter(tile));
      if (proj.offset > 0.5 + EPS) fail(`path tile ${tileKey(tile)} is not on the path polyline`);
      const segment = info.props.segment;
      if (!isSegmentId(segment)) fail(`path tile ${tileKey(tile)} has no valid segment property`);
      const expected = segmentAt(segs, proj.distance);
      if (segment !== expected) fail(`path tile ${tileKey(tile)} is tagged ${segment} but its centre is in ${expected}`);
      tagged.push({ ...tile, segment, distance: proj.distance });
    }
  });
  if (!core) fail('missing core tile');
  const coreTile: TileCoord = core;
  const end = path[path.length - 1];
  const coreCentre = tileCenter(coreTile);
  if (Math.abs(end.x - coreCentre.x) > EPS || Math.abs(end.y - coreCentre.y) > EPS) {
    fail('the path must end at the core tile centre');
  }
  tagged.sort((a, b) => a.distance - b.distance);
  const pathKeys = new Set(tagged.map(tileKey));
  const coreKey = tileKey(coreTile);

  // Every on-grid tile the polyline crosses must be a path (or the core) tile.
  for (let d = 0; d <= pathLength; d += 0.05) {
    const p = pointAt(path, d);
    const t = { x: Math.floor(p.x), y: Math.floor(p.y) };
    if (t.x < 0 || t.y < 0 || t.x >= cols || t.y >= rows) continue;
    const k = tileKey(t);
    if (k !== coreKey && !pathKeys.has(k)) fail(`the path crosses tile ${k}, which is not a path tile`);
  }

  // Decorations.
  const decor: DecorTile[] = [];
  const decorLayer = tileLayer('decor');
  if (decorLayer) {
    readTileData(decorLayer, cols, rows).forEach((gid, i) => {
      const info = tileInfo(gid);
      if (!info) return;
      const tile = { x: i % cols, y: Math.floor(i / cols) };
      const blocked = info.props.blocked === true;
      const k = tileKey(tile);
      if (pathKeys.has(k) || k === coreKey) fail(`decor on path tile ${k}`);
      if (blocked) {
        for (const pt of tagged) {
          if (Math.hypot(pt.x - tile.x, pt.y - tile.y) <= DECOR_MIN_PATH_DISTANCE) {
            fail(`blocked decor at ${k} is within ${DECOR_MIN_PATH_DISTANCE} tiles of path tile ${tileKey(pt)}`);
          }
        }
      }
      decor.push({ ...tile, kind: typeof info.props.decor === 'string' ? info.props.decor : 'decor', blocked });
    });
  }
  const blockedKeys = new Set(decor.filter((d) => d.blocked).map(tileKey));

  const buildableTiles: TileCoord[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const k = `${x},${y}`;
      if (!pathKeys.has(k) && k !== coreKey && !blockedKeys.has(k)) buildableTiles.push({ x, y });
    }
  }

  const map: MapDefExt = {
    id: id as MapId,
    name: str(props.name, 'property name'),
    difficulty: difficulty as Difficulty,
    setting: str(props.setting, 'property setting'),
    bossNames: { '10': str(props.boss10, 'property boss10'), '20': str(props.boss20, 'property boss20') },
    cols,
    rows,
    path,
    pathLength,
    pathTiles: tagged.map((t) => ({ x: t.x, y: t.y })),
    buildableTiles,
    core: { ...coreTile },
    segments: segs.map((s) => ({ ...s })),
    taggedPathTiles: tagged,
    decor,
    tileSize,
  };
  return map;
};
