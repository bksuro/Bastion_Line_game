/**
 * MenuScene (scene key SCENE_KEYS.Menu). Owner: agent 6 (UI & Input).
 * Title, Play button (-> MapSelect) and the control summary. Shapes and text only.
 */
import Phaser from 'phaser';
import { SCENE_KEYS } from '../types';
import { createButton, UI_COLORS, UI_FONT } from '../ui';

const CONTROLS = [
  'Build bar + click tile: place tower (Q/W/E/R)',
  'Click a tower: upgrade (U), sell (S), targeting (T)',
  'Space: start wave early (bonus gold)    H: hint',
  '1/2/3: speed    Esc: cancel / close / pause    Right-click: cancel',
];

export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.Menu });
  }

  create(): void {
    const { width, height } = this.scale;

    // A stylised keep wall behind the title.
    const g = this.add.graphics();
    g.fillStyle(0x262c33, 1);
    g.fillRect(0, height * 0.62, width, height * 0.38);
    g.fillStyle(0x323a43, 1);
    for (let x = 0; x < width; x += 64) g.fillRect(x + 8, height * 0.62 - 22, 40, 22);
    g.fillStyle(0x4f86c6, 1);
    g.fillRect(width / 2 - 40, height * 0.62 - 70, 80, 70);
    g.fillStyle(0x1b1f24, 1);
    g.fillRect(width / 2 - 12, height * 0.62 - 34, 24, 34);

    this.add
      .text(width / 2, 92, 'Bastion Line', { fontFamily: UI_FONT, fontSize: '56px', color: UI_COLORS.text, fontStyle: 'bold' })
      .setOrigin(0.5);
    this.add
      .text(width / 2, 148, 'Hold the road. Read the next wave. Build to counter it.', {
        fontFamily: UI_FONT,
        fontSize: '18px',
        color: UI_COLORS.textDim,
      })
      .setOrigin(0.5);

    const play = createButton(this, width / 2 - 100, 196, 200, 48, 'Play', () => this.scene.start(SCENE_KEYS.MapSelect), {
      fontSize: 22,
    });
    play.container.setDepth(1);

    this.add
      .text(width / 2, height * 0.62 + 30, CONTROLS.join('\n'), {
        fontFamily: UI_FONT,
        fontSize: '15px',
        color: UI_COLORS.textDim,
        align: 'center',
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0);

    this.input.keyboard?.once('keydown-ENTER', () => this.scene.start(SCENE_KEYS.MapSelect));
  }
}
