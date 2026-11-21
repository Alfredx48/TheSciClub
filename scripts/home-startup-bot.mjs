import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { devices, webkit } from 'playwright';

const address = 'https://tests.thesciclub.com';
const dist = resolve('dist');
const api = 'https://supabase.test.invalid';
const shell = await readFile(resolve(dist, 'index.html'), 'utf8');
assert(
  shell.includes(`href="${api}"`),
  `Build with VITE_SUPABASE_URL=${api} before running the bot.`,
);
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const timestamp = '2026-11-18T18:22:00Z';
const member = { id: userId, status: 'active', is_admin: false, display_name: 'Test member' };
const room = {
  id: 'bowel',
  name: 'Test room',
  opened_at: timestamp,
  show_in_home: true,
  category: 'Life',
  sort_order: 1,
};
const topicId = 'fixture-post';
const title = 'Bot test fixture post';
const feed = [
  {
    id: topicId,
    title,
    room_id: room.id,
    author_id: userId,
    created_at: timestamp,
    last_post_at: timestamp,
    reply_count: 0,
    is_question: false,
    ord: 0,
    previews: [],
    author: { id: userId, display_name: 'Test Author' },
    replies: [],
    opening: [
      {
        id: 'opening-post',
        topic_id: topicId,
        author_id: userId,
        body: 'Fixture post body',
        created_at: timestamp,
        attachments: [],
        removed_at: null,
        removed_by_admin: false,
        edited_at: null,
        reply_to: null,
        link_preview: null,
      },
    ],
  },
];
const auth = {
  access_token: 'fixture-token',
  refresh_token: 'fixture-refresh',
  token_type: 'bearer',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: userId,
    aud: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: timestamp,
  },
};
const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const media = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};
const fixtures = { members: member, chat_rooms: [room], 'rpc/home_feed': feed };
const rtt = 170;
const membershipWork = 30;
const timing = {
  usual: { roomWork: 20, reps: 5 },
  slow: { roomWork: 600, reps: 5 },
};
const relevant = ['rpc/home_startup', 'members', 'rpc/home_feed', 'chat_rooms'];
const browser = await webkit.launch({ executablePath: process.env.WEBKIT_PATH });

async function run(flow, scenario) {
  const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  try {
    await context.addInitScript(
      ({ auth, topicPath, title }) => {
        Object.defineProperty(navigator, 'standalone', { value: true });
        localStorage.setItem('sb-supabase-auth-token', JSON.stringify(auth));
        const times = { tabs: null, text: null };
        window.botTimes = times;
        function painted() {
          const nav = document.querySelector('nav[aria-label="Main"] a[href="/peers"]');
          if (times.tabs === null && nav) {
            const bounds = nav.getBoundingClientRect();
            const center = document.elementFromPoint(
              bounds.x + bounds.width / 2,
              bounds.y + bounds.height / 2,
            );
            if (bounds.width && bounds.height && center && nav.contains(center))
              times.tabs = performance.now();
          }
          const post = document.querySelector(`a[href="${topicPath}"]`);
          if (
            times.text === null &&
            post?.textContent?.trim() === title &&
            post.getClientRects().length
          ) {
            times.text = performance.now();
          }
          if (times.tabs === null || times.text === null) requestAnimationFrame(painted);
        }
        requestAnimationFrame(painted);
      },
      { auth, topicPath: `/chat/rooms/${room.id}/topics/${topicId}`, title },
    );
    const calls = [];
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === address) {
        if (url.pathname === '/')
          return route.fulfill({ body: shell, contentType: media['.html'] });
        const path = url.pathname.slice(1);
        const file = resolve(dist, path);
        if (!file.startsWith(`${dist}/`)) throw new Error('Unexpected asset path');
        try {
          return await route.fulfill({
            body: await readFile(file),
            contentType: media[extname(file)] ?? 'application/octet-stream',
          });
        } catch {
          return route.fulfill({ status: 404 });
        }
      }
      if (url.origin !== api) return route.abort();
      const endpoint = url.pathname.replace(/^\/rest\/v1\//, '');
      if (relevant.includes(endpoint)) calls.push(endpoint);
      const { roomWork } = timing[scenario];
      let delay;
      let payload = fixtures[endpoint] ?? [];
      if (endpoint === 'members') {
        delay = rtt + membershipWork;
      } else if (endpoint === 'rpc/home_feed') {
        delay = rtt + 95;
        if (flow === 'early cards') payload = feed.map((row) => ({ ...row, room }));
      } else if (endpoint === 'chat_rooms') {
        delay = rtt + roomWork;
      } else {
        delay = rtt;
      }
      await new Promise((done) => setTimeout(done, delay));
      return route.fulfill({ json: payload, headers });
    });

    const page = await context.newPage();
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    const value = await page.waitForFunction(
      () => window.botTimes?.tabs !== null && window.botTimes?.text !== null && window.botTimes,
      null,
      { timeout: 7000 },
    );
    const times = await value.jsonValue();
    assert(times.tabs > 0 && times.text > 0);
    assert.deepEqual(calls.sort(), ['chat_rooms', 'members', 'rpc/home_feed']);
    return { tabs: Math.round(times.tabs), text: Math.round(times.text) };
  } finally {
    await context.close();
  }
}

try {
  const results = {};
  for (const [scenario, { reps }] of Object.entries(timing)) {
    const samples = { legacy: [], 'early cards': [] };
    for (let i = 0; i < reps; i++) {
      for (const flow of i % 2 ? ['early cards', 'legacy'] : ['legacy', 'early cards']) {
        samples[flow].push(await run(flow, scenario));
      }
    }
    results[scenario] = samples;
    console.log(JSON.stringify({ scenario, samples }));
  }
  const median = (samples, metric) =>
    samples.map((sample) => sample[metric]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  const rows = Object.entries(results).flatMap(([scenario, flows]) =>
    Object.entries(flows)
      .filter(([, samples]) => samples.length > 0)
      .map(
        ([flow, samples]) =>
          `| ${scenario} | ${flow} | ${samples.length} | ${median(samples, 'tabs')} ms | ${median(samples, 'text')} ms |`,
      ),
  );
  const summary = [
    '## Cold Home startup in WebKit',
    '',
    `iPhone viewport and simulated responses. Each request has a ${rtt} ms round trip. Room list work takes ${timing.usual.roomWork} ms in the usual case and ${timing.slow.roomWork} ms in the slow case.`,
    'Timings are reported without pass/fail thresholds.',
    '',
    '| Scenario | Rendering | Launches | Median tabs ready | Median fresh posts |',
    '| --- | --- | ---: | ---: | ---: |',
    ...rows,
    '',
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
} finally {
  await browser.close();
}
