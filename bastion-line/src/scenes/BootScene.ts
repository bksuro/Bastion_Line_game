/**
 * BootScene (scene key SCENE_KEYS.Boot). Owner: agent 7 (Integrator, loading).
 * Builds GameData from the four data/*.json imports (SPEC.md 1.5), loads public/maps/<id>.json
 * (Tiled) into the JSON cache, checks the map parses and matches economy.grid, then starts the Menu.
 * GameScene reads both back with getBootData / mapCacheKey.
 */
import Phaser from 'phaser';
import towers from '../../data/towers.json';
import enemies from '../../data/enemies.json';
import economy from '../../data/economy.json';
import waves from '../../data/waves.easy.json';
import { SCENE_KEYS, type GameData, type MapId } from '../types';
import { loadGameData } from '../core';
import { parseTiledMap, type MapDefExt } from '../map';
import { UI_COLORS, UI_FONT } from '../ui';

/** Maps shipped with the prototype (only Easy exists; Medium/Hard are locked in MapSelect). */
export const BOOT_MAPS: readonly MapId[] = ['easy'];

/** JSON-cache key of a map file loaded by BootScene. */
export const mapCacheKey = (mapId: MapId): string => `map:${mapId}`;

const REGISTRY_DATA = 'bastion-line:gameData';

/** GameData built in BootScene, or null when Boot has not run (or failed). */
export function getBootData(scene: Phaser.Scene): GameData | null {
  return (scene.registry.get(REGISTRY_DATA) as GameData | undefined) ?? null;
}

/** Checks that a parsed map matches the data the sim was balanced on. Returns readable problems. */
export function checkMapAgainstData(data: GameData, map: MapDefExt): string[] {
  const grid = data.economy.grid;
  const problems: string[] = [];
  if (map.cols !== grid.cols || map.rows !== grid.rows) {
    problems.push(`map is ${map.cols}x${map.rows}, economy.grid is ${grid.cols}x${grid.rows}`);
  }
  if (map.tileSize !== grid.tileSize) problems.push(`map tile size ${map.tileSize} px, economy.grid.tileSize ${grid.tileSize} px`);
  if (Math.abs(map.pathLength - data.economy.simPathLengthTiles) > 1e-6) {
    problems.push(`map path length ${map.pathLength}, economy.simPathLengthTiles ${data.economy.simPathLengthTiles}`);
  }
  return problems;
}

export class BootScene extends Phaser.Scene {
  private status: Phaser.GameObjects.Text | null = null;

  constructor() {
    super({ key: SCENE_KEYS.Boot });
  }

  preload(): void {
    const { width, height } = this.scale;
    this.status = this.add
      .text(width / 2, height / 2, 'Loading...', { fontFamily: UI_FONT, fontSize: '22px', color: UI_COLORS.textDim })
      .setOrigin(0.5);
    for (const id of BOOT_MAPS) this.load.json(mapCacheKey(id), `maps/${id}.json`);
  }

  create(): void {
    try {
      const data = loadGameData({ towers, enemies, economy, waves });
      for (const id of BOOT_MAPS) {
        const json: unknown = this.cache.json.get(mapCacheKey(id));
        if (json === undefined || json === null) throw new Error(`maps/${id}.json did not load`);
        const map = parseTiledMap(json) as MapDefExt;
        const problems = checkMapAgainstData(data, map);
        if (problems.length > 0) console.warn(`[boot] ${id} map does not match data/: ${problems.join('; ')}`);
      }
      this.registry.set(REGISTRY_DATA, data);
    } catch (err) {
      console.error('[boot] failed to load game data', err);
      this.status
        ?.setText(`Could not load the game data.\n${err instanceof Error ? err.message : String(err)}`)
        .setColor(UI_COLORS.textBad)
        .setAlign('center');
      return;
    }
    this.scene.start(SCENE_KEYS.Menu);
  }
}
