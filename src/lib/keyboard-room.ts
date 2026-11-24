/**
 * Room for the keyboard in the Home Screen app on an iPhone.
 *
 * Safari does not make the page shorter when the keyboard comes up: it lays the keyboard over
 * the page and slides the whole page up to show the box being typed in. Everything at the top,
 * the way back included, went up under the clock and stayed there while the member typed (the
 * owner, 2026-11-22, replying under a post).
 *
 * So, as the store app does from the keyboard's own height (native-shell.ts), the page ends at
 * the top of the keyboard instead: `--keyboard-height` and `data-keyboard` on the root, which
 * index.css takes off every full-height screen. Safari's slide is then put back, as there is
 * nothing left under the keyboard to slide to.
 *
 * Safari tells a page only how much of it is visible (`visualViewport`), so the keyboard is
 * what is missing from the page's height before it came up, while a text box has focus: Safari
 * may lay the keyboard over the page, or, in the Home Screen app, shorten the page for it. Zoomed in, the
 * visible part is that much smaller and no more hidden, so it is counted at its zoom. Android's browsers make the page shorter themselves (index.html asks them to),
 * which leaves nothing hidden and nothing to do.
 */

import { takesTyping } from '@/lib/takes-typing';

/** Less than this hidden is a toolbar or a rounding, not a keyboard. */
const MIN_KEYBOARD = 120;

export function keyboardHeight({
  layout,
  visible,
  scale,
  typing,
}: {
  /** The page's height before the keyboard came up. */
  layout: number;
  /** How much of it Safari shows. */
  visible: number;
  /** Zoomed in, less of the page is visible; that is not a keyboard. */
  scale: number;
  typing: boolean;
}): number {
  if (!typing) return 0;
  const hidden = Math.round(layout - visible * scale);
  return hidden >= MIN_KEYBOARD ? hidden : 0;
}

/** Started by the Home Screen app (installed-app.tsx); returns how to stop. */
export function startKeyboardRoom(view: VisualViewport | null = window.visualViewport): () => void {
  if (!view) return () => undefined;
  const root = document.documentElement;
  let open = false;
  // The page's height with no keyboard, for this width. The Home Screen app can
  // shorten the page itself for the keyboard and hide nothing from it, so the
  // keyboard is what is missing from the height it had before (the owner,
  // 2026-11-23: replying under the last post, the box stayed under the keyboard).
  let full = 0;
  let fullWidth = -1;

  // Safari slides the page to the box just after it takes focus and the keyboard comes up,
  // and that slide is put back. Later, a member dragging the page is never fought: that
  // was the page snapping back under the keyboard (the owner, 2026-11-23).
  let settleUntil = 0;
  const SETTLE_MS = 800;

  function update(settle = false) {
    if (!view) return;
    if (settle) settleUntil = performance.now() + SETTLE_MS;
    const typing = takesTyping(document.activeElement);
    const now = Math.max(window.innerHeight, root.clientHeight);
    if (window.innerWidth !== fullWidth || !typing) {
      // Turned, or no keyboard: what the page has now is all of it.
      fullWidth = window.innerWidth;
      full = now;
    } else {
      full = Math.max(full, now);
    }
    const height = keyboardHeight({
      layout: full,
      visible: view.height,
      scale: view.scale,
      typing,
    });
    if (height > 0) {
      root.style.setProperty('--keyboard-height', `${String(height)}px`);
      // The page is exactly what Safari shows above the keyboard. Taking the keyboard off
      // 100dvh instead left the page ending under it, as 100dvh and the visible height
      // do not agree in the Home Screen app.
      root.style.setProperty('--keyboard-top', `${String(Math.round(view.height * view.scale))}px`);
      root.dataset.keyboard = '';
      open = true;
    } else if (open) {
      clear();
    }
    // The page ends at the keyboard now: Safari's slide only hides the top.
    if (open && performance.now() < settleUntil && (window.scrollY !== 0 || view.offsetTop !== 0)) {
      window.scrollTo(0, 0);
    }
  }

  function clear() {
    root.style.removeProperty('--keyboard-height');
    root.style.removeProperty('--keyboard-top');
    delete root.dataset.keyboard;
    open = false;
  }

  const settled = () => {
    update(true);
  };
  const moved = () => {
    update();
  };

  // A moment's wait on leaving a box, as the keyboard stays up from one box to the next.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function later() {
    clearTimeout(timer);
    timer = setTimeout(moved, 100);
  }

  view.addEventListener('resize', settled);
  view.addEventListener('scroll', moved);
  window.addEventListener('scroll', moved, { passive: true });
  window.addEventListener('resize', settled);
  document.addEventListener('focusin', settled);
  document.addEventListener('focusout', later);
  update();

  return () => {
    clearTimeout(timer);
    view.removeEventListener('resize', settled);
    view.removeEventListener('scroll', moved);
    window.removeEventListener('scroll', moved);
    window.removeEventListener('resize', settled);
    document.removeEventListener('focusin', settled);
    document.removeEventListener('focusout', later);
    if (open) clear();
  };
}
