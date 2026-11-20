// Release check for the reply editor in a native iPhone Simulator build.
import assert from 'node:assert/strict';
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
    // GitHub's shared Macs can take minutes to report the iPhone booted (Nov 8: 2 min was not enough).
    'appium:simulatorStartupTimeout': 600000,
    'appium:wdaConnectionTimeout': 600000,
  },
});

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

  // Sign in with email, as a member would on the welcome screen.
  const already = await waitFor(
    () => visible(byLabel('XCUIElementTypeButton', '.*already have an account.*')),
    30000,
  );
  if (!already) throw new Error('no "I already have an account" on the welcome screen');
  // Up to three taps: on Nov 18 a first tap left the welcome screen up (it may come while the screen still arrives).
  let email = null;
  for (let tap = 1; tap <= 3 && !email; tap++) {
    const button = await visible(byLabel('XCUIElementTypeButton', '.*already have an account.*'));
    if (!button) break;
    await button.click();
    await sleep(1500);
    email = await waitFor(() => visible(ofType('XCUIElementTypeTextField')), 4000);
    if (!email && tap > 1) report.notes.push(`"I already have an account" needed tap ${tap}`);
  }
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
  const signIn = await visible(byLabel('XCUIElementTypeButton', '\\s*sign in\\s*'));
  if (!signIn) throw new Error('no "Sign in" button');
  await signIn.click();
  const tabBar = await waitFor(
    () => visible(byLabel('XCUIElementTypeLink', '(Home|Events)(,.*)?')),
    30000,
  );
  if (!tabBar) {
    throw new Error('the tab bar did not appear within 30 s of signing in');
  }
  note('signed in');

  const home = () => visible(byLabel('XCUIElementTypeLink', 'Home(,.*)?'));
  const topicLinks =
    '(?s)(Reply to .*|[0-9]+ (reply|replies) to .*|Open the (question|post)|Question .+)';
  const topic = await waitFor(() => visible(byLabel('XCUIElementTypeLink', topicLinks)), 30000);
  assert(topic, 'Home has no accessible discussion link');
  const name = (await topic.getAttribute('label')) || (await topic.getAttribute('name'));
  assert(name, 'The Home discussion link has no accessible name');
  const sameTopic = () =>
    visible(
      driver.$(
        `-ios predicate string:type == 'XCUIElementTypeLink' AND (label == ${JSON.stringify(name)} OR name == ${JSON.stringify(name)})`,
      ),
    );
  await topic.click();
  note('opened a discussion from Home');

  const editor = () =>
    waitFor(() => visible(byLabel('XCUIElementTypeTextView', 'Reply to this post')), 30000);
  const reply = await waitFor(
    () => visible(byLabel('XCUIElementTypeButton', 'Reply( to .*post)?')),
    30000,
  );
  assert(reply, 'The discussion has no accessible Reply button');
  await reply.click();
  const box = await editor();
  assert(box, 'Reply editor did not appear');
  assert(
    await waitFor(async () => (await screenText()).includes('Replying to'), 5000),
    'Reply did not select its parent',
  );
  const keyboardOnReply = await waitFor(() => driver.isKeyboardShown(), 3500);
  if (!keyboardOnReply) await box.click();
  assert(
    await waitFor(() => driver.isKeyboardShown(), 10000),
    'The software keyboard did not open',
  );
  const keyboard = await ofType('XCUIElementTypeKeyboard');
  assert(
    await waitFor(async () => {
      const keyboardTop = (await keyboard.getLocation()).y;
      const boxBottom = (await box.getLocation()).y + (await box.getSize()).height;
      return boxBottom <= keyboardTop + 2;
    }, 5000),
    'The reply editor is under the keyboard',
  );
  note(
    `Reply editor above keyboard (bot opened keyboard by ${keyboardOnReply ? 'Reply' : 'tapping the editor'})`,
  );

  const marker = 'Unsent reply simulator draft';
  await driver.keys([...marker]);
  assert(
    await waitFor(async () => (await screenText()).includes(marker), 10000),
    'Typing did not reach the reply editor',
  );
  const homeLink = await home();
  assert(homeLink, 'The Home tab is missing');
  await homeLink.click();
  assert(
    await waitFor(async () => !(await screenText()).includes(marker), 15000),
    'Home did not replace the discussion',
  );
  const reopen = await waitFor(sameTopic, 20000);
  assert(reopen, 'The same discussion was missing on return to Home');
  await reopen.click();
  assert(await editor(), 'Reply editor did not reopen');
  assert(
    await waitFor(async () => (await screenText()).includes(marker), 15000),
    'Draft disappeared after leaving the discussion',
  );
  note('An unsent reply draft survived leaving and reopening the discussion.');
} catch (err) {
  problem(`stopped: ${String(err?.message ?? err).split('\n')[0]}`);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
  await driver.deleteSession().catch(() => {});
}
console.log(`iPhone reply check, ${report.problems.length} problem(s)`);
process.exit(report.problems.length ? 1 : 0);
