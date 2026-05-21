/**
 * Message Parser Worker
 * Offloads markdown/emoji/link parsing from main thread.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParseSinglePayload {
  text: string;
  messageId?: string;
}

interface ParseBatchPayload {
  messages: Array<{ text: string; messageId: string }>;
}

type ParseRequest =
  | { id: string; type: 'parse'; payload: ParseSinglePayload }
  | { id: string; type: 'batch_parse'; payload: ParseBatchPayload };

interface ParsedEntity {
  type: 'link' | 'mention' | 'hashtag' | 'code';
  text: string;
  start: number;
  end: number;
  url?: string;
}

interface ParsedContent {
  html: string;
  plainText: string;
  hasEmoji: boolean;
  emojiOnlyCount: number;
  entities: ParsedEntity[];
  estimatedHeight: number;
}

type ParseResponse =
  | { id: string; type: 'parse_result'; result: ParsedContent }
  | { id: string; type: 'batch_parse_result'; result: Record<string, ParsedContent> };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Average line height in pixels used for virtual-list height estimation. */
const LINE_HEIGHT_PX = 22;

/** Horizontal padding + margins baked into a message bubble. */
const BUBBLE_PADDING_PX = 24;

/** Characters per line heuristic (varies with font, but good enough). */
const CHARS_PER_LINE = 42;

/**
 * Full emoji detection regex (covers most of Unicode emoji ranges).
 * Uses a non-capturing group so we can match multi-codepoint sequences
 * (ZWJ sequences, skin-tone modifiers, flags, keycaps, etc.).
 */
const EMOJI_RE =
  /(?:\p{Emoji_Presentation}|\p{Emoji}️)(?:‍(?:\p{Emoji_Presentation}|\p{Emoji}️)|️|⃣|[\u{1F3FB}-\u{1F3FF}]|\u{E0020}-\u{E007E})*/gu;

/** Matches a standalone emoji sequence (possibly with whitespace between). */
const EMOJI_ONLY_RE =
  /^(?:\s*(?:\p{Emoji_Presentation}|\p{Emoji}️)(?:‍(?:\p{Emoji_Presentation}|\p{Emoji}️)|️|⃣|[\u{1F3FB}-\u{1F3FF}]|\u{E0020}-\u{E007E})*\s*)+$/u;

// ---------------------------------------------------------------------------
// Entity extraction
// ---------------------------------------------------------------------------

/** URL pattern: http(s)://... or common bare-domain forms. */
const URL_RE =
  /https?:\/\/[^\s<>"')\]]+/g;

/** @mention pattern: @word (letters, digits, underscores, 2-32 chars). */
const MENTION_RE = /@([\w]{2,32})/g;

/** #hashtag pattern: #word (letters, digits, underscores, 2-64 chars). */
const HASHTAG_RE = /#([\w一-鿿]{2,64})/g;

/** Inline code: `...`  (no nested backticks). */
const INLINE_CODE_RE = /`([^`\n]+)`/g;

/** Code block: ```...``` */
const CODE_BLOCK_RE = /```(\w*)\n?([\s\S]*?)```/g;

function extractEntities(text: string): ParsedEntity[] {
  const entities: ParsedEntity[] = [];

  // Code blocks first (higher priority — skip inner matches)
  let match: RegExpExecArray | null;

  CODE_BLOCK_RE.lastIndex = 0;
  while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
    entities.push({
      type: 'code',
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  INLINE_CODE_RE.lastIndex = 0;
  while ((match = INLINE_CODE_RE.exec(text)) !== null) {
    if (!isInsideCodeBlock(entities, match.index)) {
      entities.push({
        type: 'code',
        text: match[1],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // URLs
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (!isInsideCodeBlock(entities, match.index)) {
      entities.push({
        type: 'link',
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        url: match[0],
      });
    }
  }

  // Mentions
  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(text)) !== null) {
    if (!isInsideExistingEntity(entities, match.index)) {
      entities.push({
        type: 'mention',
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // Hashtags
  HASHTAG_RE.lastIndex = 0;
  while ((match = HASHTAG_RE.exec(text)) !== null) {
    if (!isInsideExistingEntity(entities, match.index)) {
      entities.push({
        type: 'hashtag',
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  // Sort by start position for stable rendering
  return entities.sort((a, b) => a.start - b.start);
}

function isInsideCodeBlock(entities: ParsedEntity[], index: number): boolean {
  return entities.some(
    (e) => e.type === 'code' && index >= e.start && index < e.end,
  );
}

function isInsideExistingEntity(entities: ParsedEntity[], index: number): boolean {
  return entities.some(
    (e) => index >= e.start && index < e.end,
  );
}

// ---------------------------------------------------------------------------
// HTML rendering (safe — escapes user text)
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Minimal markdown: **bold**, *italic*, __underline__. */
function applyInlineMarkdown(text: string): string {
  // Bold: **text**
  let result = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*  (but not inside **)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // Underline: __text__
  result = result.replace(/__(.+?)__/g, '<u>$1</u>');
  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>');
  return result;
}

function renderToHtml(text: string, entities: ParsedEntity[]): string {
  if (entities.length === 0) {
    return applyInlineMarkdown(escapeHtml(text));
  }

  const parts: string[] = [];
  let cursor = 0;

  for (const entity of entities) {
    // Text before this entity
    if (entity.start > cursor) {
      parts.push(applyInlineMarkdown(escapeHtml(text.slice(cursor, entity.start))));
    }

    // The entity itself
    switch (entity.type) {
      case 'link': {
        const safeUrl = escapeHtml(entity.url ?? entity.text);
        const safeText = escapeHtml(entity.text);
        parts.push(`<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeText}</a>`);
        break;
      }
      case 'mention':
        parts.push(`<span class="mention">${escapeHtml(entity.text)}</span>`);
        break;
      case 'hashtag':
        parts.push(`<span class="hashtag">${escapeHtml(entity.text)}</span>`);
        break;
      case 'code':
        if (entity.text === text.slice(entity.start, entity.end) && entity.text.includes('\n')) {
          parts.push(`<pre><code>${escapeHtml(entity.text)}</code></pre>`);
        } else {
          parts.push(`<code>${escapeHtml(entity.text)}</code>`);
        }
        break;
    }

    cursor = entity.end;
  }

  // Remaining text after last entity
  if (cursor < text.length) {
    parts.push(applyInlineMarkdown(escapeHtml(text.slice(cursor))));
  }

  return parts.join('');
}

// ---------------------------------------------------------------------------
// Plain text (for search indexing)
// ---------------------------------------------------------------------------

function stripFormatting(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').replace(/```/g, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .trim();
}

