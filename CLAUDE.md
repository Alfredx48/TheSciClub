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
