import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workerFile = path.resolve(process.cwd(), 'src/core/workers/chatCore.worker.ts');
const source = await fs.readFile(workerFile, 'utf8');

const forbiddenPatterns = [
  "socket.on('message'",
  "socket.on('onlineUsers'",
  "socket.on('userOnline'",
  "socket.on('userOffline'",
  "socket.on('readReceipt'",
  "socket.on('groupUpdate'",
];

const violations = forbiddenPatterns.filter((pattern) => source.includes(pattern));

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error('[realtime-protocol] legacy socket handlers detected in worker:');
  for (const pattern of violations) {
    // eslint-disable-next-line no-console
    console.error(`  - ${pattern}`);
  }
  process.exit(1);
}

if (!source.includes("socket.on('realtimeBatch'")) {
  // eslint-disable-next-line no-console
  console.error('[realtime-protocol] realtimeBatch handler missing in worker');
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[realtime-protocol] OK');
