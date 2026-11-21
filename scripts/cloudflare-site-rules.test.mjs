// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cloudflareHeaders, cloudflareRedirects } from './cloudflare-site-rules.mjs';

const toml = readFileSync('netlify.toml', 'utf8');

// Cloudflare serves what these files say: a header lost here is lost on the site.
describe('the Cloudflare headers', () => {
  it("carry the site's security headers, naming the test project only on the test site", () => {
    const live = cloudflareHeaders(toml);
    const site = live.split(/^(?=\/)/m).find((rule) => rule.startsWith('/*\n')) ?? '';
    expect(site).toMatch(
      /^ {2}Content-Security-Policy: default-src 'self';.*frame-ancestors 'none'/m,
    );
    expect(site).toMatch(/^ {2}X-Frame-Options: DENY$/m);
    expect(live).toContain('erijdvqnxavwezsbbojv');

    const tests = cloudflareHeaders(toml, 'scwgwzyuzlrsvwzcavqb');
    expect(tests).not.toContain('erijdvqnxavwezsbbojv');
    expect(tests).toContain('wss://scwgwzyuzlrsvwzcavqb.supabase.co');
    expect(() => cloudflareHeaders(toml, 'erijdvqnxavwezsbbojv')).toThrow();

    // The single-page catch-all is wrangler.toml's job; a 200 rule here would loop.
    expect(cloudflareRedirects(toml)).not.toContain('index.html');
  });

  // An installed app only updates if these are asked for afresh every time:
  // Cloudflare's default kept them four hours (the owner, 2026-11-21).
  it('ask again every time for the service worker and the release it names', () => {
    const rules = cloudflareHeaders(toml).split(/^(?=\/)/m);
    for (const path of ['/sw.js', '/version.json']) {
      expect(rules.find((rule) => rule.startsWith(`${path}\n`))).toMatch(
        /^ {2}Cache-Control: no-cache$/m,
      );
    }
  });
});
