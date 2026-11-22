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
 * what is hidden of a layout that has not changed, while a text box has focus. Zoomed in, the
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
  /** The page's own height, which the keyboard does not change. */
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

  function update() {
    if (!view) return;
    const height = keyboardHeight({
      layout: Math.max(window.innerHeight, root.clientHeight),
      visible: view.height,
      scale: view.scale,
      typing: takesTyping(document.activeElement),
    });
    if (height > 0) {
      root.style.setProperty('--keyboard-height', `${String(height)}px`);
      root.dataset.keyboard = '';
      open = true;
    } else if (open) {
      root.style.removeProperty('--keyboard-height');
      delete root.dataset.keyboard;
      open = false;
    }
    // The page ends at the keyboard now: Safari's slide only hides the top.
    if (open && (window.scrollY !== 0 || view.offsetTop !== 0)) window.scrollTo(0, 0);
  }

  // A moment's wait on leaving a box, as the keyboard stays up from one box to the next.
  let timer: ReturnType<typeof setTimeout> | undefined;
  function later() {
    clearTimeout(timer);
    timer = setTimeout(update, 100);
  }

  view.addEventListener('resize', update);
  view.addEventListener('scroll', update);
  window.addEventListener('scroll', update, { passive: true });
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', later);
  update();

  return () => {
    clearTimeout(timer);
    view.removeEventListener('resize', update);
    view.removeEventListener('scroll', update);
    window.removeEventListener('scroll', update);
    document.removeEventListener('focusin', update);
    document.removeEventListener('focusout', later);
    if (open) {
      root.style.removeProperty('--keyboard-height');
      delete root.dataset.keyboard;
    }
  };
}
