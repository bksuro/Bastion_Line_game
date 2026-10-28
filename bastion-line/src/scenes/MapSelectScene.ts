/**
 * MapSelectScene (scene key SCENE_KEYS.MapSelect). Owner: agent 6 (UI & Input).
 * Three map cards: Easy is playable (New run, plus Continue when a run save exists); Medium and Hard
 * are shown locked. Starts SCENE_KEYS.Game with GameSceneData { mapId, resume }.
 */
import Phaser from 'phaser';
import { SCENE_KEYS, type Difficulty, type GameSceneData, type MapId, type ProgressSave, type SaveStore, type StarCount } from '../types';
import { createSaveStore } from '../save';
import { createButton, UI_COLORS, UI_FONT } from '../ui';

interface MapCard {
  id: MapId;
  difficulty: Difficulty;
  /** Display name; the real name lives in public/maps/<id>.json (only Easy exists in the prototype). */
  title: string;
  unlocked: boolean;
}

const CARDS: MapCard[] = [
  { id: 'easy', difficulty: 'Easy', title: 'Greenhollow Road', unlocked: true },
  { id: 'medium', difficulty: 'Medium', title: '???', unlocked: false },
  { id: 'hard', difficulty: 'Hard', title: '???', unlocked: false },
];

/** Draws 3 star outlines, `filled` of them gold. */
export function drawStars(scene: Phaser.Scene, cx: number, cy: number, filled: number, size = 14): void {
  for (let i = 0; i < 3; i++) {
    const x = cx + (i - 1) * size * 2.4;
    const on = i < filled;
    scene.add.star(x, cy, 5, size * 0.45, size, on ? 0xffd54a : 0x2a3038).setStrokeStyle(2, on ? 0xb8902a : 0x4a535d);
  }
}

export class MapSelectScene extends Phaser.Scene {
  constructor() {
    super({ key: SCENE_KEYS.MapSelect });
  }

  create(): void {
    const { width, height } = this.scale;
    let saves: SaveStore | null = null;
    let progress: ProgressSave = { version: 1, bestStars: {}, attempts: {} };
    try {
      saves = createSaveStore(window.localStorage);
      progress = saves.loadProgress();
    } catch {
      saves = null; // no storage (private mode) or save module unavailable: play without Continue
    }

    this.add
      .text(width / 2, 52, 'Choose a map', { fontFamily: UI_FONT, fontSize: '36px', color: UI_COLORS.text, fontStyle: 'bold' })
      .setOrigin(0.5);

    const cardW = 260;
    const cardH = 300;
    const gap = 30;
    const left = (width - (cardW * 3 + gap * 2)) / 2;
    const top = 110;

    CARDS.forEach((card, i) => {
      const x = left + i * (cardW + gap);
      const bg = this.add.rectangle(x, top, cardW, cardH, card.unlocked ? 0x1f262d : 0x15191d).setOrigin(0, 0);
      bg.setStrokeStyle(2, card.unlocked ? 0x4f86c6 : 0x30363d);
      const cx = x + cardW / 2;

      this.add
        .text(cx, top + 24, card.difficulty, {
          fontFamily: UI_FONT,
          fontSize: '26px',
          color: card.unlocked ? UI_COLORS.text : UI_COLORS.textDim,
          fontStyle: 'bold',
        })
        .setOrigin(0.5, 0);
      this.add
        .text(cx, top + 62, card.title, { fontFamily: UI_FONT, fontSize: '17px', color: UI_COLORS.textDim })
        .setOrigin(0.5, 0);

      // a tiny U-path thumbnail (or a padlock when locked)
      const g = this.add.graphics();
      if (card.unlocked) {
        g.fillStyle(0x2f4a2c, 1).fillRect(cx - 80, top + 96, 160, 96);
        g.fillStyle(0x7a6040, 1);
        g.fillRect(cx - 80, top + 104, 152, 10);
        g.fillRect(cx + 62, top + 104, 10, 80);
        g.fillRect(cx - 64, top + 174, 136, 10);
        g.fillStyle(0x4f86c6, 1).fillRect(cx - 76, top + 170, 14, 18);
      } else {
        g.fillStyle(0x2a3038, 1).fillRoundedRect(cx - 30, top + 128, 60, 50, 6);
        g.lineStyle(7, 0x2a3038, 1).strokeCircle(cx, top + 126, 18);
        g.fillStyle(0x15191d, 1).fillCircle(cx, top + 150, 7);
      }

      if (!card.unlocked) {
        this.add
          .text(cx, top + 214, 'Locked', { fontFamily: UI_FONT, fontSize: '18px', color: UI_COLORS.textDim })
          .setOrigin(0.5, 0);
        this.add
          .text(cx, top + 244, 'Coming in a later milestone', { fontFamily: UI_FONT, fontSize: '13px', color: '#5f6873' })
          .setOrigin(0.5, 0);
        return;
      }

      const best: StarCount = progress.bestStars[card.id] ?? 0;
      drawStars(this, cx, top + 216, best, 12);

      let hasRun = false;
      try {
        hasRun = saves !== null && saves.loadRun(card.id) !== null;
      } catch {
        hasRun = false;
      }
      const start = (resume: boolean): void => {
        const data: GameSceneData = { mapId: card.id, resume };
        this.scene.start(SCENE_KEYS.Game, data);
      };
      if (hasRun) {
        createButton(this, x + 16, top + 246, (cardW - 40) / 2, 38, 'Continue', () => start(true), { fontSize: 16 });
        createButton(this, x + 24 + (cardW - 40) / 2, top + 246, (cardW - 40) / 2, 38, 'New run', () => start(false), { fontSize: 16 });
      } else {
        createButton(this, x + 40, top + 246, cardW - 80, 38, 'Play', () => start(false), { fontSize: 18 });
      }
    });

    createButton(this, 24, height - 58, 120, 38, 'Back', () => this.scene.start(SCENE_KEYS.Menu), { fontSize: 16 });
    this.input.keyboard?.once('keydown-ESC', () => this.scene.start(SCENE_KEYS.Menu));
  }
}
