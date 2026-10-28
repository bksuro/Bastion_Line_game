/**
 * Hud (agent 6): gold, core HP, wave N/20, next-wave preview + narrator caption, boss taunt,
 * build timer with the early-start bonus, hints left, hint / start-wave / speed / pause buttons.
 * Reads game.state every frame; all actions go through game.commands.
 */
import type Phaser from 'phaser';
import type { CreateHud } from './contracts';
import { GamePhase, type EnemyType, type GameInstance, type GameSpeed, type WavePlan } from '../types';
import { earlyStartBonus } from '../economy';
import { COLORS, DEPTH, FONT, createButton, failureText, setTextIfChanged, showToast, type Button } from './widgets';

function planSummary(plan: WavePlan): string {
  const counts = new Map<EnemyType, number>();
  for (const g of plan.groups) counts.set(g.enemy, (counts.get(g.enemy) ?? 0) + g.count);
  return [...counts].map(([enemy, n]) => `${n} ${enemy}`).join(', ');
}

/** Requests a hint and toasts the reason when the command fails. Shared with the keyboard binding. */
export function requestHintWithFeedback(scene: Phaser.Scene, game: GameInstance): void {
  void game.commands.requestHint().then((res) => {
    if (!res.ok && scene.sys.isActive()) showToast(scene, failureText(res.reason), COLORS.textBad);
  });
}

