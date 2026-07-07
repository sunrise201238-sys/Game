/*
 * Post-build step: rewrite dist/sw.js with the real precache list + a
 * content-derived cache version.
 *
 * Vite emits content-hashed asset filenames (e.g. assets/index-Xj1LbzRa.js).
 * The service worker must precache ALL of them on install so offline loads
 * never depend on the browser HTTP cache or a (possibly spun-down) server.
 * This script scans dist/, builds the URL list, derives a version string from
 * the hashed filenames (so any change busts the cache), and patches the two
 * placeholder lines in the built sw.js.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');
const swPath = join(distDir, 'sw.js');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const EXCLUDE = new Set(['sw.js']);

const files = walk(distDir)
  .map((full) => '/' + relative(distDir, full).split(sep).join('/'))
  .filter((url) => !EXCLUDE.has(url.replace(/^\//, '')));

// Precache list: every built file plus the bare navigation root.
const precache = Array.from(new Set(['/', ...files])).sort();

// Version derived from file CONTENTS (not just names). Vite content-hashes
// JS/CSS filenames, but index.html and manifest.webmanifest have stable names,
// so a change touching only those would not alter the file list. Hashing the
// bytes guarantees any shell/manifest/icon edit produces a new version, which
// busts the cache-first service worker for returning users.
const versionHash = createHash('sha256');
for (const rel of [...files].sort()) {
  versionHash.update(rel);
  versionHash.update('\0');
  versionHash.update(readFileSync(join(distDir, rel)));
}
const version = 'dash-dots-' + versionHash.digest('hex').slice(0, 12);

let sw = readFileSync(swPath, 'utf8');
const before = sw;

sw = sw.replace(
  /const CACHE_VERSION = '[^']*';/,
  `const CACHE_VERSION = '${version}';`
);
sw = sw.replace(
  /const PRECACHE_URLS = \[[^\]]*\];/,
  `const PRECACHE_URLS = ${JSON.stringify(precache)};`
);

if (sw === before) {
  throw new Error('inject-sw-precache: failed to patch dist/sw.js (placeholders not found)');
}

writeFileSync(swPath, sw);
console.log(
  `inject-sw-precache: ${precache.length} URLs precached, version ${version}`
);
