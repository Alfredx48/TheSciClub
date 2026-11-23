/**
 * Release speed: times the main screens of several releases side by side, so
 * a release that made the app slower is found before members feel it (the
 * owner, 2026-11-21). Run each night by .github/workflows/release-speed.yml.
 *
 *   ROBOT_EMAIL=… ROBOT_PASSWORD=… VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… \
 *     node scripts/release-speed.mjs [git ref …]
 *
 * With no refs: the last release tagged before yesterday's run (the baseline),
 * every release tagged since, and origin/tests (what is coming next). Live
 * releases are tagged release-<build minute> by .github/workflows/site.yml.
 *
 * Each ref is built in its own checkout against the TEST project, never live,
 * and served from this machine. A robot member signs in once (by password, as
 * the sign-in screen does) and the same session is given to every build. Then,
 * as a slow phone (4x slower processor, a 4G-like network), it opens each
 * screen fresh and moves between them by the tab bar, ROUNDS times, taking
 * the builds in turn each round so a hiccup on the machine is shared. Each
 * time runs until the screen's requests have settled.
 *
 * Old builds all run against today's database, so this finds slower app code,
 * not a slower database function: page speed by release (Admin) finds those.
 *
 * Each screen is measured four ways. Time until it settled is shown but not
 * flagged: the same build timed twice differed by 3x (the test project's
 * network). Processor time, requests to the database and script downloaded
 * change only when the code does, so those are compared with the baseline.
 *
 * Writes release-speed/report.md and report.json; exits 1 if a build is
 * clearly worse than the baseline on any screen, so the night's run shows red
 * and GitHub says so by email.
 */

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const ROUNDS = Number(process.env.ROUNDS ?? 5);
/** Settled: no request open for this long. */
const QUIET_MS = 600;
const SCREEN_TIMEOUT_MS = 30_000;

const SCREENS = [
  { name: 'Home', path: '/home', tab: 'Home' },
  { name: 'Peers', path: '/peers', tab: 'Peers' },
  { name: 'Chat', path: '/chat', tab: 'Chat' },
  { name: 'Events', path: '/events', tab: 'Events' },
  { name: 'Me', path: '/me', tab: 'Me' },
];

/**
 * A topic on the test project, opened to read, then its reply box tapped (the
 * owner, 2026-11-23: the editor now loads on that tap, so the tap is timed as
 * well as the opening, and a faster opening cannot hide a slower reply).
 */
const TOPIC_PATH =
  process.env.RELEASE_SPEED_TOPIC ??
  '/chat/rooms/general/topics/8f00c016-783d-4e43-a0c0-25c0aa3a2132';

