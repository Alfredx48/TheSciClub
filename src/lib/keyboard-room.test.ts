import { afterEach, describe, expect, it, vi } from 'vitest';
import { startKeyboardRoom } from './keyboard-room';

/**
 * The owner, 2026-11-22: replying under a post in the Home Screen app, Safari
 * slid the whole page, the way back included, up under the clock.
 */

function fakeViewport() {
  const listeners = new Map<string, () => void>();
  const view = {
    height: 844,
    scale: 1,
    offsetTop: 0,
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, listener);
    },
    removeEventListener: () => undefined,
  };
  const fire = (changes: Partial<typeof view>) => {
    Object.assign(view, changes);
    listeners.get('resize')?.();
  };
  return { view: view as unknown as VisualViewport, fire };
}

describe('startKeyboardRoom', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('ends the page at the keyboard and puts back Safari’s slide, only while typing', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const root = document.documentElement;
    const box = document.createElement('textarea');
    document.body.append(box);
    const { view, fire } = fakeViewport();
    const stop = startKeyboardRoom(view);

    // Zoomed in, a box focused: less is visible, but there is no keyboard.
    box.focus();
    fire({ height: 422, scale: 2 });
    expect(root.dataset.keyboard).toBeUndefined();

    // Zoomed in with the keyboard up: it is the keyboard, at its real height.
    fire({ height: 250, scale: 2 });
    expect(root.style.getPropertyValue('--keyboard-height')).toBe('344px');

    // The keyboard up, and Safari sliding the page to show the box.
    fire({ height: 500, scale: 1, offsetTop: 300 });
    expect(root.dataset.keyboard).toBe('');
    expect(root.style.getPropertyValue('--keyboard-height')).toBe('344px');
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    // Down again.
    fire({ height: 844, offsetTop: 0 });
    expect(root.dataset.keyboard).toBeUndefined();
    expect(root.style.getPropertyValue('--keyboard-height')).toBe('');
    stop();
  });
});
