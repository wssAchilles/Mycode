import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd(), 'src');
const appFile = path.resolve(process.cwd(), 'src/App.tsx');
const allowedSocketIoClientImports = new Set([
  path.resolve(process.cwd(), 'src/core/workers/chatCore.worker.ts'),
]);
const forbiddenLegacySocketFiles = [
  path.resolve(process.cwd(), 'src/services/socketService.ts'),
  path.resolve(process.cwd(), 'src/hooks/useSocket.ts'),
];

async function walk(dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test') continue;
      await walk(full, out);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function hasImport(source, pattern) {
  return new RegExp(`from\\s+['"]${pattern}['"]`).test(source);
}

const files = await walk(root);
const violations = [];

for (const file of files) {
  const source = await fs.readFile(file, 'utf8');

  if (hasImport(source, 'socket\\.io-client') && !allowedSocketIoClientImports.has(file)) {
    violations.push(
      `${path.relative(process.cwd(), file)} imports socket.io-client outside allowed worker/service boundary`,
    );
  }
  if (hasImport(source, '\\.\\./services/socketService') || hasImport(source, '\\./services/socketService')) {
    violations.push(
      `${path.relative(process.cwd(), file)} imports legacy main-thread socketService`,
    );
  }
  if (hasImport(source, '\\.\\./hooks/useSocket') || hasImport(source, '\\./hooks/useSocket')) {
    violations.push(
      `${path.relative(process.cwd(), file)} imports legacy useSocket hook in worker-first mode`,
    );
  }
}

for (const forbidden of forbiddenLegacySocketFiles) {
  try {
    await fs.access(forbidden);
    violations.push(`${path.relative(process.cwd(), forbidden)} should be removed in worker-first mode`);
  } catch {
    // File removed as expected.
  }
}

const appSource = await fs.readFile(appFile, 'utf8');
if (hasImport(appSource, '\\./hooks/useSocket') || /useSocketEffect\s*\(/.test(appSource)) {
  violations.push('src/App.tsx should not wire main-thread useSocketEffect in worker-first mode');
}

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error('[socket-boundary] violations detected:');
  for (const item of violations) {
    // eslint-disable-next-line no-console
    console.error(`  - ${item}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[socket-boundary] OK');
