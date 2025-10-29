import type { SimulationFrame } from '@slingshot/shared';

import type { ClientState, ClientUnitState } from './state';
import { MAPS, UNITS_BY_ID } from './resources';

interface AnimationState {
  frames: SimulationFrame[];
  startedAt: number;
  duration: number;
}

interface AimIndicator {
  origin: { x: number; y: number };
  drag: { x: number; y: number };
  launch: { x: number; y: number };
}

interface DeathEffect {
  position: { x: number; y: number };
  startedAt: number;
  duration: number;
}

interface TrailPath {
  id: string;
  path: Array<{ x: number; y: number }>;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private state: ClientState | null = null;
  private animation: AnimationState | null = null;
  private aim: AimIndicator | null = null;
  private deathEffects: DeathEffect[] = [];
  private trails: { you: TrailPath[]; opponent: TrailPath[] } = { you: [], opponent: [] };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not available');
    this.ctx = ctx;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  update(state: ClientState) {
    this.state = state;
  }

  play(frames: SimulationFrame[]) {
    if (!frames || frames.length === 0) {
      this.animation = null;
      this.trails = { you: [], opponent: [] };
      return;
    }
    const last = frames[frames.length - 1];
    const duration = Math.max(last.time, 0.5);
    this.animation = {
      frames,
      startedAt: performance.now(),
      duration,
    };
    this.trails = this.buildTrails(frames);
  }

  reset() {
    this.animation = null;
    this.aim = null;
    this.deathEffects = [];
    this.trails = { you: [], opponent: [] };
  }

  triggerDeaths(positions: Array<{ position: { x: number; y: number } }>) {
    const now = performance.now();
    for (const { position } of positions) {
      this.deathEffects.push({ position: { ...position }, startedAt: now, duration: 600 });
    }
  }

  setAim(origin: { x: number; y: number } | null, dragVector?: { x: number; y: number }) {
    if (!origin || !dragVector) {
      this.aim = null;
      return;
    }
    const drag = { x: origin.x + dragVector.x, y: origin.y + dragVector.y };
    const launch = { x: origin.x - dragVector.x, y: origin.y - dragVector.y };
    this.aim = { origin, drag, launch };
  }

  private loop() {
    this.draw();
    requestAnimationFrame(this.loop);
  }

  private draw() {
    if (!this.state) return;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawEnvironment();
    this.drawAimIndicator();
    this.drawDeathEffects();

    const display = this.animation ? this.sampleAnimationFrame() : null;
    const youUnits = display?.you ?? this.state.youUnits;
    const opponentUnits = display?.opponent ?? this.state.opponentUnits;

    this.drawTrails();
    this.drawUnits(youUnits, '#53e1ff', this.state.activeYouId);
    this.drawUnits(opponentUnits, '#ff6f91', this.state.activeOpponentId);
    this.drawGraves(this.state.graves);
  }