export const createHud: CreateHud = (scene, game) => {
  const { data } = game.ctx;
  const W = scene.scale.width;
  const H = scene.scale.height;
  const waveCount = data.economy.waveCount;

  const bar = scene.add.rectangle(0, 0, W, 30, COLORS.panel, 0.85).setOrigin(0, 0).setDepth(DEPTH.hud);
  const stats = scene.add
    .text(10, 6, '', { fontFamily: FONT, fontSize: '15px', color: COLORS.text })
    .setDepth(DEPTH.hud + 1);
  const preview = scene.add
    .text(8, 34, '', {
      fontFamily: FONT,
      fontSize: '13px',
      color: COLORS.text,
      backgroundColor: '#11151add',
      padding: { x: 6, y: 3 },
      wordWrap: { width: W - 16 },
    })
    .setDepth(DEPTH.hud);
  const caption = scene.add
    .text(8, 58, '', {
      fontFamily: FONT,
      fontSize: '13px',
      fontStyle: 'italic',
      color: '#c9d4de',
      backgroundColor: '#11151acc',
      padding: { x: 6, y: 3 },
      wordWrap: { width: W - 16 },
    })
    .setDepth(DEPTH.hud);
  const taunt = scene.add
    .text(W / 2, 150, '', {
      fontFamily: FONT,
      fontSize: '20px',
      fontStyle: 'italic',
      color: '#ffd54a',
      backgroundColor: '#2a0f2fdd',
      padding: { x: 12, y: 8 },
      wordWrap: { width: 640 },
      align: 'center',
    })
    .setOrigin(0.5)
    .setDepth(DEPTH.hud)
    .setVisible(false);
  const pauseShade = scene.add.rectangle(0, 0, W, H, 0x000000, 0.45).setOrigin(0, 0).setDepth(DEPTH.hud - 1).setVisible(false);
  const pauseText = scene.add
    .text(W / 2, H / 2, 'PAUSED\nEsc or the Resume button to continue', {
      fontFamily: FONT,
      fontSize: '28px',
      color: COLORS.text,
      align: 'center',
    })
    .setOrigin(0.5)
    .setDepth(DEPTH.overlay)
    .setVisible(false);

  /* ---- buttons, right-aligned in the top bar ---- */
  const buttons: Button[] = [];
  const bh = 24;
  const by = 3;
  let x = W - 6;
  const place = (w: number): number => {
    x -= w;
    const left = x;
    x -= 6;
    return left;
  };
  const pauseBtn = createButton(scene, place(76), by, 76, bh, 'Pause', () => {
    game.commands.togglePause();
  });
  const speedBtns = new Map<GameSpeed, Button>();
  for (const s of [...data.economy.gameSpeeds].reverse()) {
    const b = createButton(scene, place(36), by, 36, bh, `x${s}`, () => {
      game.commands.setSpeed(s);
    });
    speedBtns.set(s, b);
  }
  const startBtn = createButton(
    scene,
    place(118),
    by,
    118,
    bh,
    'Start wave',
    () => {
      const res = game.commands.startWave();
      if (!res.ok) showToast(scene, failureText(res.reason), COLORS.textBad);
    },
    { clickWhenDisabled: false },
  );
  const hintBtn = createButton(scene, place(86), by, 86, bh, 'Hint', () => requestHintWithFeedback(scene, game));
  buttons.push(pauseBtn, ...speedBtns.values(), startBtn, hintBtn);
  for (const b of buttons) b.container.setDepth(DEPTH.hud + 2);

  const update = (): void => {
    const st = game.state;
    const inBuild = st.phase === GamePhase.Build;
    const over = st.phase === GamePhase.Won || st.phase === GamePhase.Lost;

    setTextIfChanged(
      stats,
      `Gold ${st.gold}    Core ${st.coreHp}/${st.coreHpMax}    Wave ${Math.min(st.wave, waveCount)}/${waveCount}    Hints ${st.hintsLeft}`,
    );
    stats.setColor(st.coreHp <= st.coreHpMax * 0.3 ? COLORS.textWarn : COLORS.text);

    /* preview / status line */
    let line = '';
    if (inBuild) {
      const plan = st.currentPlan;
      line = plan ? `Next: wave ${st.wave} - ${planSummary(plan)}. ${plan.previewText}` : `Next: wave ${st.wave}`;
      if (st.buildTimerMs === null) line += '   |   Press Space to start';
      else {
        const secs = Math.ceil(st.buildTimerMs / 1000);
        const bonus = earlyStartBonus(data, st.buildTimerMs);
        line += `   |   Auto-start in ${secs}s` + (bonus > 0 ? ` (Space now: +${bonus} gold)` : '');
      }
    } else if (st.phase === GamePhase.Combat) {
      const alive = st.enemies.filter((e) => e.alive).length;
      const left = st.spawn ? st.spawn.totalToSpawn - st.spawn.totalSpawned + alive : alive;
      line = `Wave ${st.wave} in progress - ${left} enemies left` + (st.currentPlan ? ` - ${planSummary(st.currentPlan)}` : '');
    } else if (st.phase === GamePhase.Won) {
      line = 'Victory! The keep stands.';
    } else {
      line = 'Defeat. The keep has fallen.';
    }
    setTextIfChanged(preview, line);
    preview.setColor(inBuild && st.buildTimerMs !== null && st.buildTimerMs <= 5000 ? COLORS.textWarn : COLORS.text);

    /* narrator caption (intro on wave 1) */
    let cap = '';
    if (st.narration && !over) {
      const c = st.narration.captions.find((cc) => cc.wave === st.wave);
      cap = c ? c.text : '';
      if (st.wave === 1 && inBuild) cap = cap ? `${st.narration.intro}  ${cap}` : st.narration.intro;
    }
    setTextIfChanged(caption, cap);
    caption.setVisible(cap !== '');
    caption.setY(preview.y + preview.height + 4);

    /* boss taunt */
    const tauntText = st.activeBossTaunt;
    if (tauntText && st.phase === GamePhase.Combat) {
      setTextIfChanged(taunt, `"${tauntText}"`);
      taunt.setVisible(true);
    } else taunt.setVisible(false);

    /* buttons */
    hintBtn.setLabel(`Hint (${st.hintsLeft})`);
    hintBtn.setEnabled(inBuild && st.hintsLeft > 0);
    startBtn.setEnabled(inBuild);
    const bonusNow = inBuild ? earlyStartBonus(data, st.buildTimerMs) : 0;
    startBtn.setLabel(inBuild && bonusNow > 0 ? `Start (+${bonusNow}g)` : 'Start wave');
    for (const [s, b] of speedBtns) {
      b.setActive(st.speed === s);
      b.setEnabled(!over);
    }
    pauseBtn.setLabel(st.paused ? 'Resume' : 'Pause');
    pauseBtn.setActive(st.paused);
    pauseBtn.setEnabled(!over);
    pauseShade.setVisible(st.paused && !over);
    pauseText.setVisible(st.paused && !over);
  };

  update();

  return {
    update,
    destroy() {
      for (const b of buttons) b.destroy();
      bar.destroy();
      stats.destroy();
      preview.destroy();
      caption.destroy();
      taunt.destroy();
      pauseShade.destroy();
      pauseText.destroy();
    },
  };
};
