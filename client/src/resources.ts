import maps from '../maps/maps.json';
import units from '../units/units.json';
import type { MapSchema, UnitSchema } from '@slingshot/shared';

export const MAPS: MapSchema[] = maps as MapSchema[];
export const UNITS: UnitSchema[] = units as UnitSchema[];
export const UNITS_BY_ID: Record<string, UnitSchema> = Object.fromEntries(
  (units as UnitSchema[]).map((unit) => [unit.id, unit]),
);

export default maps;
