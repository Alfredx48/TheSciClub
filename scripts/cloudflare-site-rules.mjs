// netlify.toml's [[headers]] and [[redirects]] as Cloudflare's _headers and
// _redirects files (scripts/cloudflare-site.mjs). Apart so a test can read it.

const LIVE_REF = 'erijdvqnxavwezsbbojv';

/** The paths the Worker gives headers of its own (netlify/edge-functions/youtube-embed.ts). */
const OWN_HEADERS = ['/embed/youtube.html', '/embed/youtube'];

/** Each [[name]] table of netlify.toml, as its lines. Only the shapes netlify.toml uses. */
function tables(toml, name) {
  return toml
    .split(/^\[\[/m)
    .slice(1)
    .filter((part) => part.startsWith(`${name}]]`))
    .map((part) =>
      part
        .split('\n')
        .slice(1)
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#')),
    );
}

function value(line) {
  const match = /^([A-Za-z0-9_-]+) = (?:"([^"]*)"|(\d+)|(true|false))$/.exec(line);
  if (!match) throw new Error(`netlify.toml: cannot read ${JSON.stringify(line)}`);
  return [match[1], match[2] ?? match[3] ?? match[4]];
}

/** The _headers file; with a test project's ref in place of the live one. */
export function cloudflareHeaders(toml, testRef) {
  if (testRef && (!/^[a-z]{20}$/.test(testRef) || testRef === LIVE_REF)) {
    throw new Error(`TEST_SUPABASE_REF is not a test project ref: ${testRef}`);
  }
  const out = [];
  for (const lines of tables(toml, 'headers')) {
    let path = null;
    const values = [];
    for (const line of lines) {
      if (line === '[headers.values]') continue;
      const [key, text] = value(line);
      if (key === 'for') path = text;
      else values.push(`  ${key}: ${testRef ? text.replaceAll(LIVE_REF, testRef) : text}`);
    }
    if (!path) throw new Error('netlify.toml: a [[headers]] without for');
    out.push(path, ...values);
  }
  for (const path of OWN_HEADERS) {
    out.push(path, '  ! Content-Security-Policy', '  ! X-Frame-Options');
  }
  return `${out.join('\n')}\n`;
}

/** The _redirects file: every redirect but the single-page catch-all. */
export function cloudflareRedirects(toml) {
  const out = [];
  for (const lines of tables(toml, 'redirects')) {
    const rule = Object.fromEntries(lines.map(value));
    if (rule.to === '/index.html' && rule.status === '200') continue;
    if (!['301', '302', '307', '308'].includes(rule.status ?? '301')) {
      throw new Error(`netlify.toml: Cloudflare cannot do the redirect from ${rule.from}`);
    }
    out.push(`${rule.from} ${rule.to} ${rule.status ?? '301'}`);
  }
  return `${out.join('\n')}\n`;
}
