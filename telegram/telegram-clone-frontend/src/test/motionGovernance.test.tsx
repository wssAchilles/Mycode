import React, { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SpacePost, type PostData } from '../components/space/SpacePost';
import {
  isBlockingAnimating,
  motionDurations,
  useAnimeScope,
  useMotionPresence,
} from '../core/animation';

const motionMocks = vi.hoisted(() => ({
  apiPost: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../services/apiClient', async () => {
  const actual = await vi.importActual<typeof import('../services/apiClient')>('../services/apiClient');
  return {
    ...actual,
        default: {
      ...actual.default,
      post: motionMocks.apiPost,
    },
  };
});

function mockReducedMotion(matches: boolean) {
  vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function PresenceProbe({ open }: { open: boolean }) {
  const { isPresent } = useMotionPresence(open, motionDurations.fast);
  return isPresent ? <div>present</div> : <div>gone</div>;
}

function HeavyProbe() {
  const motion = useAnimeScope<HTMLDivElement, { runHeavyMotion: () => void }>(
    () => ({
      runHeavyMotion: () => undefined,
    }),
    [],
    { heavy: true, heavyDurationMs: motionDurations.fast },
  );

  useEffect(() => {
    motion.run('runHeavyMotion');
  }, [motion]);

  return <div ref={motion.rootRef} />;
}

function ReducedMotionProbe({ onDuration }: { onDuration: (duration: number) => void }) {
  const motion = useAnimeScope<HTMLDivElement, Record<string, never>>(
    ({ duration }) => {
      onDuration(duration(motionDurations.normal));
      return {};
    },
    [onDuration],
  );

  return <div ref={motion.rootRef} />;
}

function makePost(): PostData {
  return {
    id: 'post-1',
    author: {
      id: 'author-1',
      username: 'alice',
    },
    content: 'hello space',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    likeCount: 0,
    commentCount: 0,
    repostCount: 0,
  };
}

describe('motion governance', () => {
  beforeEach(() => {
    motionMocks.apiPost.mockClear();
    mockReducedMotion(false);
  });

  it('keeps content mounted until presence exit timeout completes', () => {
    vi.useFakeTimers();
    const { rerender } = render(<PresenceProbe open />);

    expect(screen.getByText('present')).toBeInTheDocument();
    rerender(<PresenceProbe open={false} />);
    expect(screen.getByText('present')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(motionDurations.fast + 80);
    });

    expect(screen.getByText('gone')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('uses reduced-motion duration zero inside Anime scope', () => {
    mockReducedMotion(true);
    const onDuration = vi.fn();

    render(<ReducedMotionProbe onDuration={onDuration} />);

    expect(onDuration).toHaveBeenCalledWith(0);
  });

  it('marks heavy scoped animation as blocking for bounded duration', () => {
    vi.useFakeTimers();
    render(<HeavyProbe />);

    expect(isBlockingAnimating()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(motionDurations.fast);
    });

    expect(isBlockingAnimating()).toBe(false);
    vi.useRealTimers();
  });

  it('does not mark heavy scoped animation as blocking under reduced motion', () => {
    vi.useFakeTimers();
    mockReducedMotion(true);
    render(<HeavyProbe />);

    expect(isBlockingAnimating()).toBe(false);

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(isBlockingAnimating()).toBe(false);
    vi.useRealTimers();
  });

  it('releases heavy blocking when the owning Anime scope unmounts', () => {
    vi.useFakeTimers();
    const { unmount } = render(<HeavyProbe />);

    expect(isBlockingAnimating()).toBe(true);

    unmount();

    expect(isBlockingAnimating()).toBe(false);

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(isBlockingAnimating()).toBe(false);
    vi.useRealTimers();
  });

  it('delays SpacePost dismiss callback until the motion layer completes', () => {
    mockReducedMotion(true);
    const onDismiss = vi.fn();

    render(<SpacePost post={makePost()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('更多选项'));
    fireEvent.click(screen.getByText('不感兴趣'));

    expect(motionMocks.apiPost).toHaveBeenCalledWith('/api/space/posts/post-1/not-interested');
    expect(onDismiss).toHaveBeenCalledWith('post-1');
  });
});
