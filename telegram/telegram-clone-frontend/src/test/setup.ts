/**
 * 测试环境设置
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

const createMemoryStorage = (): Storage => {
    let store: Record<string, string> = {};

    return {
        get length() {
            return Object.keys(store).length;
        },
        clear: () => {
            store = {};
        },
        getItem: (key: string) => store[key] ?? null,
        key: (index: number) => Object.keys(store)[index] ?? null,
        removeItem: (key: string) => {
            delete store[key];
        },
        setItem: (key: string, value: string) => {
            store[key] = String(value);
        },
    };
};

const ensureStorage = (name: 'localStorage' | 'sessionStorage') => {
    if (typeof globalThis[name] !== 'undefined') return;

    Object.defineProperty(globalThis, name, {
        configurable: true,
        value: createMemoryStorage(),
    });
};

ensureStorage('localStorage');
ensureStorage('sessionStorage');

// 每个测试后清理
afterEach(() => {
    cleanup();
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

// Mock IntersectionObserver
class MockIntersectionObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: MockIntersectionObserver,
});

// Mock ResizeObserver
class MockResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: MockResizeObserver,
});

// Mock scrollTo
Object.defineProperty(window, 'scrollTo', {
    writable: true,
    value: vi.fn(),
});

// 清理 localStorage
beforeEach(() => {
    localStorage.clear();
});
