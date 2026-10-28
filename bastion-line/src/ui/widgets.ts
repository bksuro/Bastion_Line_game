/**
 * Shared UI helpers (agent 6): theme, depths, shape-and-text buttons, toast, tile maths.
 * Phaser is used for rendering only; nothing here changes GameState.
 */
import type Phaser from 'phaser';
import type { CommandFailure, GameInstance, TileCoord } from '../types';

export const FONT = 'sans-serif';

export const COLORS = {
  text: '#e8e8e8',
  textDim: '#9aa3ad',
  textWarn: '#f2b84b',
  textBad: '#ff6b5e',
  textGood: '#7fd67f',
  panel: 0x11151a,
  panelStroke: 0x3a434d,
  button: 0x2a323b,
  buttonHover: 0x37414c,
  buttonActive: 0x3f6f9c,
  buttonDisabled: 0x1c2126,
  buildable: 0x2f4a2c,
  buildableAlt: 0x2c4629,
  blocked: 0x22272c,
  path: 0x7a6040,
  pathEdge: 0x5e4a32,
  core: 0x4f86c6,
  gridLine: 0x000000,
  valid: 0x7fd67f,
  invalid: 0xff5a4a,
  hint: 0xffe066,
  slow: 0x9fe3ff,
  hpBack: 0x30120f,
  hpFill: 0x5ad65a,
  hpLow: 0xe85a3a,
} as const;

/** Render order of the UI layers. */
export const DEPTH = {
  field: 0,
  towers: 10,
  enemies: 12,
  projectiles: 14,
  effects: 16,
  preview: 20,
  hint: 30,
  hud: 100,
  panel: 110,
  overlay: 150,
  toast: 200,
} as const;

export function hexToNumber(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  return Number.isNaN(n) ? 0xffffff : n;
}

export function tileSize(game: GameInstance): number {
  return game.ctx.data.economy.grid.tileSize;
}

/** Pixel centre of a tile. */
export function tileCenterPx(game: GameInstance, tile: TileCoord): { x: number; y: number } {
  const ts = tileSize(game);
  return { x: (tile.x + 0.5) * ts, y: (tile.y + 0.5) * ts };
}

/** Tile under a pixel position, or null when off the grid. */
export function pxToTile(game: GameInstance, x: number, y: number): TileCoord | null {
  const ts = tileSize(game);
  const tx = Math.floor(x / ts);
  const ty = Math.floor(y / ts);
  if (tx < 0 || ty < 0 || tx >= game.ctx.map.cols || ty >= game.ctx.map.rows) return null;
  return { x: tx, y: ty };
}

/** Formats a float stat for display (integers stay integers). */
export function fmt(n: number, digits = 1): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

const FAILURE_TEXT: Record<CommandFailure, string> = {
  wrong_phase: 'Only during the build phase',
  not_enough_gold: 'Not enough gold',
  tile_not_buildable: 'Cannot build there',
  tile_occupied: 'Tile already has a tower',
  unknown_tower: 'That tower no longer exists',
  max_level: 'Already at max level',
  no_hints_left: 'No hints left',
  game_over: 'The game is over',
};

export function failureText(reason: CommandFailure): string {
  return FAILURE_TEXT[reason] ?? reason;
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export interface Button {
  readonly container: Phaser.GameObjects.Container;
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
  setLabel(text: string): void;
  setEnabled(enabled: boolean): void;
  setActive(active: boolean): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

export interface ButtonOptions {
  fontSize?: number;
  /** Fill colour override (e.g. a tower colour swatch). */
  fill?: number;
  /** Clicks still fire when disabled (the click handler can then explain why). */
  clickWhenDisabled?: boolean;
}

/** A rectangle + text button. (x, y) is the top-left corner. */
export function createButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  onClick: () => void,
  opts: ButtonOptions = {},
): Button {
  const bg = scene.add.rectangle(0, 0, w, h, opts.fill ?? COLORS.button).setOrigin(0, 0);
  bg.setStrokeStyle(1, COLORS.panelStroke);
  const label = scene.add
    .text(w / 2, h / 2, text, { fontFamily: FONT, fontSize: `${opts.fontSize ?? 14}px`, color: COLORS.text, align: 'center' })
    .setOrigin(0.5);
  const container = scene.add.container(x, y, [bg, label]);
  let enabled = true;
  let active = false;
  let hover = false;

  const paint = (): void => {
    let fill: number = opts.fill ?? COLORS.button;
    if (!enabled) fill = COLORS.buttonDisabled;
    else if (active) fill = COLORS.buttonActive;
    else if (hover && opts.fill === undefined) fill = COLORS.buttonHover;
    bg.setFillStyle(fill, enabled ? 1 : 0.85);
    bg.setStrokeStyle(active ? 2 : 1, active ? 0xffffff : hover && enabled ? 0xc8d0d8 : COLORS.panelStroke);
    label.setColor(enabled ? COLORS.text : COLORS.textDim);
    label.setAlpha(enabled ? 1 : 0.7);
  };

  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => {
    hover = true;
    paint();
  });
  bg.on('pointerout', () => {
    hover = false;
    paint();
  });
  bg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
    if (pointer.rightButtonDown()) return;
    if (!enabled && !opts.clickWhenDisabled) return;
    onClick();
  });
  paint();

  return {
    container,
    bg,
    label,
    setLabel(t) {
      if (label.text !== t) label.setText(t);
    },
    setEnabled(e) {
      if (e === enabled) return;
      enabled = e;
      paint();
    },
    setActive(a) {
      if (a === active) return;
      active = a;
      paint();
    },
    setVisible(v) {
      container.setVisible(v);
      if (v) bg.setInteractive({ useHandCursor: true });
      else bg.disableInteractive();
    },
    destroy() {
      container.destroy(true);
    },
  };
}

/** Sets text only when it changed (avoids re-rasterising every frame). */
export function setTextIfChanged(t: Phaser.GameObjects.Text, value: string): void {
  if (t.text !== value) t.setText(value);
}

/* ------------------------------------------------------------------ */
/* Toast (one per scene, shared by every UI piece)                     */
/* ------------------------------------------------------------------ */

const toasts = new WeakMap<Phaser.Scene, Phaser.GameObjects.Text>();

/** Short message at the bottom centre, e.g. why a command failed. */
export function showToast(scene: Phaser.Scene, message: string, color: string = COLORS.textWarn): void {
  let t = toasts.get(scene);
  if (!t || !t.active) {
    t = scene.add
      .text(scene.scale.width / 2, scene.scale.height - 72, '', {
        fontFamily: FONT,
        fontSize: '16px',
        color,
        backgroundColor: '#000000cc',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.toast);
    toasts.set(scene, t);
  }
  scene.tweens.killTweensOf(t);
  t.setText(message).setColor(color).setAlpha(1).setVisible(true);
  scene.tweens.add({ targets: t, alpha: 0, delay: 1400, duration: 400 });
}

export function destroyToast(scene: Phaser.Scene): void {
  const t = toasts.get(scene);
  if (t) {
    scene.tweens.killTweensOf(t);
    if (t.active) t.destroy();
    toasts.delete(scene);
  }
}

/** true when the pointer is over any interactive UI object (buttons, panels). */
export function pointerOverUi(over: Phaser.GameObjects.GameObject[] | undefined): boolean {
  return Array.isArray(over) && over.length > 0;
}
