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
writeFileSync('dist/_headers', headers);
writeFileSync('dist/_redirects', cloudflareRedirects(toml));
console.log(
  process.env.TEST_SUPABASE_REF
    ? `Wrote dist/_headers and dist/_redirects for the test project ${process.env.TEST_SUPABASE_REF}.`
    : 'Wrote dist/_headers and dist/_redirects.',
);
