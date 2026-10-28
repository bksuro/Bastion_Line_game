/**
 * keyboard (agent 6): the key map of SPEC.md section 6.
 *   H hint, Space start wave, 1/2/3 speed, Esc cancel placement / close panel / toggle pause,
 *   Q/W/E/R pick Arrow/Frost/Cannon/Sniper, U/S/T upgrade/sell/cycle targeting of the selected tower.
 * (Right-click cancel is handled by PlacementPreview.)
 */
import type { BindKeyboard } from './contracts';
import { GamePhase, type GameSpeed, type TowerType } from '../types';
import { togglePlacing } from './BuildBar';
import { requestHintWithFeedback } from './Hud';
import { cycleSelectedTargeting, sellSelected, upgradeSelected } from './TowerPanel';
import { COLORS, failureText, showToast } from './widgets';

const PLACE_KEYS: Record<string, TowerType> = { KeyQ: 'Arrow', KeyW: 'Frost', KeyE: 'Cannon', KeyR: 'Sniper' };
const SPEED_KEYS: Record<string, GameSpeed> = { Digit1: 1, Digit2: 2, Digit3: 3, Numpad1: 1, Numpad2: 2, Numpad3: 3 };

export const bindKeyboard: BindKeyboard = (scene, game, ui) => {
  const keyboard = scene.input.keyboard;
  if (!keyboard) return { update() {}, destroy() {} };
  keyboard.addCapture('SPACE');

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const st = game.state;
    const over = st.phase === GamePhase.Won || st.phase === GamePhase.Lost;
    if (over) return;
    const code = ev.code;

    if (code === 'Escape') {
      if (ui.placing !== null) ui.set({ placing: null });
      else if (ui.selectedTowerId !== null) ui.set({ selectedTowerId: null });
      else game.commands.togglePause();
      return;
    }
    if (code === 'Space') {
      const res = game.commands.startWave();
      if (!res.ok) showToast(scene, failureText(res.reason), COLORS.textBad);
      return;
    }
    if (code === 'KeyH') {
      requestHintWithFeedback(scene, game);
      return;
    }
    const speed = SPEED_KEYS[code];
    if (speed !== undefined) {
      if (game.ctx.data.economy.gameSpeeds.includes(speed)) game.commands.setSpeed(speed);
      return;
    }
    const type = PLACE_KEYS[code];
    if (type !== undefined) {
      togglePlacing(scene, game, ui, type);
      return;
    }
    if (code === 'KeyU') upgradeSelected(scene, game, ui);
    else if (code === 'KeyS') sellSelected(scene, game, ui);
    else if (code === 'KeyT') cycleSelectedTargeting(scene, game, ui);
  };

  keyboard.on('keydown', onKey);

  return {
    update() {},
    destroy() {
      keyboard.off('keydown', onKey);
      keyboard.removeCapture('SPACE');
    },
  };
};
