import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const ALLOWED_ANIME_IMPORTS = new Set([
  'animejs/scope',
  'animejs/timeline',
  'animejs/utils',
  'animejs/waapi',
]);
const ALLOWED_SOURCE_PREFIXES = [
  path.join(SRC, 'core', 'animation') + path.sep,
];
const FORBIDDEN_EXACT_FILES = new Set([
  path.join(SRC, 'features', 'chat', 'components', 'ChatHistory.tsx'),
  path.join(SRC, 'components', 'space', 'SpaceTimeline.tsx'),
]);
const FORBIDDEN_DIR_SEGMENTS = [
  `${path.sep}services${path.sep}`,
  `${path.sep}store${path.sep}`,
  `${path.sep}stores${path.sep}`,
  `${path.sep}workers${path.sep}`,
  `${path.sep}core${path.sep}workers${path.sep}`,
  `${path.sep}pwa${path.sep}`,
];

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function isAllowedAnimationSource(file) {
  return ALLOWED_SOURCE_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function isForbiddenRuntimeSource(file) {
  if (FORBIDDEN_EXACT_FILES.has(file)) return true;
  return FORBIDDEN_DIR_SEGMENTS.some((segment) => file.includes(segment));
}

const violations = [];
const files = await walk(SRC);

for (const file of files) {
  const source = await fs.readFile(file, 'utf8');
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1];
    if (!specifier.startsWith('animejs')) continue;

    const rel = path.relative(ROOT, file);
    if (specifier === 'animejs') {
      violations.push(`${rel}: root animejs import is forbidden`);
      continue;
    }

    if (!ALLOWED_ANIME_IMPORTS.has(specifier)) {
      violations.push(`${rel}: unsupported Anime.js subpath "${specifier}"`);
      continue;
    }

    if (!isAllowedAnimationSource(file) || isForbiddenRuntimeSource(file)) {
      violations.push(`${rel}: import Anime.js through src/core/animation only`);
    }
  }
}

if (violations.length) {
  console.error('[motion-boundary] violations detected:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('[motion-boundary] OK');
