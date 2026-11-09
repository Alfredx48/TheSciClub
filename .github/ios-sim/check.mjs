// iPhone checks in the Simulator (ios-sim-checks.yml): the store app, built against a TEST project, driven
// through Appium. A robot member signs in with email, opens the main pages, taps into a conversation and
// checks the keyboard leaves the message box in view. Fails on page errors, a page stuck on "Loading…",
// a blank page, or a box under the keyboard. Screenshots and report.json go to ./out for the run's artifact.
//
// Env: LT_EMAIL, LT_PASSWORD (a test robot), UDID (the booted Simulator). Never the live club: the
// workflow builds against the test project's secrets and refuses production's address.
import { mkdirSync, writeFileSync } from 'node:fs';
import { remote } from 'webdriverio';

const OUT = 'out';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { pages: [], problems: [], notes: [] };
const problem = (s) => {
  console.log(`PROBLEM ${s}`);
  report.problems.push(s);
};
const note = (s) => {
  console.log(s);
  report.notes.push(s);
};

const driver = await remote({
  hostname: '127.0.0.1',
  port: 4723,
  logLevel: 'warn',
  capabilities: {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': process.env.UDID,
    'appium:bundleId': 'com.thesciclub.app',
    'appium:newCommandTimeout': 240,
    'appium:webviewConnectTimeout': 30000,
    'appium:includeSafariInWebviews': false,
  },
});

async function shot(name) {
  await driver.switchContext('NATIVE_APP');
  await driver.saveScreenshot(`${OUT}/${name}.png`);
  await toWeb();
}
async function toWeb() {
  for (let i = 0; i < 30; i++) {
    const web = (await driver.getContexts()).find((c) => String(c.id ?? c).startsWith('WEBVIEW'));
    if (web) {
      await driver.switchContext(String(web.id ?? web));
      return;
    }
    await sleep(1000);
  }
  throw new Error("the app's web view never appeared");
}
const text = () =>
  driver.execute(() => (document.getElementById('main') ?? document.body).innerText.trim());
const errors = () => driver.execute(() => (window.__iosErrors ?? []).splice(0));
const watchErrors = () =>
  driver.execute(() => {
    if (window.__iosErrors) return;
    window.__iosErrors = [];
    addEventListener('error', (e) => window.__iosErrors.push(String(e.message)));
    addEventListener('unhandledrejection', (e) =>
      window.__iosErrors.push(`unhandled: ${String(e.reason?.message ?? e.reason)}`),
    );
  });
// In-app move, as the tab bar does: no reload, the same signed-in session.
const go = (path) =>
  driver.execute((p) => {
    history.pushState({}, '', p);
    dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v || Date.now() > end) return v;
    await sleep(500);
  }
}

try {
  await toWeb();
  await watchErrors();
  await shot('00-open');

  // Sign in with email, as a member would on the welcome screen.
  await go('/join');
  await sleep(1500);
  const click = (sel, re) =>
    driver.execute(
      (s, r) => {
        const el = [...document.querySelectorAll(s)].find((x) =>
          new RegExp(r, 'i').test(x.innerText || x.getAttribute('aria-label') || ''),
        );
        if (el) el.click();
        return !!el;
      },
      sel,
      re,
    );
  await click('button', 'already have an account');
  await sleep(800);
  if (
    !(await driver.execute(() => !!document.querySelector('input[placeholder="you@example.com"]')))
  )
    await click('button', 'Sign in with email|Use email and password|Other ways to sign in');
  const email = await waitFor(
    () =>
      driver
        .$('input[placeholder="you@example.com"]')
        .then((e) => e.isExisting().then((x) => x && e)),
    15000,
  );
  if (!email) throw new Error('no email box on the sign-in screen');
  await email.setValue(process.env.LT_EMAIL);
  await (await driver.$('input[type="password"]')).setValue(process.env.LT_PASSWORD);
  await shot('01-sign-in');
  await click('button', '^\\s*sign in\\s*$');
  const signedIn = await waitFor(
    () =>
      driver.execute(
        () => !location.pathname.startsWith('/join') && !!document.getElementById('main'),
      ),
    30000,
  );
  if (!signedIn) {
    await shot('01-sign-in-failed');
    throw new Error('sign-in did not finish within 30 s');
  }
  note(`signed in, at ${await driver.execute(() => location.pathname)}`);

  // The main pages: each must draw something, stop saying Loading… within 15 s, and raise no page error.
  for (const [i, path] of [
    '/home',
    '/chat',
    '/events',
    '/peers',
    '/notifications',
    '/me',
  ].entries()) {
    await go(path);
    const drawn = await waitFor(async () => {
      const t = await text();
      return t.length > 3 && !/^Loading…$|Loading…$/.test(t) && t;
    }, 15000);
    const t = await text().catch(() => '');
    if (!drawn) problem(`${path}: ${t.length < 3 ? 'blank' : 'still "Loading…"'} after 15 s`);
    const wide = await driver.execute(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (wide) problem(`${path}: wider than the screen`);
    for (const e of await errors()) problem(`${path}: page error: ${e}`);
    report.pages.push({ path, chars: t.length });
    await shot(`1${i}-${path.slice(1)}`);
  }

  // Keyboard: open the first conversation, tap the message box, and check the box sits above the keyboard.
  await go('/chat');
  await sleep(2500);
  const opened = await driver.execute(() => {
    const a = [...document.querySelectorAll('a[href^="/chat/t/"]')][0];
    if (a) a.click();
    return a?.getAttribute('href') ?? null;
  });
  if (!opened) note('no conversation to open: keyboard check skipped');
  else {
    const box = await waitFor(
      () => driver.$('textarea').then((e) => e.isExisting().then((x) => x && e)),
      15000,
    );
    if (!box) problem(`${opened}: no message box`);
    else {
      await box.click();
      await sleep(2500);
      await driver.switchContext('NATIVE_APP');
      const shown = await driver.isKeyboardShown().catch(() => false);
      let kbTop = null;
      if (shown) {
        const kb = await driver.$('-ios class chain:**/XCUIElementTypeKeyboard');
        if (await kb.isExisting()) kbTop = await kb.getLocation('y');
      }
      await driver.saveScreenshot(`${OUT}/20-keyboard.png`);
      await toWeb();
      if (!shown)
        note(
          'the Simulator showed no on-screen keyboard (hardware keyboard on?): keyboard check skipped',
        );
      else {
        // The web view fills the screen (contentInset never), so page points are screen points.
        const bottom = await driver.execute(
          () => document.querySelector('textarea').getBoundingClientRect().bottom,
        );
        note(`keyboard top ${kbTop}, message box bottom ${Math.round(bottom)}`);
        if (kbTop != null && bottom > kbTop + 2)
          problem(
            `${opened}: the message box is under the keyboard (box bottom ${Math.round(bottom)}, keyboard top ${kbTop})`,
          );
      }
      for (const e of await errors()) problem(`${opened}: page error: ${e}`);
    }
  }
} catch (err) {
  problem(`stopped: ${String(err?.message ?? err).split('\n')[0]}`);
  await driver.saveScreenshot(`${OUT}/99-stopped.png`).catch(() => {});
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await driver.deleteSession().catch(() => {});
}
console.log(`${report.pages.length} pages, ${report.problems.length} problem(s)`);
process.exit(report.problems.length ? 1 : 0);
