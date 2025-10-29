import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { GameResources } from './types';
import type { MapSchema, UnitSchema } from '@slingshot/shared';

async function readJson<T>(filePath: string): Promise<T> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

async function readJsonWithFallback<T>(candidates: string[]): Promise<T> {
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await readJson<T>(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError ?? new Error('No JSON file candidates were provided.');
}

export async function loadResources(root = process.cwd()): Promise<GameResources> {
  const searchRoots = [root, path.resolve(root, '..')];
  const mapCandidates = searchRoots.map((dir) => path.join(dir, 'maps', 'maps.json'));
  const unitCandidates = searchRoots.map((dir) => path.join(dir, 'units', 'units.json'));

  const [mapFiles, unitFiles] = await Promise.all([
    readJsonWithFallback<MapSchema[]>(mapCandidates),
    readJsonWithFallback<UnitSchema[]>(unitCandidates),
  ]);

  const unitsById = unitFiles.reduce<Record<string, UnitSchema>>((acc, unit) => {
    acc[unit.id] = unit;
    return acc;
  }, {} as Record<string, UnitSchema>);

  return { maps: mapFiles, units: unitFiles, unitsById };
}
