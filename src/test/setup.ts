import '@testing-library/jest-dom/vitest';

globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0);
globalThis.cancelAnimationFrame = (id: number) => window.clearTimeout(id);

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverMock;
