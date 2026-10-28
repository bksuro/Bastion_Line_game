/**
 * FieldView (agent 6): grid, path, core, towers, enemies (HP bars, slow tint) and projectiles,
 * all drawn with Phaser shapes and text. Reads game.state every frame; never mutates it.
 */
import type Phaser from 'phaser';
import type { CreateFieldView } from './contracts';
import { GameEvents, type TowerInstance, type TowerType, type Vec2 } from '../types';
import { COLORS, DEPTH, FONT, hexToNumber, tileCenterPx, tileSize } from './widgets';

const TOWER_LETTER: Record<TowerType, string> = { Arrow: 'A', Frost: 'F', Cannon: 'C', Sniper: 'S' };

interface HitEffect {
  x: number;
  y: number;
  radius: number;
  color: number;
  startMs: number;
  durationMs: number;
}

function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export const createFieldView: CreateFieldView = (scene, game) => {
  const { data, map, events } = game.ctx;
  const ts = tileSize(game);
  const px = (v: Vec2): { x: number; y: number } => ({ x: v.x * ts, y: v.y * ts });

  /* ---- static layer: tiles, path, spawn, core ---- */
  const ground = scene.add.graphics().setDepth(DEPTH.field);
  ground.fillStyle(COLORS.blocked, 1);
  ground.fillRect(0, 0, map.cols * ts, map.rows * ts);
  for (const t of map.buildableTiles) {
    ground.fillStyle((t.x + t.y) % 2 === 0 ? COLORS.buildable : COLORS.buildableAlt, 1);
    ground.fillRect(t.x * ts, t.y * ts, ts, ts);
  }
  for (const t of map.pathTiles) {
    ground.fillStyle(COLORS.path, 1);
    ground.fillRect(t.x * ts, t.y * ts, ts, ts);
  }
  ground.lineStyle(1, COLORS.gridLine, 0.18);
  for (let x = 0; x <= map.cols; x++) ground.lineBetween(x * ts, 0, x * ts, map.rows * ts);
  for (let y = 0; y <= map.rows; y++) ground.lineBetween(0, y * ts, map.cols * ts, y * ts);
  // path centre line along the waypoints
  if (map.path.length > 1) {
    ground.lineStyle(2, COLORS.pathEdge, 0.8);
    ground.beginPath();
    const p0 = px(map.path[0]);
    ground.moveTo(p0.x, p0.y);
    for (let i = 1; i < map.path.length; i++) {
      const p = px(map.path[i]);
      ground.lineTo(p.x, p.y);
    }
    ground.strokePath();
    const s = px(map.path[0]);
    ground.fillStyle(0xc0503a, 1);
    ground.fillTriangle(Math.max(4, s.x), s.y - 10, Math.max(4, s.x), s.y + 10, Math.max(4, s.x) + 14, s.y);
  }
  // core: a small keep
  const core = tileCenterPx(game, map.core);
  ground.fillStyle(COLORS.core, 1);
  ground.fillRect(core.x - ts * 0.38, core.y - ts * 0.3, ts * 0.76, ts * 0.62);
  ground.fillStyle(0x3a6aa6, 1);
  for (let i = 0; i < 3; i++) ground.fillRect(core.x - ts * 0.38 + i * ts * 0.29, core.y - ts * 0.42, ts * 0.18, ts * 0.14);
  ground.fillStyle(0x1b1f24, 1);
  ground.fillRect(core.x - ts * 0.08, core.y + ts * 0.08, ts * 0.16, ts * 0.24);
  const coreLabel = scene.add
    .text(core.x, core.y - ts * 0.62, '', { fontFamily: FONT, fontSize: '12px', color: COLORS.text, backgroundColor: '#00000099', padding: { x: 3, y: 1 } })
    .setOrigin(0.5)
    .setDepth(DEPTH.effects);

  /* ---- dynamic layers ---- */
  const towerGfx = scene.add.graphics().setDepth(DEPTH.towers);
  const enemyGfx = scene.add.graphics().setDepth(DEPTH.enemies);
  const projGfx = scene.add.graphics().setDepth(DEPTH.projectiles);
  const fxGfx = scene.add.graphics().setDepth(DEPTH.effects);
  const towerLabels = new Map<string, Phaser.GameObjects.Text>();
  const effects: HitEffect[] = [];

  const offHit = events.on(GameEvents.ProjectileHit, (e) => {
    const def = data.towers.towers[e.towerType];
    const radius = def.splashRadius > 0 ? def.splashRadius * ts : ts * 0.18;
    const p = px(e.pos);
    effects.push({ x: p.x, y: p.y, radius, color: hexToNumber(def.color), startMs: scene.time.now, durationMs: def.splashRadius > 0 ? 260 : 120 });
  });
  const offLeak = events.on(GameEvents.CoreDamaged, () => {
    effects.push({ x: core.x, y: core.y, radius: ts * 0.8, color: COLORS.invalid, startMs: scene.time.now, durationMs: 350 });
  });

  const drawTower = (t: TowerInstance): void => {
    const def = data.towers.towers[t.type];
    const c = tileCenterPx(game, t.tile);
    const color = hexToNumber(def.color);
    const half = ts * 0.36;
    towerGfx.fillStyle(0x15181c, 1);
    towerGfx.fillRect(c.x - half - 2, c.y - half - 2, half * 2 + 4, half * 2 + 4);
    towerGfx.fillStyle(color, 1);
    switch (t.type) {
      case 'Arrow':
        towerGfx.fillTriangle(c.x, c.y - half, c.x - half, c.y + half, c.x + half, c.y + half);
        break;
      case 'Frost':
        towerGfx.fillPoints([
          { x: c.x, y: c.y - half },
          { x: c.x + half, y: c.y },
          { x: c.x, y: c.y + half },
          { x: c.x - half, y: c.y },
        ] as Phaser.Types.Math.Vector2Like[], true);
        break;
      case 'Cannon':
        towerGfx.fillCircle(c.x, c.y, half);
        break;
      case 'Sniper':
        towerGfx.fillRect(c.x - half, c.y - half, half * 2, half * 2);
        break;
    }
    // level pips
    for (let i = 0; i < t.level; i++) {
      towerGfx.fillStyle(0xffffff, 1);
      towerGfx.fillRect(c.x - half + 2 + i * 8, c.y + half - 6, 6, 4);
    }
    let label = towerLabels.get(t.id);
    if (!label) {
      label = scene.add
        .text(c.x, c.y - 2, TOWER_LETTER[t.type], { fontFamily: FONT, fontSize: '15px', color: '#111111', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setDepth(DEPTH.towers + 1);
      towerLabels.set(t.id, label);
    }
    label.setPosition(c.x, c.y - 2);
  };

  const update = (): void => {
    const state = game.state;

    /* towers */
    towerGfx.clear();
    const seen = new Set<string>();
    for (const t of state.towers) {
      seen.add(t.id);
      drawTower(t);
    }
    for (const [id, label] of towerLabels) {
      if (!seen.has(id)) {
        label.destroy();
        towerLabels.delete(id);
      }
    }

    /* enemies */
    enemyGfx.clear();
    for (const e of state.enemies) {
      if (!e.alive) continue;
      const def = data.enemies.enemies[e.type];
      const p = px(e.pos);
      const r = Math.max(4, def.radius * ts);
      let color = hexToNumber(def.color);
      if (e.slowPct > 0) color = mix(color, COLORS.slow, 0.55);
      if (e.flying) {
        // shadow + diamond body for flyers
        enemyGfx.fillStyle(0x000000, 0.3);
        enemyGfx.fillEllipse(p.x, p.y + r * 0.9, r * 1.6, r * 0.6);
        enemyGfx.fillStyle(color, 1);
        enemyGfx.fillTriangle(p.x - r * 1.3, p.y - r * 0.2, p.x, p.y - r, p.x + r * 1.3, p.y - r * 0.2);
        enemyGfx.fillTriangle(p.x - r * 0.5, p.y - r * 0.4, p.x + r * 0.5, p.y - r * 0.4, p.x, p.y + r * 0.6);
      } else {
        enemyGfx.fillStyle(color, 1);
        enemyGfx.fillCircle(p.x, p.y, r);
        enemyGfx.lineStyle(e.type === 'Boss' ? 3 : 1, e.type === 'Boss' ? 0xffd54a : 0x000000, 0.8);
        enemyGfx.strokeCircle(p.x, p.y, r);
      }
      if (e.slowPct > 0) {
        enemyGfx.lineStyle(2, COLORS.slow, 0.9);
        enemyGfx.strokeCircle(p.x, p.y, r + 3);
      }
      // HP bar
      const w = Math.max(18, r * 2.2);
      const frac = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0;
      const by = p.y - r - 8;
      enemyGfx.fillStyle(COLORS.hpBack, 0.9);
      enemyGfx.fillRect(p.x - w / 2, by, w, 4);
      enemyGfx.fillStyle(frac > 0.35 ? COLORS.hpFill : COLORS.hpLow, 1);
      enemyGfx.fillRect(p.x - w / 2, by, w * frac, 4);
    }

    /* projectiles */
    projGfx.clear();
    for (const pr of state.projectiles) {
      if (pr.spent) continue;
      const p = px(pr.pos);
      const color = hexToNumber(data.towers.towers[pr.towerType].color);
      projGfx.fillStyle(0x000000, 0.6);
      projGfx.fillCircle(p.x, p.y, pr.towerType === 'Cannon' ? 5 : 4);
      projGfx.fillStyle(color, 1);
      projGfx.fillCircle(p.x, p.y, pr.towerType === 'Cannon' ? 4 : 3);
    }

    /* hit effects */
    fxGfx.clear();
    const now = scene.time.now;
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i];
      const t = (now - fx.startMs) / fx.durationMs;
      if (t >= 1) {
        effects.splice(i, 1);
        continue;
      }
      fxGfx.lineStyle(2, fx.color, 1 - t);
      fxGfx.strokeCircle(fx.x, fx.y, fx.radius * (0.4 + 0.6 * t));
    }

    const hpText = `${state.coreHp}/${state.coreHpMax}`;
    if (coreLabel.text !== hpText) coreLabel.setText(hpText);
    coreLabel.setColor(state.coreHp <= state.coreHpMax * 0.3 ? COLORS.textBad : COLORS.text);
  };

  update();

  return {
    update,
    destroy() {
      offHit();
      offLeak();
      for (const label of towerLabels.values()) label.destroy();
      towerLabels.clear();
      ground.destroy();
      towerGfx.destroy();
      enemyGfx.destroy();
      projGfx.destroy();
      fxGfx.destroy();
      coreLabel.destroy();
    },
  };
};
