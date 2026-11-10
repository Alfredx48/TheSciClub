// iPhone checks in the Simulator (ios-sim-checks.yml): the store app, built against a TEST project, driven
// through Appium the way VoiceOver sees it (the accessibility tree), not by reading the web page: Appium
// can't attach to the iOS 26 Simulator's web view. A robot member signs in with email, opens each tab,
// opens a conversation and checks the keyboard leaves the message box in view. Fails on a page stuck on
// "Loading…", a tab with nothing on it, or a box under the keyboard. Screenshots and report.json go to ./out.
//
// Env: LT_EMAIL, LT_PASSWORD (a test robot), UDID (the booted Simulator).
import { mkdirSync, writeFileSync } from 'node:fs';
import { remote } from 'webdriverio';

// Words on a button that change something; never tapped by the click-through.
const DENY =
  /\b(delete|remove|leave|block|unblock|report|sign ?out|log ?out|pause|send|post|save|submit|confirm|yes|decline|accept|approve|invite|join|rsvp|going|interested|register|check ?in|mute|like|react|follow|add|create|new|publish|share|copy|upload|photo|camera|edit|change|update|reset|turn|allow|mark|clear|start|end|answer|connect|introduce|link|ask|request|apply|claim|download|call|email|text|cancel|undo|hide|use my)\b/i;
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
    // GitHub's shared Macs can take minutes to report the iPhone booted (Nov 8: 2 min was not enough).
    'appium:simulatorStartupTimeout': 600000,
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
  // Type, then close the keyboard as a member would: it covers the password box, and a tap there hits a key.
  // Close the keyboard as a member would, by tapping the page's heading: a web page drops its keyboard when
  // nothing is focused. Without this the keyboard covers the password box and a tap there hits a key.
  const closeKeyboard = async () => {
    if (!(await driver.isKeyboardShown().catch(() => false))) return;
    const heading = await driver.$(
      `-ios predicate string:type == 'XCUIElementTypeStaticText' AND label MATCHES[c] '(Welcome back|Sign in).*'`,
    );
    if (await heading.isExisting()) await heading.click();
    else await driver.execute('mobile: tap', { x: 30, y: 160 });
    await sleep(1000);
    if (await driver.isKeyboardShown().catch(() => false))
      note('the keyboard stayed open after tapping the page');
  };
  await email.click();
  await email.setValue(process.env.LT_EMAIL);
  await closeKeyboard();
  const password = await ofType('XCUIElementTypeSecureTextField');
  await password.click();
  await password.setValue(process.env.LT_PASSWORD);
  await closeKeyboard();
  const typed = await email.getAttribute('value');
  if (typed !== process.env.LT_EMAIL) note(`email box reads "${typed}", not the robot's address`);
  await shot('01-sign-in');
  const signIn = await visible(byLabel('XCUIElementTypeButton', '\\s*sign in\\s*'));
  if (!signIn) throw new Error('no "Sign in" button');
  await signIn.click();
  // First launch, once signed in: "Turn on notifications?" before the club (owner, 2026-11-09).
  const first = await waitFor(async () => {
    if (/Turn on notifications\?/.test(await screenText())) return 'asked';
    return (await visible(byLabel('XCUIElementTypeLink', '(Home|Events)(,.*)?'))) ? 'club' : null;
  }, 30000);
  await shot('02-notifications-ask');
  if (first === 'club')
    problem('first launch went straight to the club: no "Turn on notifications?"');
  if (first === 'asked') {
    note('asked "Turn on notifications?" right after signing in, on the first launch');
    const on = await visible(byLabel('XCUIElementTypeButton', '\\s*Turn on notifications\\s*'));
    if (!on) problem('no "Turn on notifications" button');
    else {
      await on.click();
      // Apple's own question comes from the system, not the app.
      const asked = await waitFor(() => driver.getAlertText(), 10000);
      await shot('03-apple-question');
      if (!asked) problem('tapping "Turn on notifications" did not bring up Apple\'s question');
      else {
        note(`Apple asked: "${asked.split('\n')[0]}"`);
        await driver
          .execute('mobile: alert', { action: 'accept', buttonLabel: 'Allow' })
          .catch(() => driver.acceptAlert());
      }
    }
    // Still asking (e.g. the Simulator gave no device token): note it, and go on with "Not now".
    await sleep(4000);
    const t = await screenText().catch(() => '');
    if (/Turn on notifications\?/.test(t)) {
      note(`still on the question after answering: ${t.replace(/\s+/g, ' ').slice(0, 160)}`);
      const later = await visible(byLabel('XCUIElementTypeButton', '\\s*Not now\\s*'));
      if (later) await later.click();
    }
  }
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
    // Click-through: every safe button on the tab (nothing that sends, saves, deletes, joins, blocks or signs out),
    // checking the app still shows its tab bar and nothing is stuck on "Loading…" afterwards.
    const names = [];
    for (const b of await driver.$$(
      `-ios predicate string:type == 'XCUIElementTypeButton' AND visible == 1`,
    )) {
      const n = ((await b.getAttribute('label').catch(() => '')) || '').trim();
      if (n && !DENY.test(n) && n.length < 60 && !names.includes(n)) names.push(n);
    }
    let tapped = 0;
    for (const n of names.slice(0, 12)) {
      const b = await visible(byLabel('XCUIElementTypeButton', n.replace(/[^\w ]/g, '.')));
      if (!b) continue;
      await b.click().catch(() => {});
      tapped++;
      await sleep(1500);
      const after = await screenText().catch(() => '');
      if (
        /Loading…/.test(after) &&
        !(await waitFor(async () => !/Loading…/.test(await screenText()), 12000))
      )
        problem(`${tab} after tapping "${n}": still "Loading…" after 12 s`);
      // Back to the tab: tap the tab itself, or close what opened first.
      let home = await visible(byLabel('XCUIElementTypeLink', `${tab}(,.*)?`));
      if (!home) {
        const back = await visible(byLabel('XCUIElementTypeButton', '(Back|Close.*|Done)'));
        if (back) await back.click().catch(() => {});
        home = await waitFor(() => visible(byLabel('XCUIElementTypeLink', `${tab}(,.*)?`)), 8000);
      }
      if (home) await home.click().catch(() => {});
      else problem(`${tab} after tapping "${n}": the tab bar did not come back`);
      await sleep(800);
    }
    report.pages[report.pages.length - 1].tapped = tapped;
  }

  // Keyboard: open the first conversation, tap the message box, and check the box sits above the keyboard.
  await (await byLabel('XCUIElementTypeLink', 'Chat(,.*)?')).click();
  await sleep(2500);
  // A conversation row says when its last message came (4:21am, Yesterday, Mon, Nov 3): not a tab or a filter.
  const convo = await waitFor(
    () =>
      visible(
        driver.$(
          `-ios predicate string:(type == 'XCUIElementTypeLink' OR type == 'XCUIElementTypeButton') AND label MATCHES[c] '.*([0-9]{1,2}:[0-9]{2} ?(am|pm)|yesterday).*'`,
        ),
      ),
    10000,
  );
  if (!convo) note('no conversation to open: keyboard check skipped');
  else {
    const name = await convo.getAttribute('label');
    note(`opening the conversation "${name}"`);
    await convo.click();
    await sleep(2500);
    // Left the Chat list? Its "Ask or post to the club" box would otherwise be the one measured.
    const stillList = await visible(
      byLabel('XCUIElementTypeStaticText', 'Ask or post to the club'),
    );
    if (stillList) problem(`tapping "${name}" did not open the conversation`);
    const box = stillList
      ? null
      : await waitFor(() => visible(ofType('XCUIElementTypeTextView')), 15000);
    if (!box && !stillList) problem(`conversation "${name}": no message box`);
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
      // Send a message and see it in the conversation (a test project; the nightly trim removes it).
      const mark = `iPhone check ${new Date().toISOString().slice(0, 16)} [lt:ios#sim]`;
      await box.setValue(mark).catch(() => {});
      const send = await visible(byLabel('XCUIElementTypeButton', 'Send.*'));
      if (!send) problem(`conversation "${name}": no Send button`);
      else {
        await send.click();
        const seen = await waitFor(async () => (await screenText()).includes(mark), 15000);
        if (!seen) problem(`conversation "${name}": a sent message did not appear within 15 s`);
        else note('sent a message and saw it in the conversation');
        await shot('21-sent');
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
