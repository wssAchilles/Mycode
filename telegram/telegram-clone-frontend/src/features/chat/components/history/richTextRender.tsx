import React from 'react';

export type HighlightConfig = { termLower: string; regex: RegExp } | null;

const INLINE_TOKEN_RE = /(```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s<>"'`]+|@[a-zA-Z0-9_\u4e00-\u9fa5.-]+)/g;

function renderHighlightedSegment(
  text: string,
  highlightConfig: HighlightConfig,
  keyPrefix: string,
): React.ReactNode {
  if (!highlightConfig || !text) return text;
  const parts = text.split(highlightConfig.regex);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.toLowerCase() === highlightConfig.termLower) {
      return (
        <mark key={`${keyPrefix}-hl-${idx}`} className="tg-highlight">
          {part}
        </mark>
      );
    }
    return <React.Fragment key={`${keyPrefix}-tx-${idx}`}>{part}</React.Fragment>;
  });
}

function splitTrailingUrlPunctuation(rawUrl: string): { url: string; suffix: string } {
  const match = rawUrl.match(/^(.*?)([.,!?;:)\]]+)$/);
  if (!match) return { url: rawUrl, suffix: '' };
  return { url: match[1] || rawUrl, suffix: match[2] || '' };
}

/**
 * 轻量安全富文本渲染器：
 * 支持三反引号代码块、行内代码、可点击 HTTP(S) 外链、@提及高亮与搜索词高亮共存
 */
export function renderChatRichText(
  content: string,
  options: {
    messageId: string;
    highlightConfig?: HighlightConfig;
    currentUsername?: string;
    isOut?: boolean;
  },
): React.ReactNode {
  if (!content) return null;
  const { messageId, highlightConfig = null, currentUsername } = options;
  const currentUserLower = currentUsername?.trim().toLowerCase() || '';

  const tokens = content.split(INLINE_TOKEN_RE);
  if (tokens.length === 1 && !highlightConfig) {
    return content;
  }

  return tokens.map((token, idx) => {
    if (!token) return null;
    const key = `${messageId}-rt-${idx}`;

    if (token.startsWith('```') && token.endsWith('```') && token.length >= 6) {
      const inner = token.slice(3, -3).replace(/^\n/, '').replace(/\n$/, '');
      return (
        <pre key={key} className="tg-chat-code-block">
          <code>{inner}</code>
        </pre>
      );
    }

    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      return (
        <code key={key} className="tg-chat-inline-code">
          {renderHighlightedSegment(token.slice(1, -1), highlightConfig, key)}
        </code>
      );
    }

    if (token.startsWith('http://') || token.startsWith('https://')) {
      const { url, suffix } = splitTrailingUrlPunctuation(token);
      return (
        <React.Fragment key={key}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="tg-chat-link"
            onClick={(event) => event.stopPropagation()}
          >
            {renderHighlightedSegment(url, highlightConfig, key)}
          </a>
          {suffix ? renderHighlightedSegment(suffix, highlightConfig, `${key}-suf`) : null}
        </React.Fragment>
      );
    }

    if (token.startsWith('@') && token.length > 1) {
      const mentionName = token.slice(1).toLowerCase();
      const isSelfMention = Boolean(
        (currentUserLower && mentionName === currentUserLower)
        || mentionName === '所有人'
        || mentionName === 'all',
      );
      return (
        <span
          key={key}
          className={`tg-chat-mention ${isSelfMention ? 'is-self' : ''}`}
        >
          {renderHighlightedSegment(token, highlightConfig, key)}
        </span>
      );
    }

    return (
      <React.Fragment key={key}>
        {renderHighlightedSegment(token, highlightConfig, key)}
      </React.Fragment>
    );
  });
}
