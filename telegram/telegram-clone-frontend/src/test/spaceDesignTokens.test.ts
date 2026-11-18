import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_BASE_URL, resolveMediaCrossOrigin } from '../utils/apiUrl';

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Space desktop design tokens', () => {
  // 校验全局设计令牌严格对齐 Telegram Space Light 高对比淡色总纲
  it('uses the crisp light and high-contrast dark typography palette as the global baseline', () => {
    const css = readSource('../index.css');

    expect(css).toContain('--background: #FFFFFF');
    expect(css).toContain('--tg-blue: #1D9BF0');
    expect(css).toContain('--color-surface: #F7F9F9');
    expect(css).toContain('--color-text-primary: #0F1419');
    expect(css).toContain('--color-text-secondary: #536471');
    expect(css).toContain('--color-border: #EFF3F4');
    expect(css).not.toContain('Bricolage+Grotesque');
    expect(css).not.toContain('Instrument+Sans');
  });

  it('keeps the Space shell free of legacy blue-purple decorative gradients', () => {
    const shellCss = readSource('../pages/SpacePage.css');
    const timelineCss = readSource('../components/space/SpaceTimeline.css');

    expect(shellCss).not.toContain('#8B5CF6');
    expect(shellCss).not.toContain('rgba(139, 92, 246');
    expect(timelineCss).not.toContain('rgba(135, 116, 225');
    expect(shellCss).toMatch(
      /grid-template-columns:\s*var\(--space-nav-width\)\s*minmax\(0,\s*1fr\)\s*var\(--space-shell-gap\)\s*var\(--space-aside-width\)/,
    );
  });

  // 校验仅对归属后端 API 源的媒体启用 anonymous CORS，避免误伤未开启 CORS 的 GCS 存储桶
  it('enables anonymous CORS only for cross-origin API media and preserves credential-free GCS loads', () => {
    expect(resolveMediaCrossOrigin(`${API_BASE_URL}/api/public/news/uploads/cover.jpg`)).toBe('anonymous');
    expect(resolveMediaCrossOrigin('/api/public/space/uploads/post.png')).toBe('anonymous');
    expect(
      resolveMediaCrossOrigin('https://storage.googleapis.com/telegram-467705-space-uploads/space/uploads/demo.jpg'),
    ).toBeUndefined();
    expect(resolveMediaCrossOrigin('data:image/svg+xml;utf8,<svg/>')).toBeUndefined();
  });
});
