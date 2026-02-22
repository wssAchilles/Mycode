import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const routesFile = path.resolve(process.cwd(), 'src/routes/index.tsx');
const dashboardFile = path.resolve(process.cwd(), 'src/components/admin/Dashboard.tsx');
const runtimeDashboardFile = path.resolve(process.cwd(), 'src/components/admin/ChatRuntimeDashboard.tsx');

const [routesSource, dashboardSource, runtimeSource] = await Promise.all([
  fs.readFile(routesFile, 'utf8'),
  fs.readFile(dashboardFile, 'utf8'),
  fs.readFile(runtimeDashboardFile, 'utf8'),
]);

const checks = [
  {
    ok: /ChatRuntimeDashboard/.test(routesSource),
    reason: 'routes should lazy-load ChatRuntimeDashboard',
  },
  {
    ok: /path="\/admin\/chat-runtime"/.test(routesSource),
    reason: 'routes should expose /admin/chat-runtime',
  },
  {
    ok: /to="\/admin\/chat-runtime"/.test(dashboardSource),
    reason: 'Dashboard should provide entry link to chat runtime page',
  },
  {
    ok: /opsAPI\.getChatRuntimeSnapshot\(/.test(runtimeSource),
    reason: 'ChatRuntimeDashboard should fetch backend ops snapshot',
  },
  {
    ok: /chatCoreClient\.getRuntimeInfo\(/.test(runtimeSource),
    reason: 'ChatRuntimeDashboard should read worker runtime info',
  },
  {
    ok: /resolveChatRuntimePolicy\(/.test(runtimeSource),
    reason: 'ChatRuntimeDashboard should render rollout policy for current user',
  },
  {
    ok: /profileSource/.test(runtimeSource) && /matrixVersion/.test(runtimeSource),
    reason: 'ChatRuntimeDashboard should display policy source + matrix version',
  },
];

const violations = checks.filter((item) => !item.ok).map((item) => item.reason);

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error('[chat-runtime-dashboard] violations detected:');
  for (const item of violations) {
    // eslint-disable-next-line no-console
    console.error(`  - ${item}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[chat-runtime-dashboard] OK');
