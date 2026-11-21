/**
 * Writes dist/_headers and dist/_redirects for Cloudflare from netlify.toml,
 * which stays the one place the headers are written (src/csp.test.ts and the
 * native build read it too). Run after `pnpm build`, before `wrangler deploy`.
 *
 *   node scripts/cloudflare-site.mjs
 *   TEST_SUPABASE_REF=<ref> node scripts/cloudflare-site.mjs   # the test site
 *
 * With TEST_SUPABASE_REF, the live project's ref in every header becomes the
 * test project's, as netlify/plugins/test-backend did on Netlify.
 *
 * The catch-all "/* /index.html 200" is not copied: wrangler.toml's
 * not_found_handling = "single-page-application" does that job.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { cloudflareHeaders, cloudflareRedirects } from './cloudflare-site-rules.mjs';

const toml = readFileSync('netlify.toml', 'utf8');
const headers = cloudflareHeaders(toml, process.env.TEST_SUPABASE_REF);
// The test site stays out of search, every page of it: live lists /join and
// the legal pages (netlify.toml, 2026-11-20), the test site lists nothing.
const testSite = Boolean(process.env.TEST_SUPABASE_REF);
writeFileSync(
  'dist/_headers',
  testSite ? `${headers}\n/*\n  X-Robots-Tag: noindex, nofollow\n` : headers,
);
if (testSite) writeFileSync('dist/robots.txt', 'User-agent: *\nDisallow: /\n');
writeFileSync('dist/_redirects', cloudflareRedirects(toml));
console.log(
  process.env.TEST_SUPABASE_REF
    ? `Wrote dist/_headers and dist/_redirects for the test project ${process.env.TEST_SUPABASE_REF}.`
    : 'Wrote dist/_headers and dist/_redirects.',
);
