/**
 * After `vite build`: write dist/privacy.html, dist/terms.html,
 * dist/delete-account.html and dist/join.html, the pages with their words in
 * the HTML. Why, in
 * src/routes/legal/static.tsx.
 *
 * Loaded through Vite so the page components resolve exactly as the app's
 * do (the `@/` paths, TSX). Netlify serves dist/privacy.html for /privacy
 * ahead of the SPA rewrite in netlify.toml, which only applies where no file
 * exists.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});
try {
  const { STATIC_PAGES, withPage } = await vite.ssrLoadModule('/src/routes/legal/static.tsx');
  const shell = await readFile('dist/index.html', 'utf8');
  for (const page of STATIC_PAGES) {
    const { file, title, Page, indexed } = page;
    const description = 'description' in page ? page.description : undefined;
    await writeFile(`dist/${file}`, withPage(shell, title, Page, indexed, description));
    console.log(`  dist/${file}`);
  }
} finally {
  await vite.close();
}
