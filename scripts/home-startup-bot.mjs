import assert from 'node:assert/strict';
import { appendFile, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { devices, webkit } from 'playwright';

// Only the test site's hostname opts into the combined request.
const addresses = {
  separate: 'https://separate.sciclub.test',
  combined: 'https://tests.thesciclub.com',
};
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
const roomsWork = 20;
const timing = {
  usual: { feedWork: 95, reps: 5 },
  slow: { feedWork: 500, reps: 5 },
  fallback: { feedWork: 95, reps: 3 },
};
const relevant = ['rpc/home_startup', 'members', 'rpc/home_feed', 'chat_rooms'];
const browser = await webkit.launch({ executablePath: process.env.WEBKIT_PATH });

async function run(flow, scenario) {
  const address = addresses[flow];
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
      const { feedWork } = timing[scenario];
      let delay;
      let payload = fixtures[endpoint] ?? [];
      if (endpoint === 'rpc/home_startup') {
        if (scenario === 'fallback') {
          await new Promise((done) => setTimeout(done, rtt));
          return route.fulfill({
            status: 404,
            json: { code: 'PGRST202', message: 'Missing RPC fixture' },
            headers,
          });
        }
        delay = rtt + membershipWork + roomsWork + feedWork;
        payload = { viewer: userId, member, feed, rooms: [room] };
      } else if (endpoint === 'members') {
        delay = rtt + membershipWork;
      } else if (endpoint === 'rpc/home_feed') {
        delay = rtt + feedWork;
      } else if (endpoint === 'chat_rooms') {
        delay = rtt + roomsWork;
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
    if (flow === 'combined' && scenario !== 'fallback') {
      assert.deepEqual(calls, ['rpc/home_startup']);
    } else {
      const separate = ['chat_rooms', 'members', 'rpc/home_feed'];
      const expected = scenario === 'fallback' ? [...separate, 'rpc/home_startup'] : separate;
      assert.deepEqual(calls.sort(), expected);
    }
    return { tabs: Math.round(times.tabs), text: Math.round(times.text) };
  } finally {
    await context.close();
  }
}

try {
  const results = {};
  for (const [scenario, { reps }] of Object.entries(timing)) {
    const samples = { separate: [], combined: [] };
    for (let i = 0; i < reps; i++) {
      if (scenario === 'fallback') {
        samples.combined.push(await run('combined', scenario));
      } else {
        for (const flow of i % 2 ? ['combined', 'separate'] : ['separate', 'combined']) {
          samples[flow].push(await run(flow, scenario));
        }
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
    `iPhone viewport and simulated responses. Each request has a ${rtt} ms round trip. Feed work takes ${timing.usual.feedWork} ms in the usual case and ${timing.slow.feedWork} ms in the slow case. Fallback returns a missing-RPC error and must still render Home.`,
    'Timings are reported without pass/fail thresholds.',
    '',
    '| Scenario | Requests | Launches | Median tabs ready | Median fresh posts |',
    '| --- | --- | ---: | ---: | ---: |',
    ...rows,
    '',
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
} finally {
  await browser.close();
}
