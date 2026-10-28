/**
 * TowerPanel (agent 6): for ui.selectedTowerId shows stats, upgrade cost (upgradeCost), sell value
 * (sellRefund) and the targeting mode buttons. Every action goes through game.commands.
 */
import type Phaser from 'phaser';
import type { CreateTowerPanel, UiState } from './contracts';
import { GameEvents, GamePhase, TARGETING_MODES, type GameInstance, type TargetingMode, type TowerInstance } from '../types';
import { getTowerStats, sellRefund, upgradeCost } from '../towers';
import { COLORS, DEPTH, FONT, createButton, failureText, fmt, hexToNumber, setTextIfChanged, showToast, type Button } from './widgets';

function selectedTower(game: GameInstance, ui: UiState): TowerInstance | null {
  if (ui.selectedTowerId === null) return null;
  return game.state.towers.find((t) => t.id === ui.selectedTowerId) ?? null;
}

/* ---- actions shared with keyboard.ts (U / S / T) ---- */

export function upgradeSelected(scene: Phaser.Scene, game: GameInstance, ui: UiState): void {
  const t = selectedTower(game, ui);
  if (!t) return;
  const res = game.commands.upgradeTower(t.id);
  if (!res.ok) showToast(scene, failureText(res.reason), COLORS.textBad);
}

export function sellSelected(scene: Phaser.Scene, game: GameInstance, ui: UiState): void {
  const t = selectedTower(game, ui);
  if (!t) return;
  const res = game.commands.sellTower(t.id);
  if (res.ok) ui.set({ selectedTowerId: null });
  else showToast(scene, failureText(res.reason), COLORS.textBad);
}

export function setSelectedTargeting(scene: Phaser.Scene, game: GameInstance, ui: UiState, mode: TargetingMode): void {
  const t = selectedTower(game, ui);
  if (!t) return;
  const res = game.commands.setTargeting(t.id, mode);
  if (!res.ok) showToast(scene, failureText(res.reason), COLORS.textBad);
}

export function cycleSelectedTargeting(scene: Phaser.Scene, game: GameInstance, ui: UiState): void {
  const t = selectedTower(game, ui);
  if (!t) return;
  const i = TARGETING_MODES.indexOf(t.targeting);
  setSelectedTargeting(scene, game, ui, TARGETING_MODES[(i + 1) % TARGETING_MODES.length]);
}

/* ---- panel ---- */

const PANEL_W = 236;
const PANEL_H = 268;

