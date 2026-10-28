/**
 * Bastion Line - UI entry-point contracts (phase 1, Spec Writer). TYPE-ONLY file.
 *
 * - Owned by the Spec Writer; the UI & Input agent (6) implements these in src/ui, the Integrator (7)
 *   calls them from src/scenes/GameScene.ts. Neither may edit this file (request changes via the Integrator).
 * - Phaser is allowed here and in src/ui only. src/types.ts stays Phaser-free.
 * - Implementations live in the files named on each alias and are re-exported by src/ui/index.ts
 *   (export const createHud: CreateHud = ...).
 * - UI code reads ctx/state, listens on ctx.events, and changes the game ONLY through game.commands.
 */
import type Phaser from 'phaser';
import type { GameInstance, TileCoord, TowerType } from '../types';

/** Everything a mounted UI piece returns. update() is called once per rendered frame by GameScene. */
export interface UiHandle {
  update(): void;
  destroy(): void;
}

/**
 * UI-local selection state shared by the UI pieces (never stored in GameState, never saved).
 * Created by createUiState and passed to every piece that needs it.
 */
export interface UiState {
  /** Tower type picked in the build bar for placement; null = not placing. */
  placing: TowerType | null;
  /** Placed tower whose panel is open; null = none. */
  selectedTowerId: string | null;
  /** Tile under the pointer (for the ghost and range preview); null = off-grid. */
  hoverTile: TileCoord | null;
  /** Notifies every piece after any field above changes. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
  /** Sets fields and fires onChange listeners. */
  set(patch: Partial<Pick<UiState, 'placing' | 'selectedTowerId' | 'hoverTile'>>): void;
}

/** src/ui/uiState.ts */
export type CreateUiState = () => UiState;

/** src/ui/FieldView.ts: draws grid, path, core, towers, enemies (HP bars, slow tint), projectiles as shapes. */
export type CreateFieldView = (scene: Phaser.Scene, game: GameInstance) => UiHandle;

/** src/ui/Hud.ts: gold, core HP, wave N/20, next-wave preview + narrator caption, build timer, hint counter, speed and pause buttons. */
export type CreateHud = (scene: Phaser.Scene, game: GameInstance) => UiHandle;

/** src/ui/BuildBar.ts: 4 tower buttons with cost, greyed when unaffordable (live on gold:changed); sets ui.placing. */
export type CreateBuildBar = (scene: Phaser.Scene, game: GameInstance, ui: UiState) => UiHandle;

/** src/ui/PlacementPreview.ts: ghost tower + range circle on ui.hoverTile (red if canPlace fails); click places via commands.placeTower; right-click cancels. */
export type CreatePlacementPreview = (scene: Phaser.Scene, game: GameInstance, ui: UiState) => UiHandle;

/** src/ui/TowerPanel.ts: for ui.selectedTowerId: stats, upgrade cost (upgradeCost), sell value (sellRefund), targeting mode buttons. */
export type CreateTowerPanel = (scene: Phaser.Scene, game: GameInstance, ui: UiState) => UiHandle;

/** src/ui/HintHighlight.ts: pulsing highlight on state.activeHint's tile or tower plus its message; cleared on wave:started. */
export type CreateHintHighlight = (scene: Phaser.Scene, game: GameInstance) => UiHandle;

/** src/ui/keyboard.ts: the key map of SPEC.md section 6 (H, Space, 1/2/3, Esc, Q/W/E/R, U/S/T). */
export type BindKeyboard = (scene: Phaser.Scene, game: GameInstance, ui: UiState) => UiHandle;

/**
 * src/ui/index.ts: creates one UiState and every piece above, in this order:
 * FieldView, PlacementPreview, HintHighlight, Hud, BuildBar, TowerPanel, keyboard.
 * GameScene calls only this: `const ui = mountGameUi(this, game)`, then `ui.update()` each frame
 * and `ui.destroy()` on shutdown.
 */
export type MountGameUi = (scene: Phaser.Scene, game: GameInstance) => UiHandle;
