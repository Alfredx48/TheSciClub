import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The store app: the web build bundled inside it (`pnpm build:native`), never
 * loaded from thesciclub.com. HANDOFF.md says how to build and sync.
 */
const config: CapacitorConfig = {
  appId: 'com.thesciclub.app',
  appName: 'The SCI Club',
  webDir: 'dist-native',
  // Names the app to the sites it calls. Nominatim's policy asks for it, and a
  // WebView's page sends no useful Referer.
  appendUserAgent: 'TheSciClub/1.0 (+https://thesciclub.com)',
  backgroundColor: '#102A4C',
  ios: {
    // The page reads the safe areas itself (env(safe-area-inset-*)).
    contentInset: 'never',
  },
  plugins: {
    SystemBars: {
      initialViewportFitValueHint: 'cover',
    },
    SplashScreen: {
      // Hidden by the app once its first screen is drawn (src/lib/native-shell.ts).
      launchAutoHide: false,
      backgroundColor: '#102A4C',
      showSpinner: false,
    },
    Keyboard: {
      // The web view keeps its size and the page makes room itself, from the
      // keyboard's own height (src/lib/native-shell.ts, index.css). Shrinking
      // the web view left a chat's box half under the keyboard on iOS 26
      // (the owner, 2026-11-07).
      resize: 'none',
      resizeOnFullScreen: true,
    },
    // Native Sign in with Apple and Google (src/lib/native-sign-in.ts). The
    // plugin's sync hook leaves out the SDKs of the providers set false, so
    // Facebook's, which tracks, never ships (scripts/check-native-build.mjs).
    SocialLogin: {
      providers: { apple: true, google: true, facebook: false, twitter: false },
      logLevel: 1,
    },
    // A notification that arrives while the app is open still shows, as the
    // website's do (src/sw.ts). Its badge is left out: while open, the app
    // sets the icon's number itself (src/lib/chat/unread.ts), and a push's
    // count can be older than a conversation just read.
    PushNotifications: {
      presentationOptions: ['banner', 'list', 'sound'],
    },
    // The icon's number is only ever the club's count, never one the plugin
    // remembered from an earlier launch.
    Badge: {
      persist: false,
      autoClear: false,
    },
  },
};

export default config;
