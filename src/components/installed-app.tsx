import { useEffect } from 'react';
import { startKeyboardRoom } from '@/lib/keyboard-room';
import { isNative, isStandalone } from '@/lib/standalone';

/**
 * The Home Screen app and the store app stay at their layout scale, with
 * room for the notch. A browser tab keeps its zoom; Me's text sizes still
 * work in every place.
 */
export function InstalledApp() {
  useEffect(() => {
    const query =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(display-mode: standalone)')
        : null;
    let remove: () => void = () => undefined;

    function update() {
      remove();
      if (!isStandalone() && !isNative()) return;
      document.documentElement.dataset.installedApp = '';
      function move(event: TouchEvent) {
        // CSS handles pinch zoom on Android. Safari also needs its gesture
        // event, and older phones need the multi-touch move cancelled.
        if (event.touches.length > 1) event.preventDefault();
      }
      function gesture(event: Event) {
        event.preventDefault();
      }
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('gesturestart', gesture, { passive: false });
      document.addEventListener('gesturechange', gesture, { passive: false });
      // The store app has the keyboard's own height (native-shell.ts).
      const stopKeyboardRoom = isNative() ? () => undefined : startKeyboardRoom();
      remove = () => {
        stopKeyboardRoom();
        delete document.documentElement.dataset.installedApp;
        document.removeEventListener('touchmove', move);
        document.removeEventListener('gesturestart', gesture);
        document.removeEventListener('gesturechange', gesture);
      };
    }

    update();
    query?.addEventListener('change', update);
    return () => {
      query?.removeEventListener('change', update);
      remove();
    };
  }, []);

  return null;
}