export const createTowerPanel: CreateTowerPanel = (scene, game, ui) => {
  const { data, events } = game.ctx;
  const ts = data.economy.grid.tileSize;
  const W = scene.scale.width;

  const bg = scene.add.rectangle(0, 0, PANEL_W, PANEL_H, COLORS.panel, 0.94).setOrigin(0, 0);
  bg.setStrokeStyle(2, COLORS.panelStroke);
  bg.setInteractive(); // clicks on the panel never reach the field
  const swatch = scene.add.rectangle(12, 14, 14, 14, 0xffffff).setOrigin(0, 0);
  const title = scene.add.text(34, 11, '', { fontFamily: FONT, fontSize: '17px', color: COLORS.text, fontStyle: 'bold' });
  const body = scene.add.text(12, 38, '', { fontFamily: FONT, fontSize: '13px', color: COLORS.text, lineSpacing: 3 });
  const targetLabel = scene.add.text(12, 178, 'Targeting (T)', { fontFamily: FONT, fontSize: '12px', color: COLORS.textDim });

  const container = scene.add.container(0, 0, [bg, swatch, title, body, targetLabel]).setDepth(DEPTH.panel).setVisible(false);

  const buttons: Button[] = [];
  const add = (b: Button): Button => {
    container.add(b.container);
    buttons.push(b);
    return b;
  };
  const closeBtn = add(createButton(scene, PANEL_W - 30, 8, 22, 22, 'x', () => ui.set({ selectedTowerId: null })));
  const targetBtns = new Map<TargetingMode, Button>();
  TARGETING_MODES.forEach((mode, i) => {
    const bw = (PANEL_W - 24 - 8) / 3;
    targetBtns.set(mode, add(createButton(scene, 12 + i * (bw + 4), 196, bw, 24, mode, () => setSelectedTargeting(scene, game, ui, mode), { fontSize: 12 })));
  });
  const upBtn = add(
    createButton(scene, 12, 230, (PANEL_W - 28) / 2, 28, 'Upgrade', () => upgradeSelected(scene, game, ui), { fontSize: 13, clickWhenDisabled: true }),
  );
  const sellBtn = add(
    createButton(scene, 16 + (PANEL_W - 28) / 2, 230, (PANEL_W - 28) / 2, 28, 'Sell', () => sellSelected(scene, game, ui), { fontSize: 13, clickWhenDisabled: true }),
  );

  const place = (t: TowerInstance): void => {
    // Open on the far side of the field from the tower, inside the U so it hides as few useful tiles as possible.
    const towerPx = (t.tile.x + 0.5) * ts;
    const x = towerPx < W / 2 ? Math.min(W - PANEL_W - 2.2 * ts, towerPx + 3 * ts) : Math.max(1.5 * ts, towerPx - 3 * ts - PANEL_W);
    const y = Math.round(2.5 * ts);
    container.setPosition(Math.round(Math.max(4, x)), y);
  };

  let lastTowerId: string | null = null;

  const update = (): void => {
    const t = selectedTower(game, ui);
    if (!t) {
      if (ui.selectedTowerId !== null) ui.set({ selectedTowerId: null }); // tower vanished (sold elsewhere)
      container.setVisible(false);
      lastTowerId = null;
      return;
    }
    if (t.id !== lastTowerId) {
      place(t);
      lastTowerId = t.id;
    }
    container.setVisible(true);
    const st = game.state;
    const def = data.towers.towers[t.type];
    const stats = getTowerStats(data, t.type, t.level);
    const cost = upgradeCost(data, t.type, t.level);
    const refund = sellRefund(data, t.totalSpent);
    const inBuild = st.phase === GamePhase.Build;
    swatch.setFillStyle(hexToNumber(def.color));
    setTextIfChanged(title, `${def.name}  Lv ${t.level}/${data.towers.maxLevel}`);

    const dps = stats.fireRateMs > 0 ? (stats.damage * 1000) / stats.fireRateMs : 0;
    const lines = [
      `Damage ${fmt(stats.damage)}   Range ${fmt(stats.range, 2)}`,
      `Fires every ${fmt(stats.fireRateMs / 1000, 2)}s   DPS ${fmt(dps)}`,
      `Air: ${stats.canHitAir ? 'yes' : 'no'}` + (stats.splashRadius > 0 ? `   Splash ${fmt(stats.splashRadius, 2)}` : ''),
    ];
    if (stats.slowPct > 0) lines.push(`Slow ${stats.slowPct}% for ${fmt(stats.slowMs / 1000, 2)}s`);
    lines.push(`Kills ${t.kills}   Damage dealt ${Math.round(t.damageDealt)}`);
    if (cost !== null) {
      const next = getTowerStats(data, t.type, (t.level + 1) as TowerInstance['level']);
      lines.push(`Next: dmg ${fmt(next.damage)}, range ${fmt(next.range, 2)}, ${fmt(next.fireRateMs / 1000, 2)}s`);
    } else lines.push('Fully upgraded');
    setTextIfChanged(body, lines.join('\n'));

    for (const [mode, b] of targetBtns) b.setActive(t.targeting === mode);

    upBtn.setLabel(cost === null ? 'Max level' : `Upgrade (U) ${cost}g`);
    upBtn.setEnabled(cost !== null && inBuild && st.gold >= cost);
    sellBtn.setLabel(`Sell (S) +${refund}g`);
    sellBtn.setEnabled(inBuild);
    closeBtn.setEnabled(true);
  };

  const offSold = events.on(GameEvents.TowerSold, (e) => {
    if (e.towerId === ui.selectedTowerId) ui.set({ selectedTowerId: null });
  });
  const offUi = ui.onChange(update);
  update();

  return {
    update,
    destroy() {
      offSold();
      offUi();
      for (const b of buttons) b.destroy();
      container.destroy(true);
    },
  };
};
