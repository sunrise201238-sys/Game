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

type UnitColorPalette = Partial<Record<string, string>> & { default: string };

const TEAM_UNIT_BASE_COLORS: Record<TeamId, UnitColorPalette> = {
  0: {
    default: '#2563eb',
    soldier: '#1d4ed8',
    archer: '#2563eb',
    mage: '#38bdf8',
    'perfect-soldier': '#c084fc',
  },
  1: {
    default: '#ea580c',
    soldier: '#dc2626',
    archer: '#f97316',
    mage: '#f97316',
    'perfect-soldier': '#a855f7',
  },
};

const TEAM_UNIT_CORE_COLORS: Record<TeamId, UnitColorPalette> = {
  0: {
    default: 'rgba(96,165,250,0.95)',
    soldier: 'rgba(96,165,250,0.95)',
    archer: 'rgba(129,199,255,0.95)',
    mage: 'rgba(125,211,252,0.95)',
    'perfect-soldier': 'rgba(233,213,255,0.95)',
  },
  1: {
    default: 'rgba(249,115,22,0.95)',
    soldier: 'rgba(248,113,113,0.95)',
    archer: 'rgba(249,115,22,0.95)',
    mage: 'rgba(251,146,60,0.95)',
    'perfect-soldier': 'rgba(233,213,255,0.95)',
  },
};

