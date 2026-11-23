import { chromium, devices } from 'playwright';

const names = ['Sign in', 'Load Home', 'Open a conversation', 'Open a shared event'];
const origins = {
  tests: 'https://tests.thesciclub.com',
  live: 'https://thesciclub.com',
};
const reads = new Set([
  'home_startup',
  'home_feed',
  'home_topics_ranked',
  'home_topics_shown',
  'chat_my_threads',
  'chat_post_scores',
  'chat_post_view_counts',
  'chat_topic_room',
  'my_badge_counts',
  'my_unproven_email',
  'my_event_declined',
  'public_event',
]);

export function allowedRequest(url, method, supabase) {
  if (url.origin !== supabase && url.hostname.endsWith('.supabase.co')) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  if (url.origin !== supabase) return false;
  return (
    method === 'POST' &&
    (url.pathname === '/storage/v1/object/sign' ||
      url.pathname.startsWith('/storage/v1/object/sign/') ||
      (url.pathname.startsWith('/rest/v1/rpc/') && reads.has(url.pathname.split('/').at(-1))))
  );
}

function need(env, name) {
  if (!env[name]) throw new Error(`Set ${name} before enabling this journey.`);
  return env[name];
}

function settings(env) {
  const target = env.JOURNEY_TARGET;
  if (!Object.hasOwn(origins, target)) throw new Error('JOURNEY_TARGET must be tests or live.');
  const ref = need(env, 'JOURNEY_SUPABASE_REF');
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('Invalid Supabase project reference.');
  if ((target === 'live') !== (ref === 'erijdvqnxavwezsbbojv')) {
    throw new Error('The journey must use its own Supabase project.');
  }
  const thread = need(env, 'JOURNEY_THREAD_ID');
  const event = need(env, 'JOURNEY_EVENT_ID');
  const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if (!uuid.test(thread) || !uuid.test(event)) throw new Error('The fixture IDs must be UUIDs.');
  return {
    origin: origins[target],
    ref,
    supabase: `https://${ref}.supabase.co`,
    key: need(env, 'JOURNEY_ANON_KEY'),
    email: need(env, 'JOURNEY_EMAIL'),
    password: need(env, 'JOURNEY_PASSWORD'),
    resultToken: need(env, 'JOURNEY_RESULT_TOKEN'),
    thread,
    event,
    eventTitle: need(env, 'JOURNEY_EVENT_TITLE'),
  };
}

function request(url, options = {}) {
  return fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15_000) });
}

async function post(config, path, body) {
  return request(config.supabase + path, {
    method: 'POST',
    headers: { apikey: config.key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function buildOf(origin) {
  try {
    const response = await request(`${origin}/version.json?journey=${Date.now()}`);
    if (!response.ok) return null;
    const { built } = await response.json();
    return typeof built === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(built)
      ? built
      : null;
  } catch {
    return null;
  }
}

async function run(config) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
  context.setDefaultTimeout(15_000);
  const steps = [];
  let failed = null;
  try {
    // Suppress analytics, read receipts and any other app writes in the probe.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (allowedRequest(url, route.request().method(), config.supabase)) await route.continue();
      else await route.fulfill({ status: 403 });
    });
    const page = await context.newPage();
    const go = async (path) => {
      const response = await page.goto(config.origin + path, { waitUntil: 'domcontentloaded' });
      if (!response?.ok()) throw new Error('Page did not load.');
    };
    const actions = [
      async () => {
        const response = await post(config, '/auth/v1/token?grant_type=password', {
          email: config.email,
          password: config.password,
        });
        if (!response.ok) throw new Error('Password sign-in failed.');
        const session = await response.json();
        if (!session.access_token) throw new Error('No session returned.');
        await page.addInitScript(
          ({ origin, ref, signedIn }) => {
            if (location.origin === origin) {
              localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(signedIn));
            }
          },
          { origin: config.origin, ref: config.ref, signedIn: session },
        );
      },
      async () => {
        await go('/home');
        await page.getByRole('textbox', { name: 'Ask or post to the club' }).waitFor();
        await page
          .locator('ul.arrive > li')
          .or(page.getByText('Nothing here yet.', { exact: true }))
          .first()
          .waitFor();
        await page
          .getByRole('navigation', { name: 'Main' })
          .getByRole('link', { name: /^Chat/ })
          .waitFor();
      },
      async () => {
        await page
          .getByRole('navigation', { name: 'Main' })
          .getByRole('link', { name: /^Chat/ })
          .click();
        await page.locator(`a[href="/chat/t/${config.thread}"]`).click();
        await page.getByRole('log', { name: /^Messages with / }).waitFor();
      },
      async () => {
        await go(`/e/${config.event}`);
        await page.getByRole('heading', { name: config.eventTitle, exact: true }).waitFor();
      },
    ];
    for (const [index, action] of actions.entries()) {
      const started = performance.now();
      try {
        await action();
      } catch {
        failed = index + 1;
      }
      const elapsed = Math.round(performance.now() - started);
      steps.push(elapsed);
      console.log(`${names[index]}: ${failed ? 'failed' : 'passed'} in ${elapsed} ms`);
      if (failed) break;
    }
  } finally {
    await browser.close();
  }
  return { steps, failed };
}

if (import.meta.main) {
  try {
    const config = settings(process.env);
    const build = await buildOf(config.origin);
    const { steps, failed } = await run(config);
    const result = await post(config, '/rest/v1/rpc/record_member_journey', {
      p_token: config.resultToken,
      p_build: build,
      p_steps_ms: steps,
      p_failed_step: failed,
    });
    if (!result.ok)
      throw new Error(`The dashboard could not accept the result (HTTP ${result.status}).`);
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'The member journey could not run.');
    process.exitCode = 1;
  }
}
