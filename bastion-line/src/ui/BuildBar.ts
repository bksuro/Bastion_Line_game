/**
 * BuildBar (agent 6): the 4 tower buttons with cost (bottom-left). Greyed live on gold:changed when
 * unaffordable; a click toggles ui.placing for that tower type.
 */
import type Phaser from 'phaser';
import type { CreateBuildBar, UiState } from './contracts';
import { GameEvents, GamePhase, TOWER_TYPES, type GameInstance, type TowerType } from '../types';
import { COLORS, DEPTH, FONT, createButton, failureText, hexToNumber, showToast, type Button } from './widgets';

export const TOWER_HOTKEYS: Record<TowerType, string> = { Arrow: 'Q', Frost: 'W', Cannon: 'E', Sniper: 'R' };

/** Toggles placement of `type`, refusing (with a toast) when it is unaffordable. Shared with keyboard.ts. */
export function togglePlacing(scene: Phaser.Scene, game: GameInstance, ui: UiState, type: TowerType): void {
  if (ui.placing === type) {
    ui.set({ placing: null });
    return;
  }
  const st = game.state;
  if (st.phase === GamePhase.Won || st.phase === GamePhase.Lost) return;
  if (st.gold < game.ctx.data.towers.towers[type].cost) {
    showToast(scene, failureText('not_enough_gold'), COLORS.textBad);
    return;
  }
  ui.set({ placing: type, selectedTowerId: null });
}

export const createBuildBar: CreateBuildBar = (scene, game, ui) => {
  const { data, events } = game.ctx;
  const H = scene.scale.height;
  // Slim bar: it covers only the lower half of the bottom tile row, so those tiles stay clickable above it.
  const bw = 132;
  const bh = 26;
  const gap = 6;
  const y = H - bh - 3;
  const x0 = 6;

  // Not interactive: clicks between the buttons fall through to the field.
  const bg = scene.add
    .rectangle(0, y - 3, x0 + TOWER_TYPES.length * (bw + gap), bh + 6, COLORS.panel, 0.7)
    .setOrigin(0, 0)
    .setDepth(DEPTH.hud);

  const buttons = new Map<TowerType, Button>();
  TOWER_TYPES.forEach((type, i) => {
    const def = data.towers.towers[type];
    const b = createButton(
      scene,
      x0 + i * (bw + gap),
      y,
      bw,
      bh,
      `${TOWER_HOTKEYS[type]}  ${def.name}  ${def.cost}g`,
      () => togglePlacing(scene, game, ui, type),
      { clickWhenDisabled: true, fontSize: 13 },
    );
    b.label.setX(bw / 2 + 6);
    b.container.add(scene.add.rectangle(8, bh / 2, 8, bh - 8, hexToNumber(def.color)).setOrigin(0, 0.5));
    b.container.setDepth(DEPTH.hud + 1);
    buttons.set(type, b);
  });

  const tip = scene.add
    .text(x0 + TOWER_TYPES.length * (bw + gap) + 4, y + bh / 2, '', { fontFamily: FONT, fontSize: '12px', color: COLORS.textDim, backgroundColor: '#11151acc', padding: { x: 4, y: 2 } })
    .setOrigin(0, 0.5)
    .setDepth(DEPTH.hud);

  const refresh = (): void => {
    const st = game.state;
    const over = st.phase === GamePhase.Won || st.phase === GamePhase.Lost;
    for (const [type, b] of buttons) {
      b.setEnabled(!over && st.gold >= data.towers.towers[type].cost);
      b.setActive(ui.placing === type);
    }
    const t = ui.placing === null ? '' : `Click a tile to place - Shift: keep placing - Esc: cancel`;
    if (tip.text !== t) tip.setText(t);
    tip.setVisible(t !== '');
  };

  const offGold = events.on(GameEvents.GoldChanged, refresh);
  const offPhase = events.on(GameEvents.PhaseChanged, refresh);
  const offUi = ui.onChange(refresh);
  refresh();

  return {
    update: refresh,
    destroy() {
      offGold();
      offPhase();
      offUi();
      for (const b of buttons.values()) b.destroy();
      bg.destroy();
      tip.destroy();
    },
  };
};
