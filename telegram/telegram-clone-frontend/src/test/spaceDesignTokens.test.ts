import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Space desktop design tokens', () => {
  it('uses the graphite and Telegram cyan palette as the global baseline', () => {
    const css = readSource('../index.css');

    expect(css).toContain('--background: #0A0D12');
    expect(css).toContain('--tg-blue: #2AABEE');
    expect(css).toContain('--color-surface: #101722');
    expect(css).toContain('--color-text-secondary: #A8B3C5');
    expect(css).not.toContain('Bricolage+Grotesque');
    expect(css).not.toContain('Instrument+Sans');
  });

  it('keeps the Space shell free of legacy blue-purple decorative gradients', () => {
    const shellCss = readSource('../pages/SpacePage.css');
    const timelineCss = readSource('../components/space/SpaceTimeline.css');

    expect(shellCss).not.toContain('#8B5CF6');
    expect(shellCss).not.toContain('rgba(139, 92, 246');
    expect(timelineCss).not.toContain('rgba(135, 116, 225');
    expect(shellCss).toContain('grid-template-columns: var(--space-nav-width) var(--space-shell-gap) minmax(620px, var(--space-main-max))');
  });
});