  private drawDeathEffects() {
    if (this.deathEffects.length === 0) return;
    const now = performance.now();
    this.deathEffects = this.deathEffects.filter((effect) => now - effect.startedAt < effect.duration);
    for (const effect of this.deathEffects) {
      const progress = Math.min((now - effect.startedAt) / effect.duration, 1);
      const alpha = 1 - progress;
      const radius = 12 + progress * 26;
      const point = this.worldToCanvas(effect.position);
      this.ctx.save();
      this.ctx.globalAlpha = alpha * 0.55;
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, radius * 0.6, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.globalAlpha = alpha;
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      this.ctx.lineWidth = 2 + progress * 2;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  private drawEnvironment() {
    const { ctx, canvas } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#0b1f3a');
    gradient.addColorStop(1, '#050b16');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bounds = this.getMapBounds();
    const scale = this.getScale();
    const offset = this.getOffset(bounds, scale);
    const map = this.getCurrentMap();

    ctx.save();
    ctx.fillStyle = '#1f4037';
    ctx.fillRect(offset.x, offset.y, bounds.w * scale, bounds.h * scale);
    ctx.strokeStyle = '#e63946';
    ctx.lineWidth = 4;
    ctx.strokeRect(offset.x, offset.y, bounds.w * scale, bounds.h * scale);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let gridX = 1; gridX < bounds.w; gridX += 2) {
      ctx.beginPath();
      ctx.moveTo(offset.x + gridX * scale, offset.y);
      ctx.lineTo(offset.x + gridX * scale, offset.y + bounds.h * scale);
      ctx.stroke();
    }
    for (let gridY = 1; gridY < bounds.h; gridY += 2) {
      ctx.beginPath();
      ctx.moveTo(offset.x, offset.y + gridY * scale);
      ctx.lineTo(offset.x + bounds.w * scale, offset.y + gridY * scale);
      ctx.stroke();
    }
    ctx.restore();

    if (!map) return;

    for (const lake of map.lakes ?? []) {
      const polygon = lake.polygon.map((point) => this.worldToCanvas(point));
      ctx.save();
      ctx.beginPath();
      polygon.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(64, 156, 255, 0.78)';
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 3;
      const diag = Math.hypot(bounds.w, bounds.h) * scale;
      for (let d = -diag; d < diag * 2; d += 16) {
        ctx.beginPath();
        ctx.moveTo(offset.x + d, offset.y - diag * 0.2);
        ctx.lineTo(offset.x + d - diag, offset.y + diag);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const wall of map.walls ?? []) {
      const polygon = wall.polygon.map((point) => this.worldToCanvas(point));
      ctx.save();
      ctx.beginPath();
      polygon.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.closePath();
      ctx.fillStyle = 'rgba(90, 90, 90, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawTrails() {
    const drawFor = (paths: TrailPath[], stroke: string) => {
      for (const trail of paths) {
        if (trail.path.length < 2) continue;
        this.ctx.save();
        this.ctx.strokeStyle = stroke;
        this.ctx.lineWidth = 3;
        this.ctx.globalAlpha = 0.45;
        this.ctx.beginPath();
        trail.path.forEach((point, index) => {
          const { x, y } = this.worldToCanvas(point);
          if (index === 0) {
            this.ctx.moveTo(x, y);
          } else {
            this.ctx.lineTo(x, y);
          }
        });
        this.ctx.stroke();
        this.ctx.restore();
      }
    };

    drawFor(this.trails.you, 'rgba(83, 225, 255, 0.55)');
    drawFor(this.trails.opponent, 'rgba(255, 111, 145, 0.55)');
  }

  private drawUnits(units: ClientUnitState[], color: string, activeId: string | null) {
    const { ctx } = this;
    const scale = this.getScale();
    const radius = Math.max(12, scale * 0.65);
    const outline = color === '#53e1ff' ? 'rgba(83, 225, 255, 0.6)' : 'rgba(255, 111, 145, 0.6)';

    for (const unit of units) {
      const { x, y } = this.worldToCanvas(unit.position);
      const schema = UNITS_BY_ID[unit.type];
      const maxHp = schema?.hp ?? Math.max(unit.hp, 1);
      const hpRatio = Math.max(0, Math.min(1, unit.hp / maxHp));

      ctx.save();
      ctx.globalAlpha = unit.alive ? 1 : 0.35;
      if (unit.id === activeId && unit.alive) {
        ctx.shadowBlur = 18;
        ctx.shadowColor = color;
      }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = outline;
      ctx.beginPath();
      ctx.arc(x, y, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#081229';
      ctx.font = `${Math.max(12, radius * 0.9)}px Inter`;
      ctx.textAlign = 'center';
      ctx.fillText(unit.type.slice(0, 1).toUpperCase(), x, y + 5);
      ctx.restore();

      const barWidth = Math.max(radius * 2.4, 52);
      const barHeight = 6;
      const barX = x - barWidth / 2;
      const barY = y + radius + 10;
      ctx.fillStyle = 'rgba(8, 18, 41, 0.75)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      ctx.fillStyle = color === '#53e1ff' ? '#4ade80' : '#f87171';
      ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
    }
  }

  private drawGraves(graves: Array<{ position: { x: number; y: number }; count: number }>) {
    const { ctx } = this;
    graves.forEach((grave) => {
      const { x, y } = this.worldToCanvas(grave.position);
      ctx.save();
      ctx.fillStyle = 'rgba(209, 213, 219, 0.85)';
      ctx.beginPath();
      ctx.moveTo(x - 8, y + 18);
      ctx.lineTo(x - 8, y + 6);
      ctx.quadraticCurveTo(x, y - 4, x + 8, y + 6);
      ctx.lineTo(x + 8, y + 18);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1f2937';
      ctx.font = '10px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(`×${grave.count}`, x, y + 14);
      ctx.restore();
    });
  }

  private drawAimIndicator() {
    if (!this.aim) return;
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.aim.origin.x, this.aim.origin.y);
    ctx.lineTo(this.aim.drag.x, this.aim.drag.y);
    ctx.stroke();

    ctx.strokeStyle = '#53e1ff';
    ctx.fillStyle = '#53e1ff';
    ctx.beginPath();
    ctx.moveTo(this.aim.origin.x, this.aim.origin.y);
    ctx.lineTo(this.aim.launch.x, this.aim.launch.y);
    ctx.stroke();
    this.drawArrowHead(this.aim.origin, this.aim.launch);
    ctx.restore();
  }

  private drawArrowHead(start: { x: number; y: number }, end: { x: number; y: number }) {
    const { ctx } = this;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = 12;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x + Math.cos(angle + Math.PI * 0.75) * size, end.y + Math.sin(angle + Math.PI * 0.75) * size);
    ctx.lineTo(end.x + Math.cos(angle - Math.PI * 0.75) * size, end.y + Math.sin(angle - Math.PI * 0.75) * size);
    ctx.closePath();
    ctx.fill();
  }

  private buildTrails(frames: SimulationFrame[]): { you: TrailPath[]; opponent: TrailPath[] } {
    const collect = (role: 'you' | 'opponent'): TrailPath[] => {
      const store = new Map<string, TrailPath>();
      for (const frame of frames) {
        for (const unit of frame[role]) {
          let entry = store.get(unit.id);
          if (!entry) {
            entry = { id: unit.id, path: [] };
            store.set(unit.id, entry);
          }
          const previous = entry.path[entry.path.length - 1];
          const dx = previous ? unit.position.x - previous.x : Infinity;
          const dy = previous ? unit.position.y - previous.y : Infinity;
          if (!previous || dx * dx + dy * dy > 0.01) {
            entry.path.push({ ...unit.position });
          }
        }
      }
      return Array.from(store.values()).filter((trail) => trail.path.length > 1);
    };

    return {
      you: collect('you'),
      opponent: collect('opponent'),
    };
  }

  private sampleAnimationFrame(): { you: ClientUnitState[]; opponent: ClientUnitState[] } | null {
    if (!this.animation) return null;
    const now = performance.now();
    const elapsed = (now - this.animation.startedAt) / 1000;
    const { frames, duration } = this.animation;
    const last = frames[frames.length - 1];
    if (!last) {
      this.animation = null;
      return null;
    }
    if (elapsed >= duration) {
      this.animation = null;
      return {
        you: last.you.map(toClientUnitState),
        opponent: last.opponent.map(toClientUnitState),
      };
    }

    let nextIndex = frames.findIndex((frame) => frame.time >= elapsed);
    if (nextIndex === -1) {
      return {
        you: last.you.map(toClientUnitState),
        opponent: last.opponent.map(toClientUnitState),
      };
    }
    if (nextIndex === 0) {
      const frame = frames[0];
      return {
        you: frame.you.map(toClientUnitState),
        opponent: frame.opponent.map(toClientUnitState),
      };
    }

    const prev = frames[nextIndex - 1];
    const next = frames[nextIndex];
    const span = Math.max(next.time - prev.time, 0.016);
    const t = Math.min(Math.max((elapsed - prev.time) / span, 0), 1);

    return {
      you: interpolateUnits(prev.you, next.you, t),
      opponent: interpolateUnits(prev.opponent, next.opponent, t),
    };
  }

  private worldToCanvas(position: { x: number; y: number }) {
    const bounds = this.getMapBounds();
    const scale = this.getScale();
    const offset = this.getOffset(bounds, scale);
    return {
      x: offset.x + position.x * scale,
      y: offset.y + position.y * scale,
    };
  }

  private getCurrentMap() {
    if (!this.state?.mapId) {
      return null;
    }
    return MAPS.find((candidate) => candidate.id === this.state?.mapId) ?? null;
  }

  private getMapBounds() {
    const map = this.getCurrentMap();
    return map?.bounds ?? { w: 40, h: 24 };
  }

  private getScale() {
    const bounds = this.getMapBounds();
    const padding = 0.85;
    const availableWidth = this.canvas.width * padding;
    const availableHeight = this.canvas.height * padding;
    return Math.min(availableWidth / bounds.w, availableHeight / bounds.h);
  }

  private getOffset(bounds: { w: number; h: number }, scale: number) {
    const width = bounds.w * scale;
    const height = bounds.h * scale;
    return {
      x: (this.canvas.width - width) / 2,
      y: (this.canvas.height - height) / 2,
    };
  }
}

function toClientUnitState(unit: SimulationFrame['you'][number]): ClientUnitState {
  return {
    id: unit.id,
    type: unit.type,
    hp: unit.hp,
    position: { ...unit.position },
    alive: unit.alive,
    graveCount: 0,
  };
}

function interpolateUnits(
  from: SimulationFrame['you'],
  to: SimulationFrame['you'],
  t: number,
): ClientUnitState[] {
  const target = new Map(to.map((unit) => [unit.id, unit]));
  return from.map((unit) => {
    const next = target.get(unit.id) ?? unit;
    const position = {
      x: unit.position.x + (next.position.x - unit.position.x) * t,
      y: unit.position.y + (next.position.y - unit.position.y) * t,
    };
    const alive = t >= 1 ? next.alive : unit.alive;
    const hp = t >= 1 ? next.hp : unit.hp;
    return {
      id: unit.id,
      type: unit.type,
      hp,
      position,
      alive,
      graveCount: 0,
    };
  });
}
