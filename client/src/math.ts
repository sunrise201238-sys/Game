import type { Vector } from './types';

export function add(a: Vector, b: Vector): Vector {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a: Vector, b: Vector): Vector {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(v: Vector, factor: number): Vector {
  return { x: v.x * factor, y: v.y * factor };
}

export function length(v: Vector): number {
  return Math.hypot(v.x, v.y);
}

export function normalize(v: Vector): Vector {
  const len = length(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function clampMagnitude(v: Vector, maxLen: number): Vector {
  const len = length(v);
  if (len <= maxLen) return { ...v };
  const factor = maxLen / (len || 1);
  return scale(v, factor);
}

export function distance(a: Vector, b: Vector): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVector(a: Vector, b: Vector, t: number): Vector {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}
