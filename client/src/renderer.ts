import { GAME_CONSTANTS, HP_BAR_HEIGHT } from './config';
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

type UnitColorPalette = Partial<Record<string, string>> & { default: string };

const TEAM_UNIT_BASE_COLORS: Record<TeamId, UnitColorPalette> = {
  0: {
    default: '#2563eb',
    soldier: '#1d4ed8',
    archer: '#2563eb',
    mage: '#38bdf8',
    'perfect-soldier': '#c084fc',
    vip: '#fbbf24',
    'vip-guardian': '#fbbf24',
    base: '#facc15',
  },
  1: {
    default: '#ea580c',
    soldier: '#dc2626',
    archer: '#f97316',
    mage: '#f97316',
    'perfect-soldier': '#a855f7',
    vip: '#fbbf24',
    'vip-guardian': '#fbbf24',
    base: '#facc15',
  },
};

const TEAM_UNIT_CORE_COLORS: Record<TeamId, UnitColorPalette> = {
  0: {
    default: 'rgba(96,165,250,0.95)',
    soldier: 'rgba(96,165,250,0.95)',
    archer: 'rgba(129,199,255,0.95)',
    mage: 'rgba(125,211,252,0.95)',
    'perfect-soldier': 'rgba(233,213,255,0.95)',
    vip: 'rgba(254,240,138,0.95)',
    'vip-guardian': 'rgba(254,240,138,0.95)',
    base: 'rgba(254,240,138,0.95)',
  },
  1: {
    default: 'rgba(249,115,22,0.95)',
    soldier: 'rgba(248,113,113,0.95)',
    archer: 'rgba(249,115,22,0.95)',
    mage: 'rgba(251,146,60,0.95)',
    'perfect-soldier': 'rgba(233,213,255,0.95)',
    vip: 'rgba(254,240,138,0.95)',
    'vip-guardian': 'rgba(254,240,138,0.95)',
    base: 'rgba(254,240,138,0.95)',
  },
};

const VIP_UNIT_IDS = new Set(['vip', 'vip-guardian']);
const VIP_FILL_COLOR = '#fde047';
const VIP_STROKE_COLOR = '#fbbf24';
const VIP_HIGHLIGHT_STROKE = '#fef3c7';
const VIP_CORE_COLOR = 'rgba(254,240,138,0.95)';
const VIP_HIGHLIGHT_AURA = 'rgba(253,224,71,0.9)';
const BASE_UNIT_ID = 'base';

const FOG_MAP_ID = 'the-rift-fog';
const FOG_MINION_REVEAL_RADIUS = 110;
const FOG_BASE_REVEAL_RADIUS = 300;
const FOG_PROJECTILE_REVEAL_RADIUS = 60;
const FOG_IGNITE_REVEAL_RADIUS = 60;
const FOG_OVERLAY_ALPHA = 0.68;
const FOG_REVEAL_INNER_RATIO = 0.35;
const FOG_REVEAL_MID_RATIO = 0.7;
const FOG_ENEMY_BASE_ALPHA = 0.65;
const FOG_FRIENDLY_GRAVE_ALPHA = 0.55;

interface FogReveal {
  x: number;
  y: number;
  radius: number;
}

interface FogState {
  friendlyTeam: TeamId;
  reveals: FogReveal[];
}

interface RenderOptions {
  dragOrigin?: Vector | null;
  dragCurrent?: Vector | null;
  showLoupe?: boolean;
  // Direct aim: draw the predicted landing straight from the launch power
  // (no slingshot aim curve) so the dot lands exactly under the pointer.
  skipAimCurve?: boolean;
}

