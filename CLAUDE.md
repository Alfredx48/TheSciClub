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

## Moving the site off Netlify (owner, 2026-11-21)

Read this before you move either site, or any of its files, to another host
(Cloudflare or anything else), or change a domain's DNS.

Netlify did things for us without being asked, and installed apps depend on
them. After tests.thesciclub.com moved to Cloudflare, a Home Screen app sat
on a four-day-old copy and would not update: Cloudflare keeps a file with no
rule of its own for four hours, where Netlify asked again every time.

- **Updates must keep arriving.** `/sw.js` and `/version.json` are served
  with `Cache-Control: no-cache` (netlify.toml, carried to Cloudflare by
  scripts/cloudflare-site.mjs and checked by
  scripts/cloudflare-site-rules.test.mjs). A new host gets the same, and so
  does any other file src/lib/stay-current.ts or src/sw.ts reads to decide
  what is current. Leave those rules in place.
- **Check what else differs.** Compare the new host's response headers and
  status codes with Netlify's for `/`, `/index.html`, `/sw.js`,
  `/version.json` and a file under `/assets/`, and explain every difference
  before moving a domain. (Cloudflare answers `/index.html` with a 307 to
  `/`; Netlify gives a 200.)
- **Test an update across the move.** Before a domain moves, install the app
  from the old host on an iPhone (or the iOS Simulator). Move it, deploy
  something new, then check that Me › Settings › Version shows the new build
  without clearing anything.
- **Live is the owner's call.** Moving thesciclub.com, its DNS or its
  hosting needs the owner's word, given after the steps above. Tell the
  person you are working for what you checked.

## Screenshot review (owner, 2026-11-12)

Before you show the person you are working for screenshots of a change,
have a subagent running Fable 5.2 (the Agent tool with `model: "fable"`)
look at them. Give it the image paths and what the change was meant to do,
not your own verdict, and ask it for problems: anything cut off,
overlapping or misaligned, wording that is wrong or does not fit, things
that look broken or unfinished, and anything that does not match the
request. Fix what it finds and take the screenshots again, then send them.
Say in one line what the review caught.
