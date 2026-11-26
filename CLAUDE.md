# Working here

## Tests (owner, 2026-11-08)

The suite grows with every change and a third of each change's edits were
test files. Add tests only where they earn their upkeep.

**Write a test for:**
- a bug that really happened (the regression test for its fix)
- security, privacy and who-can-see-what rules (blocking, paused members,
  invites, admin powers, row-level security)
- legal and App Store requirements
- tricky logic: dates and time zones, paging, caches, counting

**Do not write a test for:**
- wording or copy, layout, styling
- "the button is there" with nothing behind it
- what TypeScript already guarantees
- a second case of something an existing test already covers

**Usually one new test per change**, but one for each separate security or
privacy rule the change adds, or more when the owner asks. Prefer extending
an existing test over adding a new one.

**While working**, run only the tests the change touches:
`pnpm test:related <changed files>`. Run the full `pnpm test` once, before a
push. The Check workflow runs it on every push to `main` and every PR.

## Commits (owner, 2026-11-09)

No `Co-Authored-By: Claude` line (or any Claude trailer) in commit
messages, for everyone working here.

## Test site (owner, 2026-11-10)

After every change or addition, put it on https://tests.thesciclub.com
(the `tests` branch, its own Supabase project) and give the link to the
person you are working for. Never push `main` without their word.

`tests` carries other people's unreleased work, so keep it out of yours:

- Your work branch stays based on `origin/main`. **Never merge or rebase
  `tests` into it**: that pulls in everybody's unreleased commits, and
  pushing to `main` then means untangling them.
- To put a commit on `tests`: `git fetch origin`, make a scratch checkout
  with `git worktree add --detach <dir> origin/tests`, copy `.env.local`
  into it, `git cherry-pick <your commit>`, run `pnpm test:related` on the
  files it touches, then `git push origin HEAD:tests` and remove the
  worktree. Never force-push `tests`.
- To release: `git fetch origin`, rebase your branch onto `origin/main` if
  it moved, run `pnpm check`, then `git push origin HEAD:main`.
- Run `pnpm check` alone before any push, and stop if it fails.
- Database changes go to the test project first, the live one only at the
  word of the person you are working for.

## One release a day (owner, 2026-11-21)

Every push to `main` makes every installed app download a new copy and
reload, and several in a day felt slow and unstable. So:

- Push `main` at most once a day. Until then, changes wait on `tests`. Push
  sooner only when the person you are working for says so for that change
  (a live bug, say).
- Near the end of their day (they say they are done, or it is past 5 PM
  Pacific and a task has finished), remind them once to release, and list
  what is waiting: `git log --oneline origin/main..origin/tests` on both
  `tests` branches, with who wrote each, so everybody's work goes out
  together and nobody is surprised by it.
- Releases are tagged `release-<build minute>` (.github/workflows/site.yml).
  Admin › Page speed shows each release's times, and
  .github/workflows/release-speed.yml compares the day's releases each night.

## The change log (owner, 2026-11-25)

Admin › Change log (admin.thesciclub.com) shows what is waiting on `tests`,
every release and what it brought, the changes by part of the club, and each
week in seven lines. Most of it is read from git; what git cannot say is in
`admin/changes/` (its README has the formats):

- Every change members or administrators would notice gets an entry, in the
  same commit: `admin/changes/entries/<date>-<a-few-words>.md`, with a
  title, the part of the club, whether it is new, improved or a fix, and two
  lines in plain words on what changed and how it was before. Not for
  housekeeping (a renumbered migration, formatting, notes): that is listed
  by its commit's first line.
- The entry ends with the prompts that led to the change, under
  `## Prompts`: what the person you are working for typed, as typed and in
  order, each a quote. The change log shows them under the change. **They
  are public too**: first take out names (of anybody but the people who
  build the club, and of organizations that take part in it), contact
  details, codes, anything pasted or said by somebody else, and personal
  details, each with a short note in square brackets in its place. Leave out
  prompts about something else and the words that only released it.
- When it looks different, add before and after screenshots to
  `admin/changes/shots/` (JPEG, at most 200 KB each). **The repository is
  public**: take them on the test site or a scratch page with made-up
  people, never with a real member's name, face, words or place.
- Before a release, open On tests: a change marked "No entry" gets one
  first.
- The first release of a new week: whoever makes it writes last week's
  summary, `admin/changes/weeks/<that week's Monday>.md`, seven lines at
  most.

## Installed apps must keep updating (owner, 2026-11-21)

The site is on Cloudflare (since 2026-11-20). Installed apps find a new
version through `/sw.js` and `/version.json`, so both must be fetched fresh
every time (`Cache-Control: no-cache` in netlify.toml, carried to Cloudflare
and checked by scripts/cloudflare-site-rules.test.mjs). Cloudflare's
Caching › Configuration › Browser Cache TTL must stay **Respect Existing
Headers**, or it overrides them and apps sit on an old copy. Moving hosts
again: read commit 003ad93a first.

## Screenshot review (owner, 2026-11-12)

Before you show the person you are working for screenshots of a change,
have a subagent running Fable 5.2 (the Agent tool with `model: "fable"`)
look at them. Give it the image paths and what the change was meant to do,
not your own verdict, and ask it for problems: anything cut off,
overlapping or misaligned, wording that is wrong or does not fit, things
that look broken or unfinished, and anything that does not match the
request. Fix what it finds and take the screenshots again, then send them.
Say in one line what the review caught.
