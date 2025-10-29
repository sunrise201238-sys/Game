import type { SimulationFrame } from '@slingshot/shared';

import type { ClientState, ClientUnitState } from './state';
import { MAPS } from './resources';

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

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private state: ClientState | null = null;
  private animation: AnimationState | null = null;
  private aim: AimIndicator | null = null;
  private deathEffects: DeathEffect[] = [];

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
      return;
    }
    const last = frames[frames.length - 1];
    const duration = Math.max(last.time, 0.5);
    this.animation = {
      frames,
      startedAt: performance.now(),
      duration,
    };
  }

  reset() {
    this.animation = null;
    this.aim = null;
    this.deathEffects = [];
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
    this.drawBackground();
    this.drawAimIndicator();
    this.drawDeathEffects();

    const display = this.animation ? this.sampleAnimationFrame() : null;
    const youUnits = display?.you ?? this.state.youUnits;
    const opponentUnits = display?.opponent ?? this.state.opponentUnits;

    this.drawUnits(youUnits, '#53e1ff');
    this.drawUnits(opponentUnits, '#ff6f91');
    this.drawGraves(this.state.graves);
  }

  private drawDeathEffects() {
    if (this.deathEffects.length === 0) return;
    const now = performance.now();
    this.deathEffects = this.deathEffects.filter((effect) => now - effect.startedAt < effect.duration);
    for (const effect of this.deathEffects) {
      const progress = Math.min((now - effect.startedAt) / effect.duration, 1);
      const alpha = 1 - progress;
      const radius = 12 + progress * 24;
      const point = this.worldToCanvas(effect.position);
      this.ctx.save();
      this.ctx.globalAlpha = alpha;
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  private drawBackground() {
    const { ctx, canvas } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#14213d');
    gradient.addColorStop(1, '#0b132b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bounds = this.getMapBounds();
    const scale = this.getScale();
    const offset = this.getOffset(bounds, scale);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    ctx.strokeRect(offset.x, offset.y, bounds.w * scale, bounds.h * scale);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let gridX = 1; gridX < bounds.w; gridX += 4) {
      ctx.fillRect(offset.x + gridX * scale - 1, offset.y, 2, bounds.h * scale);
    }
    for (let gridY = 1; gridY < bounds.h; gridY += 4) {
      ctx.fillRect(offset.x, offset.y + gridY * scale - 1, bounds.w * scale, 2);
    }
  }

  private drawUnits(units: ClientUnitState[], color: string) {
    const { ctx } = this;
    const scale = this.getScale();
    const radius = Math.max(10, scale * 0.55);
    units.forEach((unit) => {
      const { x, y } = this.worldToCanvas(unit.position);
      ctx.globalAlpha = unit.alive ? 1 : 0.4;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color === '#53e1ff' ? 'rgba(83, 225, 255, 0.4)' : 'rgba(255, 111, 145, 0.4)';
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = `${Math.max(12, radius * 0.9)}px Inter`;
      ctx.textAlign = 'center';
      ctx.fillText(unit.type.slice(0, 1).toUpperCase(), x, y + 5);
      ctx.globalAlpha = 1;
    });
  }

  private drawGraves(graves: Array<{ position: { x: number; y: number }; count: number }>) {
    const { ctx } = this;
    graves.forEach((grave) => {
      const { x, y } = this.worldToCanvas(grave.position);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = '12px Inter';
      ctx.textAlign = 'center';
      ctx.fillText(`✖${grave.count}`, x, y + 24);
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

  private getMapBounds() {
    if (!this.state?.mapId) {
      return { w: 40, h: 24 };
    }
    const map = MAPS.find((candidate) => candidate.id === this.state?.mapId);
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