const ROOT = resolve(process.cwd());
const WORK = resolve(process.env.RELEASE_SPEED_DIR ?? join(ROOT, 'release-speed'));
const SUPABASE_URL = need('VITE_SUPABASE_URL');
const ANON_KEY = need('VITE_SUPABASE_ANON_KEY');
const LIVE_REF = 'erijdvqnxavwezsbbojv';

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name}.`);
    process.exit(2);
  }
  return value;
}

if (SUPABASE_URL.includes(LIVE_REF)) {
  console.error('Refusing to run against the live project: the robot belongs on the test project.');
  process.exit(2);
}
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** The baseline, today's releases, and what is on tests, oldest first. */
function defaultRefs() {
  const tags = git('tag', '--list', 'release-*', '--sort=creatordate')
    .split('\n')
    .filter(Boolean)
    .map((tag) => ({ tag, at: Number(git('log', '-1', '--format=%ct', tag)) }));
  const since = Date.now() / 1000 - 24 * 60 * 60;
  const recent = tags.filter((t) => t.at >= since).map((t) => t.tag);
  const baseline = tags.filter((t) => t.at < since).at(-1)?.tag;
  const refs = [...(baseline ? [baseline] : []), ...recent];
  try {
    git('rev-parse', '--verify', 'origin/tests');
    refs.push('origin/tests');
  } catch {
    // No tests branch here: releases only.
  }
  // Nothing new since the baseline: compare it with tests alone.
  return [...new Set(refs)];
}

const refs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultRefs();
if (refs.length < 2) {
  console.error(`Need at least two builds to compare; found ${refs.join(', ') || 'none'}.`);
  process.exit(2);
}

// ------------------------------------------------------------------ build --

function build(ref, index) {
  const dir = join(WORK, `build-${index}`);
  const out = join(WORK, `dist-${index}`);
  // REUSE_BUILDS=1 times builds already made for these refs, in this order (a rerun).
  if (process.env.REUSE_BUILDS === '1' && existsSync(join(out, 'index.html'))) return out;
  rmSync(out, { recursive: true, force: true });
  try {
    git('worktree', 'remove', '--force', dir);
  } catch {
    // Not there.
  }
  git('worktree', 'add', '--detach', dir, ref);
  const run = (cmd, args) =>
    execFileSync(cmd, args, {
      cwd: dir,
      stdio: 'inherit',
      env: { ...process.env, VITE_SUPABASE_URL: SUPABASE_URL, VITE_SUPABASE_ANON_KEY: ANON_KEY },
    });
  console.log(`\n== building ${ref}`);
  run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline']);
  run('pnpm', ['exec', 'vite', 'build', '--outDir', out, '--emptyOutDir']);
  git('worktree', 'remove', '--force', dir);
  return out;
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

/** The build as Cloudflare serves it: its files, else the app's index.html. */
function serve(dist, port) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    let file = join(dist, path);
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(dist, 'index.html');
    }
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': path.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => server.listen(port, '127.0.0.1', () => done(server)));
}

// ------------------------------------------------------------------ robot --

async function session() {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: need('ROBOT_EMAIL'), password: need('ROBOT_PASSWORD') }),
  });
  const body = await response.json();
  if (!body.access_token) throw new Error(`The robot could not sign in (${response.status}).`);
  return body;
}

/** A slow phone: the processor 4x slower, a 4G-like network. */
async function slowPhone(browser, signedIn) {
  const context = await browser.newContext({
    // Chromium stands in for Safari; what is compared is release with release.
    ...devices['iPhone 13'],
    serviceWorkers: 'block',
  });
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage refused: the screens then time signed out.
      }
    },
    [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(signedIn)],
  );
  // The robot's own timings never reach the club's page speed (the owner,
  // 2026-11-21: they showed as 37 visits and 24 failures there).
  await context.route('**/rest/v1/rpc/log_page_speed', (route) => route.fulfill({ status: 204 }));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 60,
    downloadThroughput: (9 * 1024 * 1024) / 8,
    uploadThroughput: (4 * 1024 * 1024) / 8,
  });
  // What each response was and how much came down, for the counts below.
  const kinds = new Map();
  const tally = { database: 0, scriptBytes: 0, bytes: 0, urls: [] };
  cdp.on('Network.requestWillBeSent', (e) => {
    const url = e.request.url;
    if (url.startsWith(SUPABASE_URL) && e.type !== 'WebSocket' && !url.includes('log_page_speed')) {
      tally.database += 1;
      // What was asked, for requests.md: the path and the query's shape.
      tally.urls.push(`${e.request.method} ${url.slice(SUPABASE_URL.length)}`);
    }
  });
  cdp.on('Network.responseReceived', (e) => kinds.set(e.requestId, e.type));
  cdp.on('Network.loadingFinished', (e) => {
    tally.bytes += e.encodedDataLength;
    if (kinds.get(e.requestId) === 'Script') tally.scriptBytes += e.encodedDataLength;
  });
  const busy = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return (metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000;
  };
  return { context, page, tally, busy };
}

/** Until no request has been open for QUIET_MS; the time is to the last one's end. */
function settled(page, started) {
  return new Promise((done) => {
    const open = new Set();
    let last = Date.now();
    const onRequest = (r) => {
      if (r.resourceType() !== 'websocket') open.add(r);
    };
    const onEnd = (r) => {
      open.delete(r);
      last = Date.now();
    };
    page.on('request', onRequest);
    page.on('requestfinished', onEnd);
    page.on('requestfailed', onEnd);
    const tick = setInterval(() => {
      const now = Date.now();
      if ((open.size === 0 && now - last >= QUIET_MS) || now - started > SCREEN_TIMEOUT_MS) {
        clearInterval(tick);
        page.off('request', onRequest);
        page.off('requestfinished', onEnd);
        page.off('requestfailed', onEnd);
        done(Math.max(0, Math.min(last, now) - started));
      }
    }, 50);
  });
}

/**
 * One screen, measured four ways: how long until it settled (the network's
 * mood is in this), how long the processor worked, how many requests went to
 * the database, and how many KB of script came down. The last three change
 * only when the code does.
 */
async function measure(phone, go) {
  const before = { ...phone.tally, urls: [...phone.tally.urls], busy: await phone.busy() };
  const started = Date.now();
  const done = settled(phone.page, started);
  await go();
  const ms = await done;
  return {
    time: ms,
    cpu: Math.round((await phone.busy()) - before.busy),
    requests: phone.tally.database - before.database,
    scriptKb: Math.round((phone.tally.scriptBytes - before.scriptBytes) / 1024),
    urls: phone.tally.urls.slice(before.urls.length),
  };
}

const opening = (phone, origin, screen) =>
  measure(phone, () => phone.page.goto(`${origin}${screen.path}`, { waitUntil: 'commit' }));

async function moving(phone, screen) {
  const tab = phone.page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: new RegExp(`^${screen.tab}`) });
  await tab.waitFor({ timeout: SCREEN_TIMEOUT_MS });
  return measure(phone, () => tab.click());
}

/**
 * The first tap on the reply box, until there is a box to write in. Time here
 * is the wait the member sees, so it is counted to the editor drawn rather
 * than to the network settling. Older builds draw the editor at once: the tap
 * just focuses it.
 */
async function firstReply(phone) {
  const page = phone.page;
  const name = /^Reply to this (post|question)$/;
  const box = page.getByRole('textbox', { name });
  const closed = page.getByRole('button', { name });
  await box.or(closed).first().waitFor({ timeout: SCREEN_TIMEOUT_MS });
  const before = { ...phone.tally, urls: [...phone.tally.urls], busy: await phone.busy() };
  const started = Date.now();
  await box.or(closed).first().click();
  await box.waitFor({ timeout: SCREEN_TIMEOUT_MS });
  const time = Date.now() - started;
  return {
    time,
    cpu: Math.round((await phone.busy()) - before.busy),
    requests: phone.tally.database - before.database,
    scriptKb: Math.round((phone.tally.scriptBytes - before.scriptBytes) / 1024),
    urls: phone.tally.urls.slice(before.urls.length),
  };
}

function record(build, key, sample) {
  if (!build.samples[key]) build.samples[key] = [];
  build.samples[key].push(sample);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

// ------------------------------------------------------------------- main --

mkdirSync(WORK, { recursive: true });
const builds = [];
for (const [i, ref] of refs.entries()) {
  builds.push({ ref, dist: build(ref, i), port: 4310 + i, samples: {} });
}
const servers = await Promise.all(builds.map((b) => serve(b.dist, b.port)));
const signedIn = await session();
const browser = await chromium.launch();

try {
  for (let round = 1; round <= ROUNDS; round++) {
    // Each round in a different order, so no build is always first or last.
    const order = builds.map((_, i) => (i + round) % builds.length);
    for (const i of order) {
      const b = builds[i];
      const origin = `http://127.0.0.1:${b.port}`;
      try {
        // Each screen opened in a fresh phone, so its processor time starts from nothing.
        for (const screen of SCREENS) {
          const phone = await slowPhone(browser, signedIn);
          try {
            record(b, `Opening ${screen.name}`, await opening(phone, origin, screen));
          } finally {
            await phone.context.close();
          }
        }
        // A topic, read, then answered: each in a fresh phone.
        {
          const phone = await slowPhone(browser, signedIn);
          try {
            record(b, 'Opening a topic', await opening(phone, origin, { path: TOPIC_PATH }));
            record(b, 'First tap on Reply', await firstReply(phone));
          } finally {
            await phone.context.close();
          }
        }
        // Then one phone, opened on Me and taken around the tabs.
        const phone = await slowPhone(browser, signedIn);
        try {
          await opening(phone, origin, SCREENS.at(-1));
          for (const screen of SCREENS) {
            record(b, `Moving to ${screen.name}`, await moving(phone, screen));
          }
        } finally {
          await phone.context.close();
        }
      } catch (problem) {
        console.error(`round ${round}, ${b.ref}: ${problem.message}`);
      }
    }
    console.log(`round ${round} of ${ROUNDS} done`);
  }
} finally {
  await browser.close();
  for (const s of servers) s.close();
}

