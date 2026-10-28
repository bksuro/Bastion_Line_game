/**
 * GameScene (scene key SCENE_KEYS.Game). Owner: agent 7 (Integrator).
 * Wires the headless game to Phaser exactly as in SPEC.md 2.1:
 *   loadGameData (BootScene) -> createGameContext(data, parseTiledMap(mapJson), createFallbackAgentService(data))
 *   -> await createGame(ctx, { mapId, difficulty, saves, resume }) -> mountGameUi(this, game)
 *   -> game.step(delta); ui.update() every frame.
 * On game:over it builds the DebriefInput and starts SCENE_KEYS.Debrief. Losing window focus pauses the game.
 */
import Phaser from 'phaser';
import {
  GameEvents,
  GamePhase,
  SCENE_KEYS,
  type DebriefSceneData,
  type GameContext,
  type GameEventPayloads,
  type GameInstance,
  type GameSceneData,
  type MapId,
  type RunSave,
  type SaveStore,
} from '../types';
import { createGame, createGameContext } from '../core';
import { parseTiledMap } from '../map';
import { buildDebriefInput, createFallbackAgentService } from '../agents';
import { createSaveStore } from '../save';
import { mountGameUi, UI_COLORS, UI_FONT } from '../ui';
import { getBootData, mapCacheKey } from './BootScene';

/** Time the final field stays on screen before the Debrief opens. */
const DEBRIEF_DELAY_MS = 1200;

/** localStorage when available, otherwise an in-memory store (private mode, blocked storage). */
function openSaveStore(): SaveStore {
  try {
    return createSaveStore(window.localStorage);
  } catch {
    return createSaveStore(null);
  }
}

export class GameScene extends Phaser.Scene {
  private mapId: MapId = 'easy';
  private resumeRequested = false;
  private game_: GameInstance | null = null;
  private ui: ReturnType<typeof mountGameUi> | null = null;
  /** Bumped on shutdown so a createGame that resolves late is thrown away. */
  private session = 0;
  private offGameOver: (() => void) | null = null;

  constructor() {
    super({ key: SCENE_KEYS.Game });
  }

  init(data: Partial<GameSceneData> | undefined): void {
    this.mapId = data?.mapId ?? 'easy';
    this.resumeRequested = data?.resume === true;
    this.game_ = null;
    this.ui = null;
  }

  create(): void {
    const data = getBootData(this);
    const mapJson: unknown = this.cache.json.get(mapCacheKey(this.mapId));
    if (!data || mapJson === undefined || mapJson === null) {
      // Started without Boot (or Boot failed): go back and load properly.
      this.scene.start(SCENE_KEYS.Boot);
      return;
    }

    const { width, height } = this.scale;
    const loading = this.add
      .text(width / 2, height / 2, 'Preparing the defense...', { fontFamily: UI_FONT, fontSize: '22px', color: UI_COLORS.textDim })
      .setOrigin(0.5);

    const session = ++this.session;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    this.game.events.on(Phaser.Core.Events.BLUR, this.autoPause, this);
    this.game.events.on(Phaser.Core.Events.HIDDEN, this.autoPause, this);

    const saves = openSaveStore();
    let resume: RunSave | null = null;
    if (this.resumeRequested) {
      resume = saves.loadRun(this.mapId);
    } else {
      // "New run" replaces any old run slot, so Continue can never bring back the abandoned run.
      saves.deleteRun(this.mapId);
    }

    let ctx: GameContext;
    try {
      const map = parseTiledMap(mapJson);
      ctx = createGameContext(data, map, createFallbackAgentService(data));
    } catch (err) {
      console.error('[game] could not build the match', err);
      loading.setText('Could not load this map.').setColor(UI_COLORS.textBad);
      return;
    }

    void createGame(ctx, { mapId: this.mapId, difficulty: ctx.map.difficulty, saves, resume }).then((game) => {
      if (session !== this.session || !this.sys.isActive()) {
        game.destroy();
        return;
      }
      loading.destroy();
      this.game_ = game;
      this.offGameOver = game.ctx.events.on(GameEvents.GameOver, (payload) => this.onGameOver(game, payload));
      this.ui = mountGameUi(this, game);
    });
  }

  update(_time: number, delta: number): void {
    if (!this.game_ || !this.ui) return;
    this.game_.step(delta);
    this.ui.update();
  }

  private onGameOver(game: GameInstance, payload: GameEventPayloads['game:over']): void {
    const session = this.session;
    const debrief: DebriefSceneData = {
      mapId: this.mapId,
      result: payload.result,
      stars: payload.stars,
      input: buildDebriefInput(game.state, game.ctx),
      agents: game.ctx.agents,
    };
    this.time.delayedCall(DEBRIEF_DELAY_MS, () => {
      if (session === this.session) this.scene.start(SCENE_KEYS.Debrief, debrief);
    });
  }

  /** Window blur / tab hidden: pause a running match (never unpauses; the player resumes). */
  private autoPause(): void {
    const game = this.game_;
    if (!game) return;
    const { phase, paused } = game.state;
    if (paused || phase === GamePhase.Won || phase === GamePhase.Lost) return;
    game.commands.togglePause();
  }

  private teardown(): void {
    this.session += 1;
    this.game.events.off(Phaser.Core.Events.BLUR, this.autoPause, this);
    this.game.events.off(Phaser.Core.Events.HIDDEN, this.autoPause, this);
    this.offGameOver?.();
    this.offGameOver = null;
    this.ui?.destroy();
    this.ui = null;
    this.game_?.destroy();
    this.game_ = null;
  }
}
