import type { ClientState, ClientUnitState } from './state';

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
  }

  private drawUnits(units: ClientUnitState[], color: string) {
    const { ctx } = this;
    units.forEach((unit) => {
      const radius = 22;
      const { x, y } = this.worldToCanvas(unit.position);
      ctx.globalAlpha = unit.alive ? 1 : 0.4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = '14px Inter';
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
    const scale = 18;
    return {
      x: this.canvas.width / 2 + position.x * scale,
      y: this.canvas.height / 2 + position.y * scale,
    };
  }
}
