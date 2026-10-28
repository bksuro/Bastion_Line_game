/**
 * HintHighlight (agent 6): pulsing highlight on state.activeHint's tile or tower plus its message.
 * Hidden as soon as wave:started fires (core also resets activeHint to null at wave start).
 */
import type { CreateHintHighlight } from './contracts';
import { GameEvents, type HintResult, type TileCoord } from '../types';
import { COLORS, DEPTH, FONT, hexToNumber, setTextIfChanged, tileCenterPx, tileSize } from './widgets';

const ACTION_LABEL: Record<HintResult['action'], string> = {
  place: 'Place',
  upgrade: 'Upgrade',
  retarget: 'Retarget',
  sell: 'Sell',
  none: 'Tip',
};

export const createHintHighlight: CreateHintHighlight = (scene, game) => {
  const { data, events } = game.ctx;
  const ts = tileSize(game);
  const gfx = scene.add.graphics().setDepth(DEPTH.hint);
  const msg = scene.add
    .text(scene.scale.width / 2, 100, '', {
      fontFamily: FONT,
      fontSize: '15px',
      color: '#1b1f24',
      backgroundColor: '#ffe066',
      padding: { x: 10, y: 6 },
      wordWrap: { width: 560 },
      align: 'center',
    })
    .setOrigin(0.5, 0)
    .setDepth(DEPTH.hud + 1)
    .setVisible(false);

  // The hint object we hid on wave:started; stays hidden even if a stale reference lingers.
  let dismissed: HintResult | null = null;
  const offWave = events.on(GameEvents.WaveStarted, () => {
    dismissed = game.state.activeHint;
    gfx.clear();
    msg.setVisible(false);
  });
  const offShown = events.on(GameEvents.HintShown, () => {
    dismissed = null;
  });

  const targetTile = (hint: HintResult): TileCoord | null => {
    if (hint.towerId !== null) {
      const t = game.state.towers.find((tw) => tw.id === hint.towerId);
      if (t) return t.tile;
    }
    return hint.tile;
  };

  const update = (): void => {
    gfx.clear();
    const hint = game.state.activeHint;
    if (hint === null || hint === dismissed) {
      msg.setVisible(false);
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(scene.time.now / 180);
    const tile = targetTile(hint);
    if (tile !== null) {
      const c = tileCenterPx(game, tile);
      const color = hint.towerType !== null ? hexToNumber(data.towers.towers[hint.towerType].color) : COLORS.hint;
      gfx.fillStyle(COLORS.hint, 0.15 + 0.25 * pulse);
      gfx.fillRect(tile.x * ts, tile.y * ts, ts, ts);
      gfx.lineStyle(3, COLORS.hint, 0.6 + 0.4 * pulse);
      gfx.strokeRect(tile.x * ts - 2 - 3 * pulse, tile.y * ts - 2 - 3 * pulse, ts + 4 + 6 * pulse, ts + 4 + 6 * pulse);
      if (hint.action === 'place' && hint.towerType !== null) {
        gfx.fillStyle(color, 0.5);
        gfx.fillRect(tile.x * ts + 10, tile.y * ts + 10, ts - 20, ts - 20);
      }
      gfx.lineStyle(2, COLORS.hint, 0.35 + 0.3 * pulse);
      gfx.strokeCircle(c.x, c.y, ts * (0.8 + 0.2 * pulse));
    }
    let text = `${ACTION_LABEL[hint.action]}: ${hint.message}`;
    if (hint.action === 'place' && hint.towerType !== null) text = `Place ${hint.towerType}: ${hint.message}`;
    if (hint.action === 'retarget' && hint.targeting !== null) text = `Retarget to ${hint.targeting}: ${hint.message}`;
    setTextIfChanged(msg, text);
    msg.setVisible(true);
  };

  return {
    update,
    destroy() {
      offWave();
      offShown();
      gfx.destroy();
      msg.destroy();
    },
  };
};
