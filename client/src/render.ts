import type { ClientState, ClientUnitState } from './state';
import { MAPS } from './resources';

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private state: ClientState | null = null;

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

  private loop() {
    this.draw();
    requestAnimationFrame(this.loop);
  }

  private draw() {
    if (!this.state) return;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawBackground();
    this.drawUnits(this.state.youUnits, '#53e1ff');
    this.drawUnits(this.state.opponentUnits, '#ff6f91');
    this.drawGraves(this.state.graves);
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
  }

  private drawUnits(units: ClientUnitState[], color: string) {
    const { ctx } = this;
    const scale = this.getScale();
    const radius = Math.max(10, scale * 0.55);
    units.forEach((unit) => {
      const { x, y } = this.worldToCanvas(unit.position);
      ctx.globalAlpha = unit.alive ? 1 : 0.4;
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