interface RenderOptions {
  dragOrigin?: Vector | null;
  dragCurrent?: Vector | null;
}

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
    const parent = this.canvas.parentElement as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect();
    const measuredWidth = parentRect?.width ?? this.canvas.getBoundingClientRect().width;
    const fallbackWidth = parent?.clientWidth ?? this.canvas.clientWidth;
    let resolvedWidth = width;
    const widthCandidates = [measuredWidth, fallbackWidth];
    for (const candidate of widthCandidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
        resolvedWidth = candidate;
        break;
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
    try {
      this.prepareFrame();
      this.drawArena();
      this.drawLakes();
      this.drawWalls();
      this.drawZones(state.activeZones);
      this.drawGraves(state.graves);
      this.drawUnits(state);
      this.drawProjectiles(state.activeProjectiles);
      this.drawDragIndicator(state, options);
      this.drawStatus(state);
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

    for (const unit of state.units) {
      if (!unit.alive) {
        continue;
      }

      const isHighlight = Boolean(
        highlightId &&
          unit.id === highlightId &&
          state.activeTeam === unit.team &&
          state.phase !== 'ended'
      );

      const baseColor = this.getUnitBaseColor(unit);
      const fillColor = this.lightenColor(baseColor, unit.team === 0 ? 0.1 : -0.05);
      const strokeColor = isHighlight ? highlightStroke[unit.team] ?? '#ffffff' : teamStroke[unit.team] ?? '#ffffff';
      const centerColor = this.getUnitCoreColor(unit, teamCore);
      const lineWidth = isHighlight ? 4 : 3;

      this.drawUnitShape(unit, fillColor, strokeColor, centerColor, lineWidth, isHighlight);
      if (isHighlight) {
        this.drawHighlightAura(unit, highlightAura[unit.team] ?? strokeColor);
      }
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
    for (const grave of graves) {
      ctx.save();
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
    const clampedPower = smoothedPower * maxPower;
    const projectileSpec = activeUnit.def.projectile;
    const previewScale = projectileSpec?.previewScale ?? 1.2;
    const previewDistance = clampedPower * previewScale;
    const cappedPreviewDistance = projectileSpec
      ? Math.min(projectileSpec.maxDistance, previewDistance)
      : previewDistance;
    const previewEnd = addVectors(dragOrigin, scale(launchDir, cappedPreviewDistance));

    let tipDistance = cappedPreviewDistance;
    let extensionEnd: Vector | null = null;
    if (projectileSpec) {
      const maxDistance = projectileSpec.maxDistance;
      const remaining = Math.max(0, maxDistance - cappedPreviewDistance);
      const requestedExtension = projectileSpec.previewExtension ?? 0;
      const extensionLength = Math.min(requestedExtension, remaining);
      if (extensionLength > 1) {
        tipDistance += extensionLength;
        extensionEnd = addVectors(previewEnd, scale(launchDir, extensionLength));
      } else {
        tipDistance = Math.min(tipDistance, maxDistance);
      }
    }
    const aimTip = extensionEnd ?? previewEnd;

    const { ctx } = this;
    ctx.save();

    const hasProjectile = Boolean(projectileSpec);
    const projectileColor = projectileSpec?.color;
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

    const longDistance = hasProjectile
      ? this.computeAimGuideLength(dragOrigin, launchDir, tipDistance)
      : tipDistance;
    const longEnd = hasProjectile ? addVectors(dragOrigin, scale(launchDir, longDistance)) : aimTip;

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
    ctx.lineTo(previewEnd.x, previewEnd.y);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 22;
    ctx.shadowColor = glowColor;
    const gradient = ctx.createLinearGradient(dragOrigin.x, dragOrigin.y, previewEnd.x, previewEnd.y);
    gradient.addColorStop(0, accent);
    gradient.addColorStop(0.5, baseStroke);
    gradient.addColorStop(1, this.replaceAlpha(baseStroke, 0.92));
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(dragOrigin.x, dragOrigin.y);
    ctx.lineTo(previewEnd.x, previewEnd.y);
    ctx.stroke();

    if (extensionEnd) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = glowColor;
      ctx.lineWidth = 4.2;
      ctx.strokeStyle = this.replaceAlpha(baseStroke, 0.85);
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(previewEnd.x, previewEnd.y);
      ctx.lineTo(extensionEnd.x, extensionEnd.y);
      ctx.stroke();
    }

    if (hasProjectile) {
      const longStart = extensionEnd ?? previewEnd;
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 3.2;
      ctx.setLineDash([18, 14]);
      ctx.strokeStyle = this.replaceAlpha(glowColor, 0.5);
      ctx.beginPath();
      ctx.moveTo(longStart.x, longStart.y);
      ctx.lineTo(longEnd.x, longEnd.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.setLineDash([]);

    const primaryTip = addVectors(aimTip, scale(launchDir, 14));
    this.drawArrowHead(primaryTip, launchDir, 14, baseStroke, 1, glowColor, 18);

    if (hasProjectile) {
      const ghostTip = addVectors(longEnd, scale(launchDir, 10));
      this.drawArrowHead(ghostTip, launchDir, 10, this.replaceAlpha(glowColor, 0.75), 0.55);
    }

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

  private computeAimGuideLength(origin: Vector, direction: Vector, minimum: number): number {
    const EPSILON = 1e-3;
    const { width, height } = this.map;
    const candidates: number[] = [];

    if (Math.abs(direction.x) > EPSILON) {
      const right = (width - origin.x) / direction.x;
      const left = -origin.x / direction.x;
      if (right > 0) candidates.push(right);
      if (left > 0) candidates.push(left);
    }

    if (Math.abs(direction.y) > EPSILON) {
      const bottom = (height - origin.y) / direction.y;
      const top = -origin.y / direction.y;
      if (bottom > 0) candidates.push(bottom);
      if (top > 0) candidates.push(top);
    }

    if (!candidates.length) {
      return Math.max(minimum + 220, Math.hypot(width, height));
    }

    const boundaryDistance = Math.min(...candidates);
    const margin = Math.max(240, boundaryDistance * 0.2);
    return Math.max(minimum + margin * 0.5, boundaryDistance + margin);
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
    ctx.save();
    ctx.translate(unit.position.x, unit.position.y);
    if (highlight) {
      ctx.shadowBlur = 22;
      ctx.shadowColor = strokeColor;
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
      default:
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        break;
    }

    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = coreColor;
    ctx.arc(0, 0, Math.max(3, radius * 0.28), 0, Math.PI * 2);
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
