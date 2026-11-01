import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('App guide redirect', () => {
  it('redirects to /guide/index.html when accessing /guide without login', () => {
    const originalLocation = window.location;
    const replaceMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, pathname: '/guide', replace: replaceMock },
    });

    window.history.pushState({}, '', '/guide');
    render(<App />);

    expect(replaceMock).toHaveBeenCalledWith('/guide/index.html');
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('redirects to /guide/index.html when accessing /guide/foo', () => {
    const originalLocation = window.location;
    const replaceMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, pathname: '/guide/sub', replace: replaceMock },
    });

    window.history.pushState({}, '', '/guide/sub');
    render(<App />);

    expect(replaceMock).toHaveBeenCalledWith('/guide/index.html');
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('redirects to /guide/index.html when accessing /antigravity-guide', () => {
    const originalLocation = window.location;
    const replaceMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, pathname: '/antigravity-guide', replace: replaceMock },
    });

    window.history.pushState({}, '', '/antigravity-guide');
    render(<App />);

    expect(replaceMock).toHaveBeenCalledWith('/guide/index.html');
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });
});
