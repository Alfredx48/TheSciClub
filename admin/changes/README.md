# The change log

What Admin › Change log (admin.thesciclub.com) shows, beyond what git already
records. The rule is in CLAUDE.md; `admin/changes.mjs` reads these folders.

## entries/

One file for each change members or administrators would notice, added in the
same commit as the change: `entries/<date>-<a-few-words>.md`.

```
---
title: Chat scrolls to the message you just sent
surface: Chat
type: fix
---
Sending a message scrolls the conversation down to it, and it stays at the bottom when the keyboard opens.
Before, your own message was announced by New messages ↓ and you had to tap it.

![Before](shots/2026-11-25-chat-scroll-before.jpg)
![After](shots/2026-11-25-chat-scroll-after.jpg)

## Prompts

> When I chat with someone, every time I type a message I have to scroll to the bottom.
> There is a little down arrow saying new message.

> Just auto scroll as you type in messages.
```

- `title`: a few plain words, as a member would say it.
- `surface`: Home, Peers, Chat, Events, Me, Joining, Notifications, Admin,
  iPhone app, Behind the scenes or Other. Left out, it is worked out from the
  files the commit changed.
- `type`: `new`, `improved` or `fix`.
- Then two lines: what changed, and how it was before.
- Screenshots only when something looks different: before and after.
- Last, under `## Prompts`: what the person typed that led to the change, as
  they typed it and in order, each prompt a quote (`>` before every line, a
  blank line between two prompts). The change log shows them under the
  change, behind "3 prompts". Include the answers that chose or approved
  ("Yes, fix it", "option 1"); leave out what was about something else and
  the words that only released it ("Push it").

**The repository is public, and so are the prompts.** Before you write one
down, take out, with a short note in square brackets in its place
(`[a member]`, `[an organization]`, `[pasted text, not kept]`):

- the name of anybody but the people who build the club, and of any
  organization, team or event that takes part in it
- email addresses, phone numbers, places, codes, links that let somebody in
- what somebody else said or wrote, and anything pasted
- health, family, money or other personal details, the typist's included

Nothing else is tidied: the typos stay.

A change with no entry is still listed, by its commit's first line, and On
tests marks it "No entry" until it has one.

## shots/

The entries' screenshots: JPEG, at most 200 KB each, named after their entry.
**The repository is public.** Take them on the test site or a scratch page with
made-up people: never a real member's name, face, words or place.

## prompts/

The prompts of the changes made before entries carried them: pulled on
2026-11-25 from the sessions that made those changes, checked one by one
against the rule above, and kept by the change's key (the first twelve hex
digits of the SHA-1 of its commit's first line, as `admin/changes.mjs` makes
it):

```
{ "<key>": { "change": "the commit's first line", "prompts": ["…", "…"] } }
```

Not added to: a new change's prompts go in its entry. Fix one here if it
says something it should not.

## weeks/

`weeks/<the week's Monday>.md`: that week in seven lines at most, one sentence
each, starting with the part of the club ("Events: …"). Written once the week
(Monday to Sunday, Pacific) is over.

## Ready for main

On tests has a tick beside each waiting change, "Ready for main": an
administrator ticks it in the admin site once the change has been tried on the
test site. The ticks are in the club's database (`change_log_ready`,
20261125140000), not here, under the change's key, so every administrator sees
the same ones and a tick follows its change until it is on main.
