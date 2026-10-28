/**
 * loadGameData: the single place the data/*.json imports are cast to their types.
 * Checks version fields and the basic shape; throws a readable error on a bad file.
 */
import { ENEMY_TYPES, TOWER_TYPES } from '../types';
import type { EconomyFile, EnemiesFile, GameData, LoadGameData, TowersFile, WavesFile } from '../types';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireVersion1(name: string, raw: unknown): Record<string, unknown> {
  // Vite/Node JSON imports may arrive wrapped as { default: ... }.
  const obj = isObject(raw) && isObject(raw.default) && !('version' in raw) ? raw.default : raw;
  if (!isObject(obj)) throw new Error(`loadGameData: ${name} is not an object`);
  if (obj.version !== 1) throw new Error(`loadGameData: ${name} has unsupported version ${String(obj.version)}`);
  return obj;
}

export const loadGameData: LoadGameData = (raw) => {
  const towers = requireVersion1('towers.json', raw.towers) as unknown as TowersFile;
  const enemies = requireVersion1('enemies.json', raw.enemies) as unknown as EnemiesFile;
  const economy = requireVersion1('economy.json', raw.economy) as unknown as EconomyFile;
  const waves = requireVersion1('waves.json', raw.waves) as unknown as WavesFile;

  for (const t of TOWER_TYPES) {
    if (!isObject(towers.towers) || !isObject(towers.towers[t])) throw new Error(`loadGameData: towers.json is missing ${t}`);
  }
  for (const e of ENEMY_TYPES) {
    if (!isObject(enemies.enemies) || !isObject(enemies.enemies[e])) throw new Error(`loadGameData: enemies.json is missing ${e}`);
  }
  if (!Array.isArray(waves.waves) || waves.waves.length !== economy.waveCount) {
    throw new Error(`loadGameData: waves.json must have ${economy.waveCount} waves`);
  }
  waves.waves.forEach((w, i) => {
    if (w.wave !== i + 1) throw new Error(`loadGameData: waves.json entry ${i} is wave ${w.wave}, expected ${i + 1}`);
  });

  const data: GameData = { towers, enemies, economy, waves };
  return data;
};
