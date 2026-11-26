// The admin site's change log (admin/change-log.tsx), written from the repository's own history
// like the release list (admin/releases.mjs). The owner, 2026-11-25: "keep better track of all
// the changes we make".
//
//   node admin/changes.mjs log dist-admin/changes.json dist-admin/change-shots
//     The whole log, in the admin site's build (vite.admin.config.ts): every release of the
//     last WEEKS weeks and what it brought, what is on tests and not on main, each week's
//     summary, and the entries' screenshots copied beside it.
//   node admin/changes.mjs waiting dist/change-log/on-tests.json dist/change-log/shots
//     Only what is on tests and not on main, in the test site's build (site.yml), which runs on
//     every push to tests. The admin site is built only when main is pushed, so it asks the
//     test site for this (cloudflare/admin/worker.ts) to say what is waiting now.
//
// A release is a release-<build minute> tag (site.yml), so its time is when the app went out.
// Before the first tag (2026-11-22) pushes were not timed: those changes are listed under the
// Pacific day they were committed to main. A change is on main when a commit with the same
// first line is: a cherry-pick keeps its first line even where its conflicts were settled by
// hand, which a comparison of the patches calls a different change.
//
// Needs the whole history and both branches (a full fetch, as site.yml's checkouts are). The
// repository is public, so this is what anybody can read there.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  pacificDay,
  parseEntry,
  parsePastPrompts,
  parseWeek,
  person,
  plainTitle,
  SURFACES,
  surfaceOf,
  weekOf,
} from './changes-lib.mjs';

const WEEKS = 26;
const ENTRIES = 'admin/changes/entries/';
const here = path.dirname(import.meta.dirname);
const [mode = 'log', out = 'dist-admin/changes.json', shotsOut] = process.argv.slice(2);

const git = (...args) =>
  execFileSync('git', args, { cwd: here, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 }).trim();
const has = (ref) => {
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
    return true;
  } catch {
    return false;
  }
};
// In a build the branch checked out is HEAD and the other is the remote's.
const ref = (branch) =>
  [`origin/${branch}`, branch].find(has) ??
  (git('branch', '--show-current') === branch ? 'HEAD' : null);

const key = (subject) => createHash('sha1').update(subject).digest('hex').slice(0, 12);

/** The commits of a range, newest first, each with the files it changed. */
function commits(range, ...more) {
  const text = git(
    'log',
    '--no-merges',
    '--name-only',
    '--format=%x01%H%x09%an%x09%cI%x09%s',
    ...more,
    range,
  );
  return text
    .split('\x01')
    .filter(Boolean)
    .map((block) => {
      const [head, ...files] = block.split('\n').filter(Boolean);
      const [hash, author, at, ...subject] = head.split('\t');
      return { hash, author, at: new Date(at).toISOString(), subject: subject.join('\t'), files };
    });
}

/** A commit as the log shows it. Its entry is read as the branch has it now. */
function change(commit, branch) {
  const entryPath = commit.files.find((file) => file.startsWith(ENTRIES) && file.endsWith('.md'));
  let entry = null;
  if (entryPath) {
    try {
      entry = parseEntry(git('show', `${branch}:${entryPath}`));
    } catch {
      // Taken out again since: the commit's first line stands in.
    }
  }
  // What was typed for it: its entry says, or for a change from before entries did, the past's
  // list under its key.
  const prompts = entry?.prompts.length ? entry.prompts : (past.get(key(commit.subject)) ?? []);
  return {
    sha: commit.hash.slice(0, 8),
    key: key(commit.subject),
    by: person(commit.author),
    at: commit.at,
    title: plainTitle(commit.subject),
    surface: entry?.surface ?? surfaceOf(commit.files, commit.subject),
    ...(entry
      ? {
          entry: {
            title: entry.title,
            ...(entry.type ? { type: entry.type } : {}),
            summary: entry.summary,
            shots: entry.shots,
          },
        }
      : {}),
    ...(prompts.length > 0 ? { prompts } : {}),
    ...(iosBuilt.has(commit.hash) ? { ios: iosBuilt.get(commit.hash) } : {}),
  };
}

/** The past changes' prompts, by key: every file of admin/changes/prompts/. */
function pastPrompts() {
  const folder = path.join(here, 'admin/changes/prompts');
  const found = new Map();
  if (!existsSync(folder)) return found;
  for (const file of readdirSync(folder).filter((name) => name.endsWith('.json'))) {
    for (const [change, prompts] of parsePastPrompts(
      readFileSync(path.join(folder, file), 'utf8'),
    )) {
      found.set(change, prompts);
    }
  }
  return found;
}

/**
 * The iPhone app is built from an ios-v<version> tag and has what main had then, so the log
 * marks the change each version was built at: everything after it is not in that app.
 */
function iosBuilds(main) {
  const built = new Map();
  for (const line of git(
    'for-each-ref',
    '--merged',
    main,
    '--format=%(refname:short)%09%(objectname)%09%(*objectname)',
    'refs/tags/ios-v*',
  ).split('\n')) {
    const [tag, object, peeled] = line.split('\t');
    if (tag) built.set(peeled || object, tag.replace(/^ios-v/, ''));
  }
  return built;
}

/**
 * What is on tests and not on main: a commit of tests whose first line main does not have, and
 * that still has something main lacks.
 *
 * The first line alone listed twice too many (73 where 36 were waiting, 2026-11-25): work that
 * went to main squashed under another line, and a change and its revert, each stayed listed for
 * good. So the two branches are compared as they are now, and each line tests has and main does
 * not is traced to the commit of tests that wrote it (git blame). A commit that wrote none of
 * them is not waiting, unless it only took lines out, or changed a picture, in a file where
 * tests still lacks something main has.
 */
