import { afterEach, describe, expect, it, vi } from 'vitest';

const warmMap = vi.fn(() => Promise.resolve());
vi.mock('./map-canvas', () => ({ default: () => null, warmMap }));

async function fresh(connection?: { saveData?: boolean; effectiveType?: string }) {
  vi.resetModules();
  warmMap.mockClear();
  Object.defineProperty(navigator, 'connection', { value: connection, configurable: true });
  return import('./index');
}

afterEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
});

describe('prefetchMap', () => {
  it('warms the map once a page', async () => {
    const { prefetchMap, noteMapUsed } = await fresh({ effectiveType: '4g' });
    noteMapUsed();
    prefetchMap();
    prefetchMap();
    await vi.waitFor(() => {
      expect(warmMap).toHaveBeenCalledTimes(1);
    });
  });

  // About 1 MB of script on every opening of Peers and Events, for nothing,
  // when the member never opens the map (2026-11-23).
  it('waits for the map to be opened on a device that has never shown it', async () => {
    const { prefetchMap } = await fresh({ effectiveType: '4g' });
    prefetchMap();
    await Promise.resolve();
    expect(warmMap).not.toHaveBeenCalled();
  });

  it('works where the browser says nothing of its connection', async () => {
    const { mayPrefetchMap } = await fresh(undefined);
    expect(mayPrefetchMap()).toBe(true);
  });

  it('waits for the map to be opened on Data Saver or 2G', async () => {
    for (const connection of [
      { saveData: true, effectiveType: '4g' },
      { effectiveType: '2g' },
      { effectiveType: 'slow-2g' },
    ]) {
      const { prefetchMap, noteMapUsed } = await fresh(connection);
      noteMapUsed();
      prefetchMap();
      await Promise.resolve();
      expect(warmMap, JSON.stringify(connection)).not.toHaveBeenCalled();
    }
  });

  it('stays silent when warming fails', async () => {
    const { prefetchMap, noteMapUsed } = await fresh({ effectiveType: '4g' });
    noteMapUsed();
    warmMap.mockRejectedValueOnce(new Error('offline'));
    expect(() => {
      prefetchMap();
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(warmMap).toHaveBeenCalledTimes(1);
    });
  });
});
