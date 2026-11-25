import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * The admin site (admin/, the owner, 2026-11-22): its own build into dist-admin/, deployed by
 * its own Worker (cloudflare/admin/). It shares the Stats screens' code with the app, but reads
 * through a plain Supabase client (admin/supabase.ts) and has no service worker: it is fetched
 * fresh each time, so nothing stale can keep it from opening.
 */
const root = import.meta.dirname;

/** The app's fonts and icons, which the shared stylesheet and the manifest name. */
function sharedFiles(): Plugin {
  let outDir = '';
  return {
    name: 'admin-shared-files',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      cpSync(path.join(root, 'public/fonts'), path.join(outDir, 'fonts'), { recursive: true });
      for (const icon of [
        'favicon.ico',
        'favicon-192x192.png',
        'favicon-512x512.png',
        'maskable-192x192.png',
        'maskable-512x512.png',
        'apple-touch-icon.png',
      ]) {
        copyFileSync(path.join(root, 'public', icon), path.join(outDir, icon));
      }
    },
  };
}

/**
 * The change log's data, /changes.json, and its entries' screenshots (admin/changes.mjs, the
 * owner, 2026-11-25), from the repository's history. A build without that history (a shallow
 * copy) still builds: the page then says it could not read the log.
 */
function changeLog(): Plugin {
  let outDir = '';
  return {
    name: 'admin-change-log',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      try {
        execFileSync(
          process.execPath,
          [
            path.join(root, 'admin/changes.mjs'),
            'log',
            path.join(outDir, 'changes.json'),
            path.join(outDir, 'change-shots'),
          ],
          { stdio: 'inherit' },
        );
      } catch (thrown) {
        this.warn(`The change log was not written: ${String(thrown)}`);
      }
    },
  };
}

/** Its headers: the page may talk to its own Supabase project and nothing else. */
function headersFile(supabaseUrl: string): Plugin {
  return {
    name: 'admin-headers',
    apply: 'build',
    generateBundle() {
      const host = new URL(supabaseUrl).host;
      const policy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: https://${host}`,
        "font-src 'self'",
        `connect-src 'self' https://${host} wss://${host}`,
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ');
      this.emitFile({
        type: 'asset',
        fileName: '_headers',
        source: [
          '/*',
          `  Content-Security-Policy: ${policy}`,
          '  X-Frame-Options: DENY',
          '  X-Content-Type-Options: nosniff',
          '  Referrer-Policy: no-referrer',
          '  X-Robots-Tag: noindex, nofollow',
          '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
          '/index.html',
          '  Cache-Control: no-cache',
          '/',
          '  Cache-Control: no-cache',
          '/manifest.webmanifest',
          '  Cache-Control: no-cache',
          '/assets/*',
          '  Cache-Control: public, max-age=31536000, immutable',
          '',
        ].join('\n'),
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, root, 'VITE_'), ...process.env };
  const supabaseUrl = env.VITE_SUPABASE_URL ?? '';
  return {
    root: path.join(root, 'admin'),
    envDir: root,
    publicDir: path.join(root, 'admin/public'),
    plugins: [
      react(),
      tailwindcss(),
      sharedFiles(),
      changeLog(),
      ...(supabaseUrl ? [headersFile(supabaseUrl)] : []),
    ],
    resolve: {
      alias: [
        // The shared screens read through the admin site's own client.
        { find: '@/lib/supabase', replacement: path.join(root, 'admin/supabase.ts') },
        { find: '@', replacement: path.join(root, 'src') },
      ],
    },
    build: {
      outDir: path.join(root, 'dist-admin'),
      emptyOutDir: true,
    },
  };
});
