// iPhone checks in the Simulator (ios-sim-checks.yml): the store app, built against a TEST project, driven
// through Appium the way VoiceOver sees it (the accessibility tree), not by reading the web page: Appium
// can't attach to the iOS 26 Simulator's web view. A robot member signs in with email, opens each tab,
// opens a conversation and checks the keyboard leaves the message box in view. Fails on a page stuck on
// "Loading…", a tab with nothing on it, or a box under the keyboard. Screenshots and report.json go to ./out.
//
// Env: LT_EMAIL, LT_PASSWORD (a test robot), UDID (the booted Simulator).
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
  // The first session builds WebDriverAgent on the runner: several minutes.
  connectionRetryTimeout: 900000,
  connectionRetryCount: 0,
  port: 4723,
  logLevel: 'warn',
  capabilities: {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:udid': process.env.UDID,
    'appium:bundleId': 'com.thesciclub.app',
    'appium:newCommandTimeout': 240,
    'appium:wdaLaunchTimeout': 600000,
    'appium:wdaConnectionTimeout': 600000,
  },
});

const shot = (name) => driver.saveScreenshot(`${OUT}/${name}.png`).catch(() => {});
// An element by what VoiceOver reads (its label or name), of one type.
const byLabel = (type, re) =>
  driver.$(
    `-ios predicate string:type == '${type}' AND (label MATCHES[c] '${re}' OR name MATCHES[c] '${re}')`,
  );
const ofType = (type) => driver.$(`-ios predicate string:type == '${type}'`);
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v || Date.now() > end) return v;
    await sleep(700);
  }
}
const visible = async (el) => ((await el.isExisting()) ? el : null);
// Every bit of text on screen, as VoiceOver would read it.
const screenText = async () => {
  const src = await driver.getPageSource();
  return [...src.matchAll(/(?:label|value)="([^"]*)"/g)].map((m) => m[1]).join(' \n');
};

try {
  await sleep(4000);
  await shot('00-open');

  // Sign in with email, as a member would on the welcome screen.
  const already = await waitFor(
    () => visible(byLabel('XCUIElementTypeButton', '.*already have an account.*')),
    30000,
  );
  if (!already) throw new Error('no "I already have an account" on the welcome screen');
  await already.click();
  await sleep(1500);
  let email = await waitFor(() => visible(ofType('XCUIElementTypeTextField')), 4000);
  if (!email) {
    const toggle = await visible(
      byLabel('XCUIElementTypeButton', '.*(sign in|join) with email.*|.*use email and password.*'),
    );
    if (toggle) await toggle.click();
    email = await waitFor(() => visible(ofType('XCUIElementTypeTextField')), 10000);
  }
  if (!email) throw new Error('no email box on the sign-in screen');
  await email.click();
  await email.setValue(process.env.LT_EMAIL);
  const password = await ofType('XCUIElementTypeSecureTextField');
  await password.click();
  await password.setValue(process.env.LT_PASSWORD);
  await shot('01-sign-in');
  const signIn = await visible(byLabel('XCUIElementTypeButton', '\\s*sign in\\s*'));
  if (!signIn) throw new Error('no "Sign in" button');
  await signIn.click();
  const tabBar = await waitFor(
    () => visible(byLabel('XCUIElementTypeLink', '(Home|Events)(,.*)?')),
    30000,
  );
  if (!tabBar) {
    await shot('01-sign-in-failed');
    throw new Error('the tab bar did not appear within 30 s of signing in');
  }
  note('signed in');

  // Each tab: something on it within 15 s, and not still "Loading…".
  for (const [i, tab] of ['Home', 'Peers', 'Chat', 'Events', 'Me'].entries()) {
    const link = await waitFor(
      () => visible(byLabel('XCUIElementTypeLink', `${tab}(,.*)?`)),
      10000,
    );
    if (!link) {
      problem(`no ${tab} tab`);
      continue;
    }
    await link.click();
    const drawn = await waitFor(async () => {
      const t = await screenText();
      return t.length > 80 && !/Loading…/.test(t) && t;
    }, 15000);
    const t = await screenText().catch(() => '');
    if (!drawn)
      problem(`${tab}: ${/Loading…/.test(t) ? 'still "Loading…"' : 'nearly empty'} after 15 s`);
    report.pages.push({ tab, chars: t.length });
    await shot(`1${i}-${tab.toLowerCase()}`);
  }

  // Keyboard: open the first conversation, tap the message box, and check the box sits above the keyboard.
  await (await byLabel('XCUIElementTypeLink', 'Chat(,.*)?')).click();
  await sleep(2500);
  const convo = await waitFor(
    () =>
      visible(
        driver.$(
          `-ios predicate string:type == 'XCUIElementTypeLink' AND NOT (label MATCHES[c] '(Home|Peers|Chat|Events|Me)(,.*)?')`,
        ),
      ),
    10000,
  );
  if (!convo) note('no conversation to open: keyboard check skipped');
  else {
    const name = await convo.getAttribute('label');
    await convo.click();
    const box = await waitFor(() => visible(ofType('XCUIElementTypeTextView')), 15000);
    if (!box) problem(`conversation "${name}": no message box`);
    else {
      await box.click();
      await sleep(2500);
      const shown = await driver.isKeyboardShown().catch(() => false);
      await shot('20-keyboard');
      if (!shown)
        note('no on-screen keyboard appeared (hardware keyboard on?): keyboard check skipped');
      else {
        const kb = await driver.$('-ios class chain:**/XCUIElementTypeKeyboard');
        const kbTop = (await kb.getLocation()).y;
        const at = await box.getLocation();
        const size = await box.getSize();
        const bottom = at.y + size.height;
        note(`keyboard top ${kbTop}, message box bottom ${bottom}`);
        if (bottom > kbTop + 2)
          problem(
            `conversation "${name}": the message box is under the keyboard (box bottom ${bottom}, keyboard top ${kbTop})`,
          );
      }
    }
  }
} catch (err) {
  problem(`stopped: ${String(err?.message ?? err).split('\n')[0]}`);
  await shot('99-stopped');
  await driver
    .getPageSource()
    .then((s) => writeFileSync(`${OUT}/99-stopped-tree.xml`, s))
    .catch(() => {});
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await driver.deleteSession().catch(() => {});
}
console.log(`${report.pages.length} tabs, ${report.problems.length} problem(s)`);
process.exit(report.problems.length ? 1 : 0);