// ----------------------------------------------------------------- report --

/**
 * What is flagged: only what the code decides. Time is shown, never flagged:
 * the same build timed twice differed by 3x on the test project's network.
 */
const MEASURES = [
  {
    key: 'cpu',
    title: 'Processor time (ms)',
    worse: (m, base) => m - base >= 250 && m >= base * 1.3,
    show: (m) => `${m}`,
  },
  {
    key: 'requests',
    title: 'Requests to the database',
    worse: (m, base) => m - base >= 2 && m >= base * 1.25,
    show: (m) => `${m}`,
  },
  {
    key: 'scriptKb',
    title: 'Script downloaded (KB)',
    worse: (m, base) => m - base >= 30 && m >= base * 1.1,
    show: (m) => `${m}`,
  },
  {
    key: 'time',
    title: 'Time until settled (s), not flagged',
    worse: () => false,
    show: (m) => (m / 1000).toFixed(2),
  },
];

const keys = [...new Set(builds.flatMap((b) => Object.keys(b.samples)))];
const baseline = builds[0];
const middle = (b, key, measure) => median((b.samples[key] ?? []).map((s) => s[measure]));
const flags = [];
const lines = [
  '# Release speed',
  '',
  `${new Date().toISOString().slice(0, 16)} UTC · ${ROUNDS} rounds · a slow phone (4x processor, 4G-like) · the test project`,
  '',
  `The middle of ${ROUNDS} runs. Baseline: **${baseline.ref}**. ⚠ is clearly worse than the baseline.`,
];
for (const measure of MEASURES) {
  lines.push(
    '',
    `## ${measure.title}`,
    '',
    `| Screen | ${builds.map((b) => b.ref).join(' | ')} |`,
    `| --- | ${builds.map(() => '---:').join(' | ')} |`,
  );
  for (const key of keys) {
    const base = middle(baseline, key, measure.key);
    const cells = builds.map((b, i) => {
      const m = middle(b, key, measure.key);
      if (m === null) return '—';
      const worse = i > 0 && base !== null && measure.worse(m, base);
      if (worse)
        flags.push(
          `${key}, ${measure.title}: ${b.ref} ${measure.show(m)}, baseline ${measure.show(base)}`,
        );
      return `${worse ? '⚠ ' : ''}${measure.show(m)}`;
    });
    lines.push(`| ${key} | ${cells.join(' | ')} |`);
  }
}
const json = {
  at: new Date().toISOString(),
  rounds: ROUNDS,
  builds: builds.map((b) => ({
    ref: b.ref,
    commit: git('rev-parse', '--short', b.ref),
    // The request lists are in requests.md.
    samples: Object.fromEntries(
      Object.entries(b.samples).map(([k, v]) => [k, v.map(({ urls, ...rest }) => rest)]),
    ),
  })),
};
lines.push(
  '',
  flags.length
    ? `**Worse than the baseline:**\n\n${flags.map((f) => `- ${f}`).join('\n')}`
    : 'Nothing worse than the baseline.',
);
const report = lines.join('\n');
writeFileSync(join(WORK, 'report.md'), `${report}\n`);
// Each screen's requests to the database, from its first timing, grouped, for
// finding repeats and reads that could be one (the owner, 2026-11-23).
{
  const lines = ['# Requests to the database, by screen', ''];
  for (const b of builds) {
    lines.push(`## ${b.ref}`, '');
    for (const [key, samples] of Object.entries(b.samples)) {
      const urls = samples[0]?.urls ?? [];
      const counts = new Map();
      for (const u of urls) {
        const shape = u.replace(/=(eq|in|gt|gte|lt|lte|neq|is|cs|ov)\.[^&]*/g, '=$1.…');
        counts.set(shape, (counts.get(shape) ?? 0) + 1);
      }
      lines.push(`### ${key}: ${urls.length}`, '');
      for (const [shape, n] of [...counts].sort((x, y) => y[1] - x[1]))
        lines.push(`- ${n > 1 ? `**${n}×** ` : ''}\`${decodeURIComponent(shape).slice(0, 300)}\``);
      lines.push('');
    }
  }
  writeFileSync(join(WORK, 'requests.md'), `${lines.join('\n')}\n`);
}
writeFileSync(join(WORK, 'report.json'), `${JSON.stringify(json, null, 2)}\n`);
if (process.env.GITHUB_STEP_SUMMARY)
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, { flag: 'a' });
console.log(`\n${report}`);
process.exit(flags.length ? 1 : 0);
