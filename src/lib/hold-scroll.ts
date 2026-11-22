import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';

/**
 * Keeps a list where it was put while what is in it grows, until the reader
 * moves it themselves.
 *
 * A conversation used to jump to its newest message once, when the messages
 * arrived, and then its photographs loaded. Each one is drawn at its own size
 * only once its signed address has been asked for and the file has come, so
 * every picture above the bottom pushed the newest message further down, and
 * the member was left looking at a photograph (the owner, 2026-10-06). A topic
 * opened at a post had the same fault.
 *
 * So `hold(place)` says where the list should be, and runs `place` again
 * every time the content changes size. It lets go the moment the reader does
 * anything to the list themselves — a wheel, a touch, a press, a key — because
 * from then on the list is where they put it, and moving it under them is the
 * worse fault. Scroll events cannot tell the reader's scroll from ours, which
 * is why it listens for the reader's hands instead.
 *
 * With no ResizeObserver (jsdom, an old browser) the first placing is all
 * there is, which is what the app did before.
 *
 * `ready` is whether the two elements are drawn yet: both screens draw a
 * loading line first, and a ref does not say when it is filled.
 */
export function useHoldScroll(
  scroller: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  ready: boolean,
) {
  const place = useRef<(() => void) | null>(null);

  /** `now: false` holds without placing, for a smooth scroll already under way. */
  const hold = useCallback((next: () => void, { now = true }: { now?: boolean } = {}) => {
    place.current = next;
    if (now) next();
  }, []);

  const release = useCallback(() => {
    place.current = null;
  }, []);

  const holding = useCallback(() => place.current !== null, []);

  useEffect(() => {
    const box = scroller.current;
    const inner = content.current;
    if (!ready || !box || !inner) return;

    const letGo = () => {
      place.current = null;
    };
    const intents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const intent of intents) box.addEventListener(intent, letGo, { passive: true });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        place.current?.();
      });
      observer.observe(inner);
      // The list itself getting shorter too: the keyboard coming up would
      // otherwise cover the newest message a member is holding at the bottom.
      observer.observe(box);
    }

    return () => {
      for (const intent of intents) box.removeEventListener(intent, letGo);
      observer?.disconnect();
    };
  }, [scroller, content, ready]);

  return useMemo(() => ({ hold, release, holding }), [hold, release, holding]);
}
