import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const chatPageFile = path.resolve(process.cwd(), 'src/pages/ChatPage.tsx');
const chatHistoryFile = path.resolve(process.cwd(), 'src/features/chat/components/ChatHistory.tsx');

const chatPageSource = await fs.readFile(chatPageFile, 'utf8');
const chatHistorySource = await fs.readFile(chatHistoryFile, 'utf8');

const requiredChatPagePatterns = [
  { label: 'ChatSidebar mounted', re: /<ChatSidebar\b/ },
  { label: 'ChatHeader mounted', re: /<ChatHeader\b/ },
  { label: 'ChatHistory mounted', re: /<ChatHistory\b/ },
  { label: 'MessageInput mounted', re: /<MessageInput\b/ },
  {
    label: 'connection propagated to input',
    re: /<MessageInput[\s\S]*isConnected=\{(?:socketConnected|canSendMessages)\}/m,
  },
  {
    label: 'connection propagated to sidebar',
    re: /<ChatSidebar[\s\S]*isConnected=\{(?:socketConnected|isConnectionOnline)\}/m,
  },
  { label: 'visible range callback wired', re: /onVisibleRangeChange=\{isSearchMode \|\| isContextMode \? undefined : setVisibleRange\}/ },
  { label: 'worker-side search entry', re: /searchActiveChat\(/ },
  { label: 'worker-side message context entry', re: /loadMessageContext\(/ },
  { label: 'worker-side media upload entry', re: /mediaWorkerClient\.prepareAndUploadFile\(/ },
];

const requiredChatHistoryPatterns = [
  { label: 'virtualization in place', re: /useVirtualizer\(/ },
  { label: 'message row rendering', re: /MessageBubble|MessageRow/ },
];

const violations = [];

for (const rule of requiredChatPagePatterns) {
  if (!rule.re.test(chatPageSource)) {
    violations.push(`ChatPage contract missing: ${rule.label}`);
  }
}

if (/messageAPI\.getMessageContext\s*\(/.test(chatPageSource)) {
  violations.push('ChatPage should not call messageAPI.getMessageContext directly in worker-first mode');
}

if (/mlService\s*\.\s*vfCheck\s*\(/.test(chatPageSource)) {
  violations.push('ChatPage should not run mlService.vfCheck on main thread in worker-first mode');
}

if (/from\s+['"]\.\.\/services\/mlService['"]/.test(chatPageSource)) {
  violations.push('ChatPage should not import mlService directly in worker-first mode');
}

if (/fetch\s*\(\s*[^)]*\/api\/upload/.test(chatPageSource)) {
  violations.push('ChatPage should not upload via fetch(/api/upload) directly in worker-first mode');
}

for (const rule of requiredChatHistoryPatterns) {
  if (!rule.re.test(chatHistorySource)) {
    violations.push(`ChatHistory contract missing: ${rule.label}`);
  }
}

if (violations.length) {
  // eslint-disable-next-line no-console
  console.error('[chat-ui-contract] violations detected:');
  for (const item of violations) {
    // eslint-disable-next-line no-console
    console.error(`  - ${item}`);
  }
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('[chat-ui-contract] OK');
