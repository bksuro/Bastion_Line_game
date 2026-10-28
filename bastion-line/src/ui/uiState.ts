/**
 * UiState - UI-local selection state (SPEC.md section 2.2). Owner: agent 6 (UI & Input).
 * Plain TypeScript, never stored in GameState and never saved.
 */
import type { CreateUiState, UiState } from './contracts';
import type { TileCoord } from '../types';

function sameTile(a: TileCoord | null, b: TileCoord | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y;
}

export const createUiState: CreateUiState = () => {
  const listeners = new Set<() => void>();

  const ui: UiState = {
    placing: null,
    selectedTowerId: null,
    hoverTile: null,
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(patch) {
      let changed = false;
      if (patch.placing !== undefined && patch.placing !== ui.placing) {
        ui.placing = patch.placing;
        changed = true;
      }
      if (patch.selectedTowerId !== undefined && patch.selectedTowerId !== ui.selectedTowerId) {
        ui.selectedTowerId = patch.selectedTowerId;
        changed = true;
      }
      if (patch.hoverTile !== undefined && !sameTile(patch.hoverTile, ui.hoverTile)) {
        ui.hoverTile = patch.hoverTile === null ? null : { x: patch.hoverTile.x, y: patch.hoverTile.y };
        changed = true;
      }
      if (!changed) return;
      for (const listener of [...listeners]) listener();
    },
  };
  return ui;
};
