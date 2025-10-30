import { HP_BAR_HEIGHT } from './config';
import { normalize, scale } from './math';
import type {
  GameState,
  GraveMarker,
  MapDefinition,
  SimulationFrameProjectile,
  SimulationFrameZone,
  UnitState,
  Vector,
  TeamId,
} from './types';

interface RenderOptions {
  dragOrigin?: Vector | null;
  dragCurrent?: Vector | null;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private map: MapDefinition;
  private dpr = window.devicePixelRatio || 1;

  constructor(canvas: HTMLCanvasElement, map: MapDefinition) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context not available');
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.map = map;
    this.resizeToMap(this.map);
    window.addEventListener('resize', () => this.resizeToMap(this.map));
  }

  setMap(map: MapDefinition): void {
    this.resizeToMap(map);
  }

  resizeToMap(map: MapDefinition): void {
    this.map = map;
    const { width, height } = map;
    const rect = this.canvas.getBoundingClientRect();
    const scaleRatio = Math.min(rect.width / width, rect.height / height) || 1;
    const targetWidth = width * scaleRatio;
    const targetHeight = height * scaleRatio;
    this.canvas.width = targetWidth * this.dpr;
    this.canvas.height = targetHeight * this.dpr;
    this.canvas.style.width = `${targetWidth}px`;
    this.canvas.style.height = `${targetHeight}px`;
    this.ctx.setTransform(this.dpr * scaleRatio, 0, 0, this.dpr * scaleRatio, 0, 0);
  }

  render(state: GameState, options: RenderOptions = {}): void {
    this.clear();
    this.drawArena();
    this.drawLakes();
    this.drawWalls();
    this.drawZones(state.activeZones);
    this.drawGraves(state.graves);
    this.drawUnits(state);
    this.drawProjectiles(state.activeProjectiles);
    this.drawDragIndicator(state, options);
    this.drawStatus(state);
  }

  private clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawArena(): void {
    const { width, height } = this.map;
    const { ctx } = this;
    ctx.fillStyle = '#203040';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = gridSize; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = gridSize; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  private drawLakes(): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(33, 150, 243, 0.75)';
    for (const lake of this.map.lakes) {
      ctx.fillRect(lake.x, lake.y, lake.width, lake.height);
    }
  }

  private drawWalls(): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(160, 82, 45, 0.9)';
    for (const wall of this.map.walls) {
      ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
    }
  }

  private drawZones(zones: SimulationFrameZone[]): void {
    const { ctx } = this;
    for (const zone of zones) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0.2, zone.strength));
      const gradient = ctx.createRadialGradient(zone.x, zone.y, zone.radius * 0.15, zone.x, zone.y, zone.radius);
      gradient.addColorStop(0, this.replaceAlpha(zone.color, Math.min(0.85, 0.6 + zone.strength * 0.4)));
      gradient.addColorStop(1, this.replaceAlpha(zone.color, 0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawUnits(state: GameState): void {
    const { ctx } = this;
    const highlightId = state.phase !== 'ended' ? this.getUpcomingUnitId(state, state.activeTeam) : null;
    const baseStroke: Record<TeamId, string> = {
      0: 'rgba(74,222,128,0.65)',
      1: 'rgba(249,115,22,0.65)',
    };
    const highlightStroke: Record<TeamId, string> = {
      0: '#bbf7d0',
      1: '#fed7aa',
    };

    for (const unit of state.units) {
      if (!unit.alive) {
        continue;
      }
      const radius = unit.def.radius;
      ctx.fillStyle = this.getTeamFill(unit.def.color, unit.team);
      ctx.beginPath();
      ctx.arc(unit.position.x, unit.position.y, radius, 0, Math.PI * 2);
      ctx.fill();

      const isHighlight = Boolean(
        highlightId &&
          unit.id === highlightId &&
          state.activeTeam === unit.team &&
          state.phase !== 'ended'
      );

      ctx.save();
      ctx.lineWidth = isHighlight ? 4 : 3;
      const stroke = baseStroke[unit.team] ?? 'rgba(255,255,255,0.55)';
      ctx.strokeStyle = isHighlight ? highlightStroke[unit.team] ?? stroke : stroke;
      if (isHighlight) {
        ctx.shadowBlur = 18;
        ctx.shadowColor = highlightStroke[unit.team] ?? stroke;
      }
      ctx.beginPath();
      ctx.arc(unit.position.x, unit.position.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      this.drawHpBar(unit);
    }
  }

  private drawProjectiles(projectiles: SimulationFrameProjectile[]): void {
    const { ctx } = this;
    for (const projectile of projectiles) {
      ctx.save();
      ctx.fillStyle = projectile.color;
      ctx.beginPath();
      ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawHpBar(unit: UnitState): void {
    const { ctx } = this;
    const ratio = unit.hp / unit.def.maxHp;
    const width = unit.def.radius * 2;
    const x = unit.position.x - unit.def.radius;
    const y = unit.position.y - unit.def.radius - HP_BAR_HEIGHT - 4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, width, HP_BAR_HEIGHT);
    ctx.fillStyle = unit.team === 0 ? '#4ade80' : '#f97316';
    ctx.fillRect(x, y, width * ratio, HP_BAR_HEIGHT);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.strokeRect(x, y, width, HP_BAR_HEIGHT);
  }

  private drawGraves(graves: GraveMarker[]): void {
    const { ctx } = this;
    ctx.fillStyle = '#cccccc';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    for (const grave of graves) {
      ctx.save();
      ctx.translate(grave.position.x, grave.position.y);
      ctx.rotate(-Math.PI / 8);
      ctx.fillRect(-4, -16, 8, 20);
      ctx.fillRect(-10, -10, 20, 6);
      ctx.restore();
      if (grave.count > 1) {
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`×${grave.count}`, grave.position.x, grave.position.y - 20);
      }
    }
    ctx.textAlign = 'left';
  }

  private drawDragIndicator(state: GameState, options: RenderOptions): void {
    const { dragOrigin, dragCurrent } = options;
    if (!dragOrigin || !dragCurrent) return;
    const nextId = this.getUpcomingUnitId(state, state.activeTeam);
    const activeUnit = nextId ? state.units.find((u) => u.id === nextId) : undefined;
    if (!activeUnit) return;

    const dragVector = { x: dragOrigin.x - dragCurrent.x, y: dragOrigin.y - dragCurrent.y };
    const dragDistance = Math.hypot(dragVector.x, dragVector.y);
    if (dragDistance < 2) return;

    const clampedPower = Math.min(activeUnit.def.maxPower, dragDistance);
    const launchDir = normalize(dragVector);
    const previewDistance = clampedPower * 1.2;
    const previewEnd = addVectors(dragOrigin, scale(launchDir, previewDistance));

    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = state.activeTeam === 0 ? 'rgba(74,222,128,0.85)' : 'rgba(249,115,22,0.85)';
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(dragOrigin.x, dragOrigin.y);
    ctx.lineTo(previewEnd.x, previewEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const arrowHead = addVectors(previewEnd, scale(launchDir, 20));
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(arrowHead.x, arrowHead.y);
    ctx.lineTo(arrowHead.x + launchDir.y * 8, arrowHead.y - launchDir.x * 8);
    ctx.lineTo(arrowHead.x - launchDir.y * 8, arrowHead.y + launchDir.x * 8);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(dragOrigin.x, dragOrigin.y, 6, 0, Math.PI * 2);
    ctx.fill();

    if (activeUnit.def.aoe) {
      const spec = activeUnit.def.aoe;
      const placementDistance = Math.min(spec.placementRange, clampedPower * spec.travelScale);
      const desired = addVectors(dragOrigin, scale(launchDir, placementDistance));
      const center = {
        x: Math.min(this.map.width - spec.radius, Math.max(spec.radius, desired.x)),
        y: Math.min(this.map.height - spec.radius, Math.max(spec.radius, desired.y)),
      };
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = this.replaceAlpha(spec.color, 0.35);
      ctx.beginPath();
      ctx.arc(center.x, center.y, spec.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.replaceAlpha(spec.color, 0.85);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, spec.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawStatus(state: GameState): void {
    const { ctx } = this;
    const message = this.composeStatus(state);
    ctx.save();
    ctx.font = '20px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = 'center';
    ctx.fillText(message, this.map.width / 2, 32);
    ctx.restore();
  }

  private composeStatus(state: GameState): string {
    if (state.winner !== null) {
      if (state.winner === 0) return state.mode === 'bot' ? 'You win!' : 'Team One wins!';
      if (state.winner === 1) return state.mode === 'bot' ? 'Bot wins!' : 'Team Two wins!';
      return 'Draw';
    }
    if (state.phase === 'animating') return 'Resolving move…';
    if (state.mode === 'bot' && state.phase === 'bot-planning') return 'Bot is planning…';
    if (state.mode === 'hotseat') {
      return state.activeTeam === 0
        ? `Round ${state.round}: Team One`
        : `Round ${state.round}: Team Two`;
    }
    return state.activeTeam === 0
      ? `Round ${state.round}: Your turn`
      : `Round ${state.round}: Bot turn`;
  }

  private getUpcomingUnitId(state: GameState, team: TeamId): string | null {
    const order = state.orders[team];
    if (!order) return null;
    for (let offset = 0; offset < order.queue.length; offset += 1) {
      const index = (order.nextIndex + offset) % order.queue.length;
      const unitId = order.queue[index];
      const unit = state.units.find((u) => u.id === unitId && u.alive);
      if (unit) {
        return unit.id;
      }
    }
    return null;
  }

  private getTeamFill(color: string, team: TeamId): string {
    const base = this.parseColor(color);
    const tint = team === 0 ? { r: 64, g: 224, b: 208 } : { r: 255, g: 132, b: 68 };
    const ratio = 0.45;
    const r = Math.round(base.r * (1 - ratio) + tint.r * ratio);
    const g = Math.round(base.g * (1 - ratio) + tint.g * ratio);
    const b = Math.round(base.b * (1 - ratio) + tint.b * ratio);
    return `rgba(${r},${g},${b},0.95)`;
  }

  private parseColor(input: string): { r: number; g: number; b: number } {
    if (input.startsWith('#')) {
      const hex = input.replace('#', '');
      const bigint = parseInt(hex, 16);
      return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255,
      };
    }
    const match = input.match(/rgba?\(([^)]+)\)/);
    if (match) {
      const [r, g, b] = match[1].split(',').map((part) => parseFloat(part.trim()));
      return { r: Number.isFinite(r) ? r : 255, g: Number.isFinite(g) ? g : 255, b: Number.isFinite(b) ? b : 255 };
    }
    return { r: 255, g: 255, b: 255 };
  }

  private replaceAlpha(color: string, alpha: number): string {
    if (color.startsWith('rgba')) {
      const parts = color.replace(/rgba?\(|\)|\s/g, '').split(',');
      const [r, g, b] = parts;
      return `rgba(${r},${g},${b},${alpha})`;
    }
    if (color.startsWith('rgb')) {
      const parts = color.replace(/rgb?\(|\)|\s/g, '').split(',');
      const [r, g, b] = parts;
      return `rgba(${r},${g},${b},${alpha})`;
    }
    const hex = color.replace('#', '');
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }
}

function addVectors(a: Vector, b: Vector): Vector {
  return { x: a.x + b.x, y: a.y + b.y };
}
