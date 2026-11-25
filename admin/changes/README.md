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
```

- `title`: a few plain words, as a member would say it.
- `surface`: Home, Peers, Chat, Events, Me, Joining, Notifications, Admin,
  iPhone app, Whole app, Database or Behind the scenes. Left out, it is worked
  out from the files the commit changed.
- `type`: `new`, `improved` or `fix`.
- Then two lines: what changed, and how it was before.
- Screenshots only when something looks different: before and after.

A change with no entry is still listed, by its commit's first line, and On
tests marks it "No entry" until it has one.

## shots/

The entries' screenshots: JPEG, at most 200 KB each, named after their entry.
**The repository is public.** Take them on the test site or a scratch page with
made-up people: never a real member's name, face, words or place.

## weeks/

`weeks/<the week's Monday>.md`: that week in seven lines at most, one sentence
each, starting with the part of the club ("Events: …"). Written once the week
(Monday to Sunday, Pacific) is over.
