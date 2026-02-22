import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const file = path.resolve(process.cwd(), 'src/core/chat/rolloutPolicy.ts');
const source = await fs.readFile(file, 'utf8');

const requiredPatterns = [
  {
    label: 'matrix version default',
    re: /const\s+DEFAULT_POLICY_MATRIX_VERSION\s*=\s*['"][^'"]+['"]/,
  },
  {
    label: 'reads policy matrix env',
    re: /readString\(\s*['"]VITE_CHAT_POLICY_MATRIX_VERSION['"]\s*,\s*DEFAULT_POLICY_MATRIX_VERSION\s*\)/,
  },
  {
    label: 'reads emergency safe mode env',
    re: /readBool\(\s*['"]VITE_CHAT_EMERGENCY_SAFE_MODE['"]\s*,\s*false\s*\)/,
  },
  {
    label: 'reads locked profile env',
    re: /readBool\(\s*['"]VITE_CHAT_POLICY_PROFILE_LOCKED['"]\s*,\s*false\s*\)/,
  },
  {
    label: 'reads profile env',
    re: /readProfile\(\s*['"]VITE_CHAT_POLICY_PROFILE['"]\s*\)/,
  },
  {
    label: 'reads rollout socket env',
    re: /readPercent\(\s*['"]VITE_CHAT_ROLLOUT_SOCKET_PERCENT['"]\s*,\s*100\s*\)/,
  },
  {
    label: 'reads rollout safety env',
    re: /readPercent\(\s*['"]VITE_CHAT_ROLLOUT_SAFETY_CHECKS_PERCENT['"]\s*,\s*100\s*\)/,
  },
  {
    label: 'reads rollout media env',
    re: /readPercent\(\s*['"]VITE_CHAT_ROLLOUT_MEDIA_POOL_PERCENT['"]\s*,\s*100\s*\)/,
  },
  {
    label: 'supports baseline/canary/safe profile',
    re: /type\s+ChatPolicyProfile\s*=\s*'baseline'\s*\|\s*'canary'\s*\|\s*'safe'/,
  },
  {
    label: 'supports policy source enum',
    re: /type\s+ChatPolicySource\s*=\s*'percent_rollout'\s*\|\s*'manual_locked'\s*\|\s*'emergency_safe_mode'/,
  },
  {
    label: 'runtime policy includes profileLocked field',
    re: /profileLocked:/,
  },
  {
    label: 'runtime policy includes profileSource field',
    re: /profileSource:/,
  },
  {
    label: 'runtime policy includes matrixVersion field',
    re: /matrixVersion,/,
  },
  {
    label: 'emergency mode source override',
    re: /if\s*\(emergencySafeMode\)\s*\{\s*\n\s*return\s+buildPolicy\('safe',\s*'emergency_safe_mode'\);/m,
  },
];

const violations = [];
for (const rule of requiredPatterns) {
  if (!rule.re.test(source)) {
    violations.push(rule.label);
  }
}

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error('[rollout-policy] violations detected:');
  for (const item of violations) {
    // eslint-disable-next-line no-console
    console.error(`  - ${item}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[rollout-policy] OK');
