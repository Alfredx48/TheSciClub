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

  // The owner, 2026-11-23: in the Home Screen app the keyboard shortened the
  // page itself, so nothing looked hidden and the reply box stayed under it.
  it('counts the keyboard from the height before it, when it shortens the page too', () => {
    let inner = 844;
    vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => inner);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const root = document.documentElement;
    const box = document.createElement('textarea');
    document.body.append(box);
    const { view, fire } = fakeViewport();
    const stop = startKeyboardRoom(view);

    box.focus();
    inner = 500;
    fire({ height: 500 });
    expect(root.style.getPropertyValue('--keyboard-height')).toBe('344px');
    // The page is what shows above the keyboard, not 100dvh less the keyboard.
    expect(root.style.getPropertyValue('--keyboard-top')).toBe('500px');

    box.blur();
    inner = 844;
    fire({ height: 844 });
    expect(root.dataset.keyboard).toBeUndefined();
    stop();
  });

  // The owner, 2026-11-23: the page snapped back under the keyboard as they
  // dragged it to reach the box.
  it('puts back Safari’s slide only as the keyboard comes up, never the member’s drag', () => {
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(844);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    const box = document.createElement('textarea');
    document.body.append(box);
    const { view, fire } = fakeViewport();
    const stop = startKeyboardRoom(view);

    box.focus();
    fire({ height: 500, offsetTop: 200 });
    expect(scrollTo).toHaveBeenCalledTimes(1);

    clock += 2000;
    Object.assign(view, { offsetTop: 120 });
    window.dispatchEvent(new Event('scroll'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    stop();
  });
});
