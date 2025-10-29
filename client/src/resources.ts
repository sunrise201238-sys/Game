import maps from '../maps/maps.json';
import units from './units/units.json';
import type { MapSchema, UnitSchema } from '@slingshot/shared';

const rawMaps = (maps as { maps?: unknown })?.maps ?? maps;
export const MAPS: MapSchema[] = Array.isArray(rawMaps) ? (rawMaps as MapSchema[]) : [];

export const UNITS: UnitSchema[] = Array.isArray(units) ? (units as UnitSchema[]) : [];
export const UNITS_BY_ID: Record<string, UnitSchema> = Object.fromEntries(
  UNITS.map((unit) => [unit.id, unit]),
);

export default maps;
