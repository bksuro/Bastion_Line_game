/**
 * DebriefScene (scene key SCENE_KEYS.Debrief). Owner: agent 6 (UI & Input).
 * Receives DebriefSceneData from GameScene, shows the result and stars, calls
 * data.agents.getDebrief(data.input) exactly once and shows the Match Analyst's result.
 * Retry starts a fresh run of the same map; Back returns to MapSelect.
 */
import Phaser from 'phaser';
import { SCENE_KEYS, type DebriefResult, type DebriefSceneData, type GameSceneData } from '../types';
import { createButton, UI_COLORS, UI_FONT } from '../ui';
import { drawStars } from './MapSelectScene';

export class DebriefScene extends Phaser.Scene {
  private payload: DebriefSceneData | null = null;
  private alive = false;

  constructor() {
    super({ key: SCENE_KEYS.Debrief });
  }

  init(data: DebriefSceneData | undefined): void {
    this.payload = data && data.input && data.agents ? data : null;
  }

  create(): void {
    const { width, height } = this.scale;
    this.alive = true;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.alive = false;
    });

    const d = this.payload;
    const won = d?.result === 'win';
    this.add
      .text(width / 2, 44, d === null ? 'Debrief' : won ? 'Victory' : 'Defeat', {
        fontFamily: UI_FONT,
        fontSize: '44px',
        fontStyle: 'bold',
        color: d === null ? UI_COLORS.text : won ? '#ffd54a' : UI_COLORS.textBad,
      })
      .setOrigin(0.5);
    drawStars(this, width / 2, 102, d?.stars ?? 0, 18);

    if (d !== null) {
      const inp = d.input;
      this.add
        .text(
          width / 2,
          132,
          `${inp.difficulty}  -  waves cleared ${inp.waves_cleared}  -  core HP ${inp.final_core_hp}  -  towers ${inp.final_towers.length}  -  hints used ${inp.hints_used.length}`,
          { fontFamily: UI_FONT, fontSize: '15px', color: UI_COLORS.textDim },
        )
        .setOrigin(0.5, 0);
    }

    const panel = this.add.rectangle(width / 2, 166, Math.min(760, width - 40), 300, 0x11151a, 0.95).setOrigin(0.5, 0);
    panel.setStrokeStyle(2, 0x3a434d);
    const body = this.add
      .text(width / 2 - panel.width / 2 + 20, 182, d === null ? 'No match data.' : 'The Match Analyst is reviewing your defense...', {
        fontFamily: UI_FONT,
        fontSize: '16px',
        color: UI_COLORS.text,
        wordWrap: { width: panel.width - 40 },
        lineSpacing: 5,
      })
      .setOrigin(0, 0);

    const mapId = d?.mapId ?? 'easy';
    const retry = (): void => {
      const data: GameSceneData = { mapId, resume: false };
      this.scene.start(SCENE_KEYS.Game, data);
    };
    createButton(this, width / 2 - 170, height - 70, 160, 44, 'Retry', retry, { fontSize: 18 });
    createButton(this, width / 2 + 10, height - 70, 160, 44, 'Back to maps', () => this.scene.start(SCENE_KEYS.MapSelect), { fontSize: 18 });
    this.input.keyboard?.once('keydown-ENTER', retry);

    if (d === null) return;
    // Called exactly once per Debrief visit (SPEC 2.2). AgentService methods never reject; guard anyway.
    d.agents
      .getDebrief(d.input)
      .then((res) => {
        if (this.alive) body.setText(DebriefScene.format(res.data));
      })
      .catch(() => {
        if (this.alive) body.setText('The debrief is unavailable right now.');
      });
  }

  private static format(r: DebriefResult): string {
    const lines: string[] = [r.headline, ''];
    if (r.held.length > 0) {
      lines.push('What held:');
      for (const h of r.held) lines.push(`  + ${h}`);
      lines.push('');
    }
    if (r.damage.length > 0) {
      lines.push('Where the core took damage:');
      for (const dm of r.damage) lines.push(`  - Wave ${dm.wave}, ${dm.enemy}: ${dm.coreDamage} HP. ${dm.cause}`);
      lines.push('');
    }
    lines.push(`Try next: ${r.tryNext}`);
    return lines.join('\n');
  }
}
