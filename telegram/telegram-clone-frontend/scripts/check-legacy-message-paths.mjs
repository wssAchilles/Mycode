import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd(), 'src');
const ALLOWED_FILES = new Set([
  path.resolve(process.cwd(), 'src/services/apiClient.ts'),
]);
const LEGACY_PATTERNS = [
  '/api/messages/conversation/',
  '/api/messages/group/',
];

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const next = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test') continue;
      await walk(next, out);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(entry.name)) continue;
    out.push(next);
  }
  return out;
}

function shouldIgnoreLine(filePath, line) {
  if (!ALLOWED_FILES.has(filePath)) return false;
  return line.includes('LEGACY_MESSAGE_ENDPOINT_BLOCKED') || line.includes('LEGACY_MESSAGE_PATH_RE');
}

const files = await walk(ROOT);
const violations = [];

for (const file of files) {
  const text = await fs.readFile(file, 'utf8');
  const lines = text.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx];
    if (shouldIgnoreLine(file, line)) continue;
    for (const pattern of LEGACY_PATTERNS) {
      if (!line.includes(pattern)) continue;
      violations.push({
        file: path.relative(process.cwd(), file),
        line: idx + 1,
        pattern,
      });
    }
  }
}

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error('[cursor-downline] Found legacy message endpoint references:');
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`  - ${v.file}:${v.line} -> ${v.pattern}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[cursor-downline] OK');
