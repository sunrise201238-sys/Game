import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { GameResources } from './types.js';
import type { MapSchema, UnitSchema } from 'aslingshot/shared';

async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

export async function loadResources(root = process.cwd()): Promise<GameResources> {
  const mapsDir = path.join(root, 'maps');
  const unitsDir = path.join(root, 'units');

  const [mapFiles, unitFiles] = await Promise.all([
    readJson<MapSchema[]>(path.join(mapsDir, 'maps.json')),
    readJson<UnitSchema[]>(path.join(unitsDir, 'units.json')),
  ]);

  const unitsById = unitFiles.reduce<Record<string, UnitSchema>>((acc, unit) => {
    acc[unit.id] = unit;
    return acc;
  }, {} as Record<string, UnitSchema>);

  return { maps: mapFiles, units: unitFiles, unitsById };
}
