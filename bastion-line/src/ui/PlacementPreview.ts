/**
 * PlacementPreview (agent 6): tracks the hovered tile (ui.hoverTile), draws the ghost tower and its
 * range circle (red when canPlace fails), places with commands.placeTower on click and cancels on
 * right-click. With nothing being placed, a click on a tower selects it (opens TowerPanel) and a
 * click on empty ground closes the panel. Clicks on UI buttons are ignored here.
 */
import type Phaser from 'phaser';
import type { CreatePlacementPreview } from './contracts';
import { GamePhase, type TileCoord } from '../types';
import { canPlace, getTowerStats } from '../towers';
import { COLORS, DEPTH, failureText, hexToNumber, pointerOverUi, pxToTile, showToast, tileCenterPx, tileSize } from './widgets';

export const createPlacementPreview: CreatePlacementPreview = (scene, game, ui) => {
  const { data } = game.ctx;
  const ts = tileSize(game);
  const gfx = scene.add.graphics().setDepth(DEPTH.preview);
  scene.input.mouse?.disableContextMenu();

  const towerAt = (tile: TileCoord): string | null => {
    const t = game.state.towers.find((tw) => tw.tile.x === tile.x && tw.tile.y === tile.y);
    return t ? t.id : null;
  };

  const onMove = (pointer: Phaser.Input.Pointer): void => {
    ui.set({ hoverTile: pxToTile(game, pointer.worldX, pointer.worldY) });
  };

  const onOut = (): void => {
    ui.set({ hoverTile: null });
  };

  const onDown = (pointer: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void => {
    if (pointer.rightButtonDown()) {
      if (ui.placing !== null) ui.set({ placing: null });
      else if (ui.selectedTowerId !== null) ui.set({ selectedTowerId: null });
      return;
    }
    if (pointerOverUi(over)) return;
    const phase = game.state.phase;
    if (phase === GamePhase.Won || phase === GamePhase.Lost) return;
    const tile = pxToTile(game, pointer.worldX, pointer.worldY);
    if (tile === null) return;
    ui.set({ hoverTile: tile });

    if (ui.placing !== null) {
      const res = game.commands.placeTower(ui.placing, tile);
      if (res.ok) {
        // Shift+click keeps placing the same type.
        const shift = (pointer.event as MouseEvent | undefined)?.shiftKey === true;
        const placedId = towerAt(tile);
        if (!shift) ui.set({ placing: null, selectedTowerId: placedId });
      } else {
        showToast(scene, failureText(res.reason), COLORS.textBad);
      }
      return;
    }

    ui.set({ selectedTowerId: towerAt(tile) });
  };

  scene.input.on('pointermove', onMove);
  scene.input.on('gameout', onOut);
  scene.input.on('pointerdown', onDown);

  const update = (): void => {
    gfx.clear();
    const tile = ui.hoverTile;
    const state = game.state;

    // Range ring of the selected tower (when not placing).
    if (ui.placing === null && ui.selectedTowerId !== null) {
      const sel = state.towers.find((t) => t.id === ui.selectedTowerId);
      if (sel) {
        const stats = getTowerStats(data, sel.type, sel.level);
        const c = tileCenterPx(game, sel.tile);
        gfx.fillStyle(0xffffff, 0.06);
        gfx.fillCircle(c.x, c.y, stats.range * ts);
        gfx.lineStyle(2, 0xffffff, 0.55);
        gfx.strokeCircle(c.x, c.y, stats.range * ts);
        gfx.lineStyle(2, 0xffffff, 0.9);
        gfx.strokeRect(sel.tile.x * ts + 1, sel.tile.y * ts + 1, ts - 2, ts - 2);
      }
    }

    if (tile === null) return;

    if (ui.placing === null) {
      // plain hover outline on interactive tiles
      if (towerAt(tile) !== null) {
        gfx.lineStyle(1, 0xffffff, 0.5);
        gfx.strokeRect(tile.x * ts + 1, tile.y * ts + 1, ts - 2, ts - 2);
      }
      return;
    }

    const type = ui.placing;
    const def = data.towers.towers[type];
    const stats = getTowerStats(data, type, 1);
    const ok = canPlace(state, game.ctx, type, tile).ok;
    const ring = ok ? COLORS.valid : COLORS.invalid;
    const c = tileCenterPx(game, tile);
    gfx.fillStyle(ring, 0.1);
    gfx.fillCircle(c.x, c.y, stats.range * ts);
    gfx.lineStyle(2, ring, 0.8);
    gfx.strokeCircle(c.x, c.y, stats.range * ts);
    gfx.fillStyle(ok ? hexToNumber(def.color) : COLORS.invalid, 0.55);
    gfx.fillRect(tile.x * ts + 6, tile.y * ts + 6, ts - 12, ts - 12);
    gfx.lineStyle(2, ring, 1);
    gfx.strokeRect(tile.x * ts + 2, tile.y * ts + 2, ts - 4, ts - 4);
  };

  return {
    update,
    destroy() {
      scene.input.off('pointermove', onMove);
      scene.input.off('gameout', onOut);
      scene.input.off('pointerdown', onDown);
      gfx.destroy();
    },
  };
};
