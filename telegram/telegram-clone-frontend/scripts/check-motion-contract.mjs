import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

const CSS_TRANSITION_ALL_RE = /transition\s*:\s*all\b/i;
const INFINITE_ANIMATION_RE = /animation(?:-iteration-count)?\s*:[^;]*\binfinite\b/gi;
const ANIMATION_NAME_RE = /animation\s*:\s*([a-zA-Z0-9_-]+)/i;
const ALLOWED_INFINITE_ANIMATION_RE = /(spin|typing|skeleton|shimmer|loading|dot|wave)/i;
const LAYOUT_MOTION_PROP_RE = /\b(height|width|top|left|right|bottom)\s*:/i;

const VIRTUAL_LIST_BOUNDARIES = new Set([
  path.join(SRC, 'features', 'chat', 'components', 'ChatHistory.tsx'),
  path.join(SRC, 'components', 'chat', 'VirtualMessageList.tsx'),
  path.join(SRC, 'components', 'space', 'SpaceTimeline.tsx'),
]);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (/\.(ts|tsx|js|jsx|css)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function rel(file) {
  return path.relative(ROOT, file);
}

const violations = [];
const files = await walk(SRC);

for (const file of files) {
  const source = await fs.readFile(file, 'utf8');

  if (file.endsWith('.css')) {
    const transitionMatch = source.match(CSS_TRANSITION_ALL_RE);
    if (transitionMatch?.index != null) {
      violations.push(`${rel(file)}:${lineNumber(source, transitionMatch.index)} transition: all is forbidden`);
    }

    for (const match of source.matchAll(INFINITE_ANIMATION_RE)) {
      const declaration = match[0];
      const name = declaration.match(ANIMATION_NAME_RE)?.[1] ?? declaration;
      if (!ALLOWED_INFINITE_ANIMATION_RE.test(name)) {
        violations.push(`${rel(file)}:${lineNumber(source, match.index ?? 0)} infinite animation "${name}" is not whitelisted`);
      }
    }
  }

  if (VIRTUAL_LIST_BOUNDARIES.has(file)) {
    const unsafeAnimationBlock =
      /waapi\.animate\s*\([^)]*{[\s\S]*?}\s*\)/g;
    for (const match of source.matchAll(unsafeAnimationBlock)) {
      if (LAYOUT_MOTION_PROP_RE.test(match[0])) {
        violations.push(`${rel(file)}:${lineNumber(source, match.index ?? 0)} virtualized list must not animate layout properties`);
      }
    }
  }
}

if (violations.length) {
  console.error('[motion-contract] violations detected:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log('[motion-contract] OK');
