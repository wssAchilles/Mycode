import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
    expect(shellCss).toContain(
      'grid-template-columns: var(--space-nav-width) minmax(560px, var(--space-main-max)) var(--space-shell-gap) var(--space-aside-width)',
    );
  });
});