function waiting(main, tests) {
  const onMain = new Set(git('log', '--format=%s', main).split('\n'));
  const candidates = commits(`${main}..${tests}`).filter((commit) => !onMain.has(commit.subject));
  if (candidates.length === 0) return [];

  // The lines only tests has, as [first line, how many] by file; and the files where tests
  // only lacks lines, is not text, or is gone.
  const added = new Map();
  const lacking = new Set();
  let file = null;
  for (const line of git('diff', '-U0', '--no-renames', main, tests).split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = null;
    } else if (line.startsWith('--- a/')) {
      // Stands unless lines of this file turn out to be only on tests.
      lacking.add(line.slice(6));
    } else if (line.startsWith('+++ b/')) {
      file = line.slice(6);
    } else if (line.startsWith('Binary files ')) {
      const name = / and b\/(.+) differ$/.exec(line)?.[1];
      if (name) lacking.add(name);
    } else if (line.startsWith('@@ ') && file) {
      const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      const count = m ? (m[2] === undefined ? 1 : Number(m[2])) : 0;
      if (m && count > 0) added.set(file, [...(added.get(file) ?? []), [Number(m[1]), count]]);
    }
  }
  const wrote = new Set();
  for (const [name, ranges] of added) {
    lacking.delete(name);
    const lines = ranges.flatMap(([start, count]) => ['-L', `${start},+${count}`]);
    for (const line of git('blame', '-l', '-s', ...lines, tests, '--', name).split('\n')) {
      const hash = /^\^?([0-9a-f]{40})/.exec(line)?.[1];
      if (hash) wrote.add(hash);
    }
  }
  const tookOut = (commit) =>
    git('show', '--numstat', '--format=', '--no-renames', commit.hash)
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'))
      .some(([plus, minus, name]) => lacking.has(name) && (plus === '-' || Number(minus) > 0));

  return candidates
    .filter((commit) => wrote.has(commit.hash) || tookOut(commit))
    .map((commit) => change(commit, tests));
}

function releases(main) {
  const since = new Date(Date.now() - WEEKS * 7 * 86_400_000).toISOString();
  const tags = git('tag', '--list', 'release-*', '--sort=refname', '--merged', main)
    .split('\n')
    .filter((tag) => /^release-\d{4}-\d{2}-\d{2}T\d{4}$/.test(tag));
  // Which release first had each commit: the earliest tag it is under.
  // What the first tag brought is not known (nothing before it was timed), so it only marks
  // where the timed releases start.
  const releaseOf = new Map();
  let before = tags[0] ?? null;
  for (const tag of tags.slice(1)) {
    for (const hash of git('rev-list', '--no-merges', `${before}..${tag}`).split('\n')) {
      if (hash) releaseOf.set(hash, tag);
    }
    before = tag;
  }
  // On main since the last release: an admin-site change, or one whose release is on its way.
  const sinceLast = new Set(before ? git('rev-list', `${before}..${main}`).split('\n') : []);
  const groups = new Map();
  for (const commit of commits(main, `--since=${since}`)) {
    const tag = releaseOf.get(commit.hash);
    let group;
    if (tag) {
      const m = /^release-(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})$/.exec(tag);
      group = { id: tag, kind: 'release', at: `${m[1]}T${m[2]}:${m[3]}:00.000Z` };
    } else if (sinceLast.has(commit.hash)) {
      group = { id: 'since-last-release', kind: 'pending', at: commit.at };
    } else {
      const day = pacificDay(commit.at);
      group = { id: `day-${day}`, kind: 'day', at: commit.at };
    }
    const found = groups.get(group.id) ?? { ...group, changes: [] };
    // A day's time is its last commit's; a pending group's its newest.
    if (found.at < group.at) found.at = group.at;
    found.changes.push(change(commit, main));
    groups.set(group.id, found);
  }
  return [...groups.values()]
    .map((group) => {
      const day = pacificDay(group.at);
      return { ...group, day, week: weekOf(day) };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

function weeks() {
  const folder = path.join(here, 'admin/changes/weeks');
  if (!existsSync(folder)) return {};
  return Object.fromEntries(
    readdirSync(folder)
      .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
      .map((file) => [file.slice(0, 10), parseWeek(readFileSync(path.join(folder, file), 'utf8'))]),
  );
}

const main = ref('main');
const tests = ref('tests');
const iosBuilt = main ? iosBuilds(main) : new Map();
const past = pastPrompts();
let body;
if (!main) {
  body = { built: new Date().toISOString(), error: 'This build has no main branch to read.' };
} else if (mode === 'waiting') {
  body = { built: new Date().toISOString(), waiting: tests ? waiting(main, tests) : [] };
} else {
  body = {
    built: new Date().toISOString(),
    surfaces: SURFACES,
    releases: releases(main),
    waiting: tests ? waiting(main, tests) : [],
    weeks: weeks(),
  };
}
mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
writeFileSync(out, JSON.stringify(body));

const shots = path.join(here, 'admin/changes/shots');
if (shotsOut && existsSync(shots)) cpSync(shots, shotsOut, { recursive: true });

console.log(
  body.error ??
    `${path.basename(out)}: ${body.releases ? `${body.releases.length} releases, ` : ''}${body.waiting.length} waiting on tests`,
);
