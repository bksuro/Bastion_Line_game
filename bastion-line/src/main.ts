/**
 * Bastion Line - Phaser entry point (Scaffolder). The Integrator (agent 7) owns the wiring later.
 * Canvas is 960x576 (20x12 tiles x 48 px, economy.grid), scaled with Scale Manager FIT.
 */
import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { MapSelectScene } from './scenes/MapSelectScene';
import { GameScene } from './scenes/GameScene';
import { DebriefScene } from './scenes/DebriefScene';

const GAME_WIDTH = 960;
const GAME_HEIGHT = 576;

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: '#1b1f24',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  // Boot first: Phaser auto-starts the first scene in this list.
  scene: [BootScene, MenuScene, MapSelectScene, GameScene, DebriefScene],
};

export const game = new Phaser.Game(config);