const LOUPE_CSS_RADIUS = 58;
const LOUPE_ZOOM = 2.2;

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private map: MapDefinition;
  private dpr = window.devicePixelRatio || 1;
  private baseScale = 1;
  private zoom = 1;
  private offset: Vector = { x: 0, y: 0 };
  private readonly minZoom = 1;
  private readonly maxZoom = 2.5;
  private resizeObserver: ResizeObserver | null = null;
  private pendingResizeFrame: number | null = null;
  private lastState: GameState | null = null;
  private lastOptions: RenderOptions | null = null;
  private isRendering = false;
  private needsRerender = false;
  private perspectiveTeam: TeamId = 0;
  private widthOverride: number | null = null;
  private fogState: FogState | null = null;
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogCtx: CanvasRenderingContext2D | null = null;
  private loupeTip: Vector | null = null;
  private loupeCanvas: HTMLCanvasElement | null = null;
  private loupeCtx: CanvasRenderingContext2D | null = null;

  constructor(canvas: HTMLCanvasElement, map: MapDefinition) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context not available');
    }
    this.canvas = canvas;
    this.ctx = ctx;
    this.map = map;
    this.resetCamera();
    this.updateCanvasSize();
    window.addEventListener('resize', () => this.handleResize());
    this.observeParent();
  }

  setMap(map: MapDefinition): void {
    this.map = map;
    this.resetCamera();
    this.updateCanvasSize();
    this.observeParent();
    this.resetFogCanvas();
  }

  setPerspectiveTeam(team: TeamId): void {
    if (this.perspectiveTeam === team) {
      return;
    }
    this.perspectiveTeam = team;
    if (this.lastState) {
      this.rerender();
    }
  }

  private handleResize(): void {
    if (this.pendingResizeFrame !== null) {
      window.cancelAnimationFrame(this.pendingResizeFrame);
    }
    this.pendingResizeFrame = window.requestAnimationFrame(() => {
      this.pendingResizeFrame = null;
      this.updateCanvasSize();
    });
  }

  private updateCanvasSize(): void {
    const { width, height } = this.map;
    let resolvedWidth = width;
    if (this.widthOverride !== null && Number.isFinite(this.widthOverride) && this.widthOverride > 0) {
      // The board is CSS-rotated, so getBoundingClientRect() reports the rotated
      // bounding box. Use the caller-provided unrotated CSS width instead.
      resolvedWidth = this.widthOverride;
    } else {
      const parent = this.canvas.parentElement as HTMLElement | null;
      const parentRect = parent?.getBoundingClientRect();
      const measuredWidth = parentRect?.width;
      const fallbackWidth = parent?.clientWidth;
      const canvasRectWidth = this.canvas.getBoundingClientRect().width;
      const widthCandidates = [canvasRectWidth, measuredWidth, fallbackWidth, this.canvas.clientWidth, width];
      for (const candidate of widthCandidates) {
        if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
          resolvedWidth = candidate;
          break;
        }
      }
    }

    this.baseScale = resolvedWidth / width;
    const targetPixelWidth = Math.max(1, Math.round(width * this.baseScale * this.dpr));
    const targetPixelHeight = Math.max(1, Math.round(height * this.baseScale * this.dpr));
    this.canvas.width = targetPixelWidth;
    this.canvas.height = targetPixelHeight;
    this.offset = this.clampOffsetForZoom(this.offset, this.zoom);
    this.applyTransform();
    this.rerender();
  }

  private applyTransform(): void {
    const scale = this.baseScale * this.zoom;
    const pixelScale = scale * this.dpr;
    const translateX = -this.offset.x * pixelScale;
    const translateY = -this.offset.y * pixelScale;
    this.ctx.setTransform(pixelScale, 0, 0, pixelScale, translateX, translateY);
  }

  resetCamera(): void {
    this.zoom = 1;
    this.offset = this.clampOffsetForZoom({ x: 0, y: 0 }, this.zoom);
    this.applyTransform();
  }

  getZoom(): number {
    return this.zoom;
  }

  getZoomLimits(): { min: number; max: number } {
    return { min: this.minZoom, max: this.maxZoom };
  }

  getViewSize(): Vector {
    return { x: this.map.width / this.zoom, y: this.map.height / this.zoom };
  }

  getOffset(): Vector {
    return { ...this.offset };
  }

  setZoom(zoom: number, anchor?: Vector): void {
    const clamped = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    const currentView = this.getViewSize();
    const focus = anchor ?? {
      x: this.offset.x + currentView.x / 2,
      y: this.offset.y + currentView.y / 2,
    };
    this.zoom = clamped;
    const nextView = this.getViewSize();
    const desiredOffset = {
      x: focus.x - nextView.x / 2,
      y: focus.y - nextView.y / 2,
    };
    this.offset = this.clampOffsetForZoom(desiredOffset, this.zoom);
    this.applyTransform();
  }

  panBy(delta: Vector): void {
    const desired = { x: this.offset.x + delta.x, y: this.offset.y + delta.y };
    this.offset = this.clampOffsetForZoom(desired, this.zoom);
    this.applyTransform();
  }

  refreshViewport(): void {
    this.updateCanvasSize();
  }

  /**
   * When the board is CSS-rotated (portrait fullscreen), getBoundingClientRect()
   * reports the rotated bounding box, which would mis-scale the canvas. Callers
   * pass the unrotated CSS width here so the backing store stays crisp. Pass null
   * to return to auto-measuring.
   */
  setWidthOverride(width: number | null): void {
    const next = width !== null && Number.isFinite(width) && width > 0 ? width : null;
    if (next === this.widthOverride) {
      return;
    }
    this.widthOverride = next;
    this.updateCanvasSize();
  }

  private observeParent(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const parent = this.canvas.parentElement;
    if (!parent) {
      return;
    }
    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
    } else {
      this.resizeObserver.disconnect();
    }
    this.resizeObserver.observe(parent);
  }

  private clampOffsetForZoom(offset: Vector, zoom: number): Vector {
    const viewWidth = this.map.width / zoom;
    const viewHeight = this.map.height / zoom;
    const extraWidth = Math.max(0, viewWidth - this.map.width);
    const extraHeight = Math.max(0, viewHeight - this.map.height);
    const minX = extraWidth > 0 ? -extraWidth / 2 : 0;
    const maxX = extraWidth > 0 ? extraWidth / 2 : Math.max(0, this.map.width - viewWidth);
    const minY = extraHeight > 0 ? -extraHeight / 2 : 0;
    const maxY = extraHeight > 0 ? extraHeight / 2 : Math.max(0, this.map.height - viewHeight);
    return {
      x: Math.min(Math.max(offset.x, minX), maxX),
      y: Math.min(Math.max(offset.y, minY), maxY),
    };
  }

  render(state: GameState, options: RenderOptions = {}): void {
    this.lastState = state;
    this.lastOptions = { ...options };
    if (this.isRendering) {
      this.needsRerender = true;
      return;
    }
    this.isRendering = true;
    this.needsRerender = false;
    this.loupeTip = null;
    try {
      this.fogState = this.shouldUseFog(state) ? this.buildFogState(state) : null;
      this.prepareFrame();
      this.drawArena();
      this.drawLakes();
      this.drawWalls();
      this.drawZones(state);
      this.drawGraves(state.graves);
      this.drawUnits(state);
      this.drawProjectiles(state.activeProjectiles);
      if (this.fogState) {
        this.drawFogMask(this.fogState);
      }
      this.drawDragIndicator(state, options);
      this.drawStatus(state);
      if (options.showLoupe && this.loupeTip) {
        this.drawAimLoupe(this.loupeTip);
      }
    } finally {
      this.isRendering = false;
      if (this.needsRerender) {
        this.needsRerender = false;
        this.rerender();
      }
    }
  }

  private rerender(): void {
    if (!this.lastState) {
      return;
    }
    if (this.isRendering) {
      this.needsRerender = true;
      return;
    }
    this.needsRerender = false;
    const options = this.lastOptions ? { ...this.lastOptions } : {};
    this.render(this.lastState, options);
  }

  private prepareFrame(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.applyTransform();
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

  private shouldUseFog(state: GameState): boolean {
    return state.mapId === FOG_MAP_ID;
  }

  private resetFogCanvas(): void {
    this.fogCanvas = null;
    this.fogCtx = null;
  }

  private ensureFogContext(): CanvasRenderingContext2D {
    const width = Math.ceil(this.map.width);
    const height = Math.ceil(this.map.height);
    if (!this.fogCanvas) {
      this.fogCanvas = document.createElement('canvas');
      this.fogCanvas.width = width;
      this.fogCanvas.height = height;
    } else if (this.fogCanvas.width !== width || this.fogCanvas.height !== height) {
      this.fogCanvas.width = width;
      this.fogCanvas.height = height;
    }

    if (!this.fogCtx) {
      const ctx = this.fogCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Fog canvas context not available');
      }
      this.fogCtx = ctx;
    }

    return this.fogCtx;
  }

  private buildFogState(state: GameState): FogState {
    const friendlyTeam = this.perspectiveTeam;
    const reveals: FogReveal[] = [];
    const unitLookup = new Map(state.units.map((unit) => [unit.id, unit] as const));

    for (const unit of state.units) {
      if (!unit.alive || unit.team !== friendlyTeam) {
        continue;
      }
      const radius = unit.def.id === BASE_UNIT_ID ? FOG_BASE_REVEAL_RADIUS : FOG_MINION_REVEAL_RADIUS;
      reveals.push({ x: unit.position.x, y: unit.position.y, radius });
    }

    for (const projectile of state.activeProjectiles) {
      if (projectile.ownerTeam === friendlyTeam) {
        reveals.push({ x: projectile.x, y: projectile.y, radius: FOG_PROJECTILE_REVEAL_RADIUS });
      }
    }

    for (const zone of state.activeZones) {
      if (zone.ownerTeam === friendlyTeam) {
        reveals.push({ x: zone.x, y: zone.y, radius: zone.radius });
      }
    }

    for (const status of state.statuses) {
      const unit = unitLookup.get(status.unitId);
      if (!unit || !unit.alive) {
        continue;
      }
      reveals.push({ x: unit.position.x, y: unit.position.y, radius: FOG_IGNITE_REVEAL_RADIUS });
    }

    return { friendlyTeam, reveals };
  }

  private drawFogMask(fog: FogState): void {
    const fogCtx = this.ensureFogContext();
    const fogCanvas = this.fogCanvas!;
    fogCtx.save();
    fogCtx.setTransform(1, 0, 0, 1, 0, 0);
    fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
    fogCtx.fillStyle = `rgba(6, 10, 18, ${FOG_OVERLAY_ALPHA})`;
    fogCtx.fillRect(0, 0, this.map.width, this.map.height);
    fogCtx.globalCompositeOperation = 'destination-out';
    for (const reveal of fog.reveals) {
      this.carveFogReveal(fogCtx, reveal);
    }
    fogCtx.restore();
    this.ctx.drawImage(fogCanvas, 0, 0);
  }

  private carveFogReveal(ctx: CanvasRenderingContext2D, reveal: FogReveal): void {
    if (reveal.radius <= 0) {
      return;
    }
    const innerRadius = Math.max(1, reveal.radius * FOG_REVEAL_INNER_RATIO);
    const midRadius = Math.max(innerRadius, reveal.radius * FOG_REVEAL_MID_RATIO);
    const gradient = ctx.createRadialGradient(reveal.x, reveal.y, innerRadius, reveal.x, reveal.y, reveal.radius);
    const midStop = Math.min(1, midRadius / Math.max(reveal.radius, 1));
    gradient.addColorStop(0, 'rgba(0,0,0,0.9)');
    gradient.addColorStop(midStop, 'rgba(0,0,0,0.45)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(reveal.x, reveal.y, reveal.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  private isCircleVisible(center: Vector, radius: number): boolean {
    if (!this.fogState) {
      return true;
    }
    for (const reveal of this.fogState.reveals) {
      const dx = center.x - reveal.x;
      const dy = center.y - reveal.y;
      const limit = radius + reveal.radius;
      if (dx * dx + dy * dy <= limit * limit) {
        return true;
      }
    }
    return false;
  }

  private drawZones(state: GameState): void {
    const { ctx } = this;
    const zones = state.activeZones;
    for (const zone of zones) {
      if (this.fogState) {
        const isFriendlyZone = zone.ownerTeam === this.fogState.friendlyTeam;
        if (!isFriendlyZone && !this.isCircleVisible({ x: zone.x, y: zone.y }, zone.radius * 0.6)) {
          continue;
        }
      }
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
    const teamStroke: Record<TeamId, string> = {
      0: '#0ea5e9',
      1: '#f97316',
    };
    const teamCore: Record<TeamId, string> = {
      0: 'rgba(96,165,250,0.95)',
      1: 'rgba(249,115,22,0.95)',
    };
    const highlightStroke: Record<TeamId, string> = {
      0: '#dbeafe',
      1: '#ffe4c4',
    };
    const highlightAura: Record<TeamId, string> = {
      0: 'rgba(125,211,252,0.9)',
      1: 'rgba(253,186,116,0.9)',
    };
    const burningUnits = new Set(state.statuses.map((status) => status.unitId));
    const fog = this.fogState;
    const friendlyTeam = fog?.friendlyTeam ?? this.perspectiveTeam;

    for (const unit of state.units) {
      if (!unit.alive) {
        continue;
      }

      const isFriendly = unit.team === friendlyTeam;
      const isBaseUnit = unit.def.id === BASE_UNIT_ID;
      const unitVisible = this.isCircleVisible(unit.position, unit.def.radius * 0.85);
      if (fog && !isFriendly && !unitVisible && !isBaseUnit) {
        continue;
      }

      const dimAlpha = fog && !isFriendly && !unitVisible && isBaseUnit ? FOG_ENEMY_BASE_ALPHA : 1;

      const isHighlight = Boolean(
        highlightId &&
          unit.id === highlightId &&
          state.activeTeam === unit.team &&
          state.phase !== 'ended'
      );

      const isVipUnit = VIP_UNIT_IDS.has(unit.def.id);
      const isVipLike = isVipUnit || isBaseUnit;
      const baseColor = this.getUnitBaseColor(unit);
      let fillColor = this.lightenColor(baseColor, unit.team === 0 ? 0.1 : -0.05);
      let strokeColor = isHighlight ? highlightStroke[unit.team] ?? '#ffffff' : teamStroke[unit.team] ?? '#ffffff';
      let centerColor = this.getUnitCoreColor(unit, teamCore);

      if (isVipUnit) {
        fillColor = VIP_FILL_COLOR;
        strokeColor = isHighlight ? VIP_HIGHLIGHT_STROKE : VIP_STROKE_COLOR;
        centerColor = VIP_CORE_COLOR;
      } else if (isBaseUnit) {
        fillColor = baseColor;
        strokeColor = isHighlight ? VIP_HIGHLIGHT_STROKE : VIP_STROKE_COLOR;
        centerColor = VIP_CORE_COLOR;
      }
      const lineWidth = isHighlight ? 4 : isBaseUnit ? 4 : 3;

      ctx.save();
      if (dimAlpha < 1) {
        ctx.globalAlpha *= dimAlpha;
      }
      this.drawUnitShape(unit, fillColor, strokeColor, centerColor, lineWidth, isHighlight);
      if (isHighlight) {
        const auraColor = isVipLike ? VIP_HIGHLIGHT_AURA : highlightAura[unit.team] ?? strokeColor;
        this.drawHighlightAura(unit, auraColor);
      }
      this.drawHpBar(unit);
      if (burningUnits.has(unit.id)) {
        this.drawBurnIcon(unit);
      }
      ctx.restore();
    }
  }

  private drawProjectiles(projectiles: SimulationFrameProjectile[]): void {
    const { ctx } = this;
    const fog = this.fogState;
    const friendlyTeam = fog?.friendlyTeam ?? this.perspectiveTeam;
    for (const projectile of projectiles) {
      if (fog && projectile.ownerTeam !== friendlyTeam) {
        const visible = this.isCircleVisible({ x: projectile.x, y: projectile.y }, projectile.radius * 1.5);
        if (!visible) {
          continue;
        }
      }
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

  private drawBurnIcon(unit: UnitState): void {
    const { ctx } = this;
    const baseX = unit.position.x;
    const baseY = unit.position.y - unit.def.radius - HP_BAR_HEIGHT - 12;
    const flameSize = Math.max(10, unit.def.radius * 0.6);
    ctx.save();
    ctx.translate(baseX, baseY);
    const scale = flameSize / 12;
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.shadowColor = 'rgba(251,146,60,0.55)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(251,146,60,0.9)';
    ctx.moveTo(0, -8);
    ctx.quadraticCurveTo(6, -4, 3.5, 3.5);
    ctx.quadraticCurveTo(1.5, 8, 0, 8);
    ctx.quadraticCurveTo(-1.5, 8, -3.5, 3.5);
    ctx.quadraticCurveTo(-6, -4, 0, -8);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,244,199,0.92)';
    ctx.beginPath();
    ctx.moveTo(0, -3.5);
    ctx.quadraticCurveTo(2.5, -1.5, 1.3, 3.5);
    ctx.quadraticCurveTo(0.5, 6.5, 0, 6.5);
    ctx.quadraticCurveTo(-0.5, 6.5, -1.3, 3.5);
    ctx.quadraticCurveTo(-2.5, -1.5, 0, -3.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawGraves(graves: GraveMarker[]): void {
    const { ctx } = this;
    const fog = this.fogState;
    const friendlyTeam = fog?.friendlyTeam ?? this.perspectiveTeam;
    for (const grave of graves) {
      const isFriendlyGrave = fog ? grave.team === friendlyTeam : false;
      const graveVisible = this.isCircleVisible(grave.position, 14);
      if (fog && !isFriendlyGrave && !graveVisible) {
        continue;
      }
      ctx.save();
      if (fog && isFriendlyGrave && !graveVisible) {
        ctx.globalAlpha *= FOG_FRIENDLY_GRAVE_ALPHA;
      }
      const markerColor = grave.team === 0 ? 'rgba(148,163,184,0.85)' : 'rgba(250,204,21,0.85)';
      ctx.fillStyle = markerColor;
      ctx.translate(grave.position.x, grave.position.y);
      ctx.rotate(-Math.PI / 8);
      ctx.fillRect(-4, -16, 8, 20);
      ctx.fillRect(-10, -10, 20, 6);
      ctx.restore();
    }
  }

  private drawDragIndicator(state: GameState, options: RenderOptions): void {
    const { dragOrigin, dragCurrent } = options;
    if (!dragOrigin || !dragCurrent) {
      return;
    }
    const nextId = this.getUpcomingUnitId(state, state.activeTeam);
    const activeUnit = nextId ? state.units.find((u) => u.id === nextId) : undefined;
    if (!activeUnit) return;

    const dragVector = { x: dragOrigin.x - dragCurrent.x, y: dragOrigin.y - dragCurrent.y };
    const dragDistance = Math.hypot(dragVector.x, dragVector.y);
    if (dragDistance < 0.5) return;

    const maxPower = activeUnit.def.maxPower;
    if (maxPower <= 0) return;

    const launchDir = normalize(dragVector);
    const basePower = Math.min(maxPower, dragDistance);
    const aimCurveExponent = activeUnit.def.aimCurveExponent ?? 1;
    const aimCurveSmoothing = Math.min(Math.max(activeUnit.def.aimCurveSmoothing ?? 0, 0), 0.5);
    const normalizedPower = basePower / maxPower;
    const curvedPower =
      aimCurveExponent === 1 ? normalizedPower : Math.pow(normalizedPower, Math.max(aimCurveExponent, 1e-3));
    const smoothingFactor = aimCurveSmoothing > 0 ? 1 : 0;
    const smoothedPower = curvedPower + smoothingFactor * (normalizedPower - curvedPower);
    // Direct aim bypasses the slingshot curve so the predicted landing equals
    // the raw launch power (and thus the pointer position).
    const clampedPower = options.skipAimCurve ? basePower : smoothedPower * maxPower;
    const projectileSpec = activeUnit.def.projectile;
    const movementDistance = Math.min(
      this.estimateUnitTravelDistance(clampedPower),
      this.computeBoundaryDistance(dragOrigin, launchDir, activeUnit.def.radius)
    );
    const movementEnd = addVectors(dragOrigin, scale(launchDir, movementDistance));
    const projectileDistance = projectileSpec
      ? Math.min(
        projectileSpec.maxDistance,
        this.computeBoundaryDistance(dragOrigin, launchDir, projectileSpec.radius)
      )
      : 0;
    const projectileEnd = projectileSpec
      ? addVectors(dragOrigin, scale(launchDir, projectileDistance))
      : null;
    const aimTip = movementEnd;
    this.loupeTip = aimTip;

    const { ctx } = this;
    ctx.save();

    const projectileColor = projectileSpec
      ? projectileSpec.teamColors?.[state.activeTeam] ?? projectileSpec.color
      : undefined;
    const baseStroke = projectileColor
      ? this.replaceAlpha(projectileColor, 0.98)
      : state.activeTeam === 0
        ? '#bfdbfe'
        : '#fcd34d';
    const glowColor = projectileColor
      ? this.replaceAlpha(projectileColor, 0.8)
      : state.activeTeam === 0
        ? 'rgba(191,219,254,0.75)'
        : 'rgba(252,211,77,0.75)';
    const accent = '#ffffff';

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.setLineDash([]);

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = this.replaceAlpha(glowColor, 0.6);
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(dragOrigin.x, dragOrigin.y);
    ctx.lineTo(movementEnd.x, movementEnd.y);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 22;
    ctx.shadowColor = glowColor;
    const gradient = ctx.createLinearGradient(dragOrigin.x, dragOrigin.y, movementEnd.x, movementEnd.y);
    gradient.addColorStop(0, accent);
    gradient.addColorStop(0.5, baseStroke);
    gradient.addColorStop(1, this.replaceAlpha(baseStroke, 0.92));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(dragOrigin.x, dragOrigin.y);
    ctx.lineTo(movementEnd.x, movementEnd.y);
    ctx.stroke();

    if (projectileEnd) {
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 3.2;
      ctx.setLineDash([14, 10]);
      ctx.strokeStyle = this.replaceAlpha(baseStroke, 0.72);
      ctx.beginPath();
      ctx.moveTo(dragOrigin.x, dragOrigin.y);
      ctx.lineTo(projectileEnd.x, projectileEnd.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.setLineDash([]);

    const primaryTip = addVectors(aimTip, scale(launchDir, 14));
    this.drawArrowHead(primaryTip, launchDir, 14, baseStroke, 1, glowColor, 18);

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(dragOrigin.x, dragOrigin.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = this.replaceAlpha(baseStroke, 0.8);
    ctx.stroke();

    if (activeUnit.def.aoe) {
      const spec = activeUnit.def.aoe;
      const placementDistance = Math.min(spec.placementRange, clampedPower * spec.travelScale);
      const desired = addVectors(dragOrigin, scale(launchDir, placementDistance));
      const center = {
        x: Math.min(this.map.width - spec.radius, Math.max(spec.radius, desired.x)),
        y: Math.min(this.map.height - spec.radius, Math.max(spec.radius, desired.y)),
      };
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6;
      const zoneColor = spec.teamColors?.[state.activeTeam] ?? spec.color;
      ctx.fillStyle = this.replaceAlpha(zoneColor, 0.35);
      ctx.beginPath();
      ctx.arc(center.x, center.y, spec.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = this.replaceAlpha(zoneColor, 0.85);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, spec.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Public: how far the active unit would travel for a given launch power.
  estimateTravelDistance(power: number): number {
    return this.estimateUnitTravelDistance(power);
  }

  // Public: invert the travel model — the launch power needed to stop at a given
  // distance (used so a directly-aimed dot lands under the pointer). Monotonic,
  // so a short binary search suffices.
  powerForTravelDistance(distance: number, maxPower: number): number {
    if (distance <= 0 || maxPower <= 0) {
      return 0;
    }
    if (distance >= this.estimateUnitTravelDistance(maxPower)) {
      return maxPower;
    }
    let lo = 0;
    let hi = maxPower;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (this.estimateUnitTravelDistance(mid) < distance) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return (lo + hi) / 2;
  }

  private estimateUnitTravelDistance(power: number): number {
    if (power <= 0) {
      return 0;
    }
    const launchSpeed = power * GAME_CONSTANTS.dragPowerScale;
    if (launchSpeed < GAME_CONSTANTS.minVelocity) {
      return 0;
    }
    const damping = GAME_CONSTANTS.friction;
    if (damping <= 0 || damping >= 1) {
      return launchSpeed * GAME_CONSTANTS.timeStep;
    }
    const stopRatio = GAME_CONSTANTS.minVelocity / launchSpeed;
    const stepsToStop = Math.max(1, Math.ceil(Math.log(stopRatio) / Math.log(damping)));
    const geometricSum = (1 - Math.pow(damping, stepsToStop)) / (1 - damping);
    return launchSpeed * GAME_CONSTANTS.timeStep * geometricSum;
  }

  private computeBoundaryDistance(origin: Vector, direction: Vector, padding: number): number {
    const EPSILON = 1e-6;
    const minX = padding;
    const maxX = this.map.width - padding;
    const minY = padding;
    const maxY = this.map.height - padding;
    let tMin = 0;
    let tMax = Number.POSITIVE_INFINITY;

    if (Math.abs(direction.x) <= EPSILON) {
      if (origin.x < minX || origin.x > maxX) {
        return 0;
      }
    } else {
      const tx1 = (minX - origin.x) / direction.x;
      const tx2 = (maxX - origin.x) / direction.x;
      tMin = Math.max(tMin, Math.min(tx1, tx2));
      tMax = Math.min(tMax, Math.max(tx1, tx2));
    }

    if (Math.abs(direction.y) <= EPSILON) {
      if (origin.y < minY || origin.y > maxY) {
        return 0;
      }
    } else {
      const ty1 = (minY - origin.y) / direction.y;
      const ty2 = (maxY - origin.y) / direction.y;
      tMin = Math.max(tMin, Math.min(ty1, ty2));
      tMax = Math.min(tMax, Math.max(ty1, ty2));
    }

    if (!Number.isFinite(tMax) || tMax <= 0 || tMin > tMax) {
      return 0;
    }
    return Math.max(0, tMax);
  }

  private drawArrowHead(
    tip: Vector,
    direction: Vector,
    size: number,
    color: string,
    alpha = 1,
    shadowColor?: string,
    shadowBlur = 0
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(tip.x, tip.y);
    ctx.rotate(Math.atan2(direction.y, direction.x));
    ctx.shadowColor = shadowColor ?? 'transparent';
    ctx.shadowBlur = shadowBlur;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, size * 0.6);
    ctx.lineTo(-size, -size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private ensureLoupeContext(size: number): CanvasRenderingContext2D {
    const dim = Math.max(1, Math.round(size));
    if (!this.loupeCanvas) {
      this.loupeCanvas = document.createElement('canvas');
    }
    if (this.loupeCanvas.width !== dim || this.loupeCanvas.height !== dim) {
      this.loupeCanvas.width = dim;
      this.loupeCanvas.height = dim;
      this.loupeCtx = null;
    }
    if (!this.loupeCtx) {
      const ctx = this.loupeCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Loupe canvas context not available');
      }
      this.loupeCtx = ctx;
    }
    return this.loupeCtx;
  }

  // Magnifying glass over the predicted landing spot. Drawn into the canvas
  // bitmap (so it rotates with the board) by sampling the already-rendered
  // pixels around the tip and re-drawing them enlarged inside a circular clip.
  private drawAimLoupe(worldTip: Vector): void {
    const pixelScale = this.baseScale * this.zoom * this.dpr;
    if (!Number.isFinite(pixelScale) || pixelScale <= 0) {
      return;
    }
    const tipX = (worldTip.x - this.offset.x) * pixelScale;
    const tipY = (worldTip.y - this.offset.y) * pixelScale;
    const destRadius = LOUPE_CSS_RADIUS * this.dpr;
    const srcRadius = destRadius / LOUPE_ZOOM;
    const srcSize = Math.max(1, Math.round(srcRadius * 2));

    // Snapshot the region around the tip BEFORE overpainting it, so the
    // self-overlapping source and destination don't corrupt each other.
    const loupeCanvas = this.loupeCanvas ?? (this.loupeCanvas = document.createElement('canvas'));
    const loupeCtx = this.ensureLoupeContext(srcSize);
    loupeCtx.setTransform(1, 0, 0, 1, 0, 0);
    loupeCtx.clearRect(0, 0, srcSize, srcSize);
    loupeCtx.drawImage(
      this.canvas,
      tipX - srcRadius,
      tipY - srcRadius,
      srcRadius * 2,
      srcRadius * 2,
      0,
      0,
      srcSize,
      srcSize
    );

    const { ctx } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Magnified content, clipped to a circle at the tip.
    ctx.beginPath();
    ctx.arc(tipX, tipY, destRadius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = '#0a1223';
    ctx.fillRect(tipX - destRadius, tipY - destRadius, destRadius * 2, destRadius * 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      loupeCanvas,
      0,
      0,
      srcSize,
      srcSize,
      tipX - destRadius,
      tipY - destRadius,
      destRadius * 2,
      destRadius * 2
    );
    ctx.restore();

    // Ring around the loupe.
    ctx.lineWidth = 2.5 * this.dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6 * this.dpr;
    ctx.beginPath();
    ctx.arc(tipX, tipY, destRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Crosshair marking the exact landing point.
    const cross = 7 * this.dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.4 * this.dpr;
    ctx.beginPath();
    ctx.moveTo(tipX - cross, tipY);
    ctx.lineTo(tipX + cross, tipY);
    ctx.moveTo(tipX, tipY - cross);
    ctx.lineTo(tipX, tipY + cross);
    ctx.stroke();

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
    const teamLabel = state.activeTeam === 0 ? 'Team One' : 'Team Two';
    return `Round ${state.round}: ${teamLabel}`;
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

  private drawUnitShape(
    unit: UnitState,
    fillColor: string,
    strokeColor: string,
    coreColor: string,
    lineWidth: number,
    highlight: boolean
  ): void {
    const { ctx } = this;
    const radius = unit.def.radius;
    const isVip = VIP_UNIT_IDS.has(unit.def.id);
    const isBase = unit.def.id === BASE_UNIT_ID;
    const isVipLike = isVip || isBase;
    ctx.save();
    ctx.translate(unit.position.x, unit.position.y);
    if (highlight) {
      ctx.shadowBlur = 22;
      ctx.shadowColor = strokeColor;
    }

    if (isVipLike) {
      const glowBlur = highlight ? 28 : 16;
      ctx.shadowColor = this.replaceAlpha(strokeColor, highlight ? 0.95 : 0.75);
      ctx.shadowBlur = Math.max(ctx.shadowBlur || 0, glowBlur);
    }

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();

    switch (unit.def.id) {
      case 'archer':
        this.traceArcherShape(radius, unit.team === 0 ? 0 : Math.PI);
        break;
      case 'mage':
        this.traceRegularPolygon(6, radius, Math.PI / 6);
        break;
      case 'vip':
      case 'vip-guardian': {
        const gradient = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);
        gradient.addColorStop(0, this.lightenColor(fillColor, 0.4));
        gradient.addColorStop(0.85, fillColor);
        gradient.addColorStop(1, this.replaceAlpha(strokeColor, 0.9));
        ctx.fillStyle = gradient;
        this.traceStarShape(5, radius, radius * 0.52, -Math.PI / 2);
        break;
      }
      case BASE_UNIT_ID: {
        const halfSide = radius;
        const gradient = ctx.createLinearGradient(-halfSide, -halfSide, halfSide, halfSide);
        gradient.addColorStop(0, this.lightenColor(fillColor, 0.45));
        gradient.addColorStop(0.7, fillColor);
        gradient.addColorStop(1, this.replaceAlpha(strokeColor, 0.9));
        ctx.fillStyle = gradient;
        ctx.rect(-halfSide, -halfSide, halfSide * 2, halfSide * 2);
        break;
      }
      default:
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        break;
    }

    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = coreColor;
    ctx.arc(0, 0, Math.max(3, isVip ? radius * 0.36 : radius * 0.28), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawHighlightAura(unit: UnitState, auraColor: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(unit.position.x, unit.position.y);
    const baseRadius = unit.def.radius + 10;
    const gradient = ctx.createRadialGradient(0, 0, unit.def.radius * 0.4, 0, 0, baseRadius + 6);
    gradient.addColorStop(0, this.replaceAlpha(auraColor, 0.45));
    gradient.addColorStop(1, this.replaceAlpha(auraColor, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius + 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = auraColor;
    ctx.lineWidth = 6;
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = this.replaceAlpha(auraColor, 0.75);
    ctx.beginPath();
    ctx.arc(0, 0, baseRadius + 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private traceArcherShape(radius: number, orientation: number): void {
    for (let i = 0; i < 3; i += 1) {
      const angle = orientation + i * ((2 * Math.PI) / 3);
      const point = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
      if (i === 0) {
        this.ctx.moveTo(point.x, point.y);
      } else {
        this.ctx.lineTo(point.x, point.y);
      }
    }
    this.ctx.closePath();
  }

  private traceRegularPolygon(sides: number, radius: number, rotation = 0): void {
    for (let i = 0; i < sides; i += 1) {
      const angle = rotation + (Math.PI * 2 * i) / sides;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.closePath();
  }

  private traceStarShape(points: number, outerRadius: number, innerRadius: number, rotation = 0): void {
    const step = Math.PI / points;
    for (let i = 0; i < points * 2; i += 1) {
      const angle = rotation + step * i;
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }
    this.ctx.closePath();
  }

  private rotatePoint(point: Vector, angle: number): Vector {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
    };
  }

  private getUnitBaseColor(unit: UnitState): string {
    const palette = TEAM_UNIT_BASE_COLORS[unit.team];
    return palette?.[unit.def.id] ?? palette?.default ?? unit.def.color;
  }

  private getUnitCoreColor(unit: UnitState, defaultCore: Record<TeamId, string>): string {
    const palette = TEAM_UNIT_CORE_COLORS[unit.team];
    return palette?.[unit.def.id] ?? palette?.default ?? defaultCore[unit.team] ?? 'rgba(255,255,255,0.8)';
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

  private lightenColor(input: string, amount: number): string {
    const base = this.parseColor(input);
    const r = Math.round(base.r + (255 - base.r) * amount);
    const g = Math.round(base.g + (255 - base.g) * amount);
    const b = Math.round(base.b + (255 - base.b) * amount);
    return `rgba(${r},${g},${b},0.95)`;
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
