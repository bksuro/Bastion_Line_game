/**
 * src/ui entry module (SPEC.md section 2.1 / 2.2). Owner: agent 6 (UI & Input); aliases from ./contracts.
 * Other folders import only from this file. GameScene calls only mountGameUi.
 */
import type { MountGameUi, UiHandle } from './contracts';
import { createUiState } from './uiState';
import { createFieldView } from './FieldView';
import { createHud } from './Hud';
import { createBuildBar } from './BuildBar';
import { createPlacementPreview } from './PlacementPreview';
import { createTowerPanel } from './TowerPanel';
import { createHintHighlight } from './HintHighlight';
import { bindKeyboard } from './keyboard';
import { destroyToast } from './widgets';

export { createUiState, createFieldView, createHud, createBuildBar, createPlacementPreview, createTowerPanel, createHintHighlight, bindKeyboard };
/** Extra exports (allowed by SPEC 2.1) so the Menu / MapSelect / Debrief scenes share the same widgets. */
export { createButton, COLORS as UI_COLORS, FONT as UI_FONT, type Button } from './widgets';

/** Creates one UiState and every piece in the contract order; update/destroy fan out to all of them. */
export const mountGameUi: MountGameUi = (scene, game) => {
  const ui = createUiState();
  const pieces: UiHandle[] = [
    createFieldView(scene, game),
    createPlacementPreview(scene, game, ui),
    createHintHighlight(scene, game),
    createHud(scene, game),
    createBuildBar(scene, game, ui),
    createTowerPanel(scene, game, ui),
    bindKeyboard(scene, game, ui),
  ];
  let destroyed = false;
  return {
    update() {
      if (destroyed) return;
      for (const p of pieces) p.update();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (let i = pieces.length - 1; i >= 0; i--) pieces[i].destroy();
      destroyToast(scene);
      ui.set({ placing: null, selectedTowerId: null, hoverTile: null });
    },
  };
};