// ---------------------------------------------------------------------------
// Emoji detection
// ---------------------------------------------------------------------------

function detectEmoji(text: string): { hasEmoji: boolean; emojiOnlyCount: number } {
  const emojiMatches = text.match(EMOJI_RE);
  const hasEmoji = emojiMatches !== null && emojiMatches.length > 0;

  // "Emoji-only" means the entire message is just emoji + whitespace
  // Telegram shows these at a larger size (up to ~3 big emoji)
  const isEmojiOnly = EMOJI_ONLY_RE.test(text);
  const emojiOnlyCount = isEmojiOnly && emojiMatches ? emojiMatches.length : 0;

  return { hasEmoji, emojiOnlyCount };
}

// ---------------------------------------------------------------------------
// Height estimation (for virtual list)
// ---------------------------------------------------------------------------

function estimateHeight(text: string, entities: ParsedEntity[]): number {
  const lineCount = estimateLineCount(text, entities);
  const hasCodeBlock = entities.some((e) => e.type === 'code' && text.slice(e.start, e.end).includes('\n'));

  // Base height from line count
  let height = lineCount * LINE_HEIGHT_PX + BUBBLE_PADDING_PX;

  // Code blocks get extra padding
  if (hasCodeBlock) {
    height += 16;
  }

  // Emoji-only messages render bigger
  const { emojiOnlyCount } = detectEmoji(text);
  if (emojiOnlyCount > 0 && emojiOnlyCount <= 3) {
    height = Math.max(height, emojiOnlyCount === 1 ? 48 : emojiOnlyCount === 2 ? 72 : 96);
  }

  return Math.ceil(height);
}

function estimateLineCount(text: string, entities: ParsedEntity[]): number {
  // Count explicit newlines
  const newlineCount = (text.match(/\n/g) ?? []).length;

  // Count code block lines
  const codeBlockLines = entities
    .filter((e) => e.type === 'code' && text.slice(e.start, e.end).includes('\n'))
    .reduce((sum, e) => sum + (text.slice(e.start, e.end).match(/\n/g)?.length ?? 0), 0);

  // Non-code text length for wrap estimation
  const codeLength = entities
    .filter((e) => e.type === 'code')
    .reduce((sum, e) => sum + (e.end - e.start), 0);

  const plainLength = text.length - codeLength;
  const wrapLines = Math.ceil(plainLength / CHARS_PER_LINE);

  // Use the larger of explicit lines vs wrap estimate, plus code block lines
  const textLines = Math.max(newlineCount - codeBlockLines + 1, wrapLines);

  return textLines + codeBlockLines;
}

// ---------------------------------------------------------------------------
// Main parse pipeline
// ---------------------------------------------------------------------------

function parseMessage(text: string): ParsedContent {
  const entities = extractEntities(text);
  const html = renderToHtml(text, entities);
  const plainText = stripFormatting(text);
  const emojiInfo = detectEmoji(text);
  const estimatedHeight = estimateHeight(text, entities);

  return {
    html,
    plainText,
    hasEmoji: emojiInfo.hasEmoji,
    emojiOnlyCount: emojiInfo.emojiOnlyCount,
    entities,
    estimatedHeight,
  };
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, type, payload } = event.data;

  if (type === 'parse') {
    const { text } = payload as ParseSinglePayload;
    const result = parseMessage(text);
    const response: ParseResponse = { id, type: 'parse_result', result };
    self.postMessage(response);
  } else if (type === 'batch_parse') {
    const { messages } = payload as ParseBatchPayload;
    const results: Record<string, ParsedContent> = {};
    for (const msg of messages) {
      results[msg.messageId] = parseMessage(msg.text);
    }
    const response: ParseResponse = { id, type: 'batch_parse_result', result: results };
    self.postMessage(response);
  }
};
