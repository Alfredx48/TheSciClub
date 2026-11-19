# Handoff

Last updated 2026-10-28. What is true now, the rules, the traps; nothing else.
Why: `git log`, migration headers, code comments. `CONTEXT.md` is the product
definition and wins over this file. Older handoffs, by `git show
<sha>:HANDOFF.md`: `b04b003` (releases to 2026-10-11), `4b1673b` (what comments
citing a HANDOFF section mean), `932a809` (product decisions). Comments citing
`EMAIL-SIGN-IN-PLAN.md` or `LAUNCH-CHECK.md`: `git show 0c84cf3:<file>`.

## State

- **The SCI Club**: private, invite-only PWA for people with spinal cord
  injury. Vite 8, React 19, TypeScript strict, Tailwind 4, Supabase, Vitest,
  pnpm, Node 24. Live at https://thesciclub.com (Netlify builds `main`; www
  redirects; thesciclub.netlify.app forwards from the page, index.html says
  why). iPhone app: TestFlight 1.1.6 (2026-10-29; tag `ios-v*`, see Release
  to TestFlight).
- **Git**: work on `scaffold-and-peers-deck`. anatol-AbleBodied pushes to it
  and to `main` too: fetch and merge before pushing, never force. Release:
  `git push origin scaffold-and-peers-deck && git push origin HEAD:main`;
  empty `git log --oneline origin/main..HEAD` means nothing is unreleased. The
  agent pushes when the owner asks. Since 2026-10-22
  `origin` pushes to Able-Bodied/thesciclub and the owner's private
  Alfredx48/TheSciClub (remote `mine`) at once, fetching from Able-Bodied
  only: pull before pushing, or the two diverge.
- **Database**: hosted project `erijdvqnxavwezsbbojv`; every migration through
  `20261029260000` is live (2026-10-29). A migration whose app code calls a
  new function goes first: `db push`, then the code. Address lookups run in
  the Geocode workflow, started through vault `geocode_github_repo` and
  `geocode_github_token` (a fine-grained token, Actions write on
  Alfredx48/TheSciClub only, renew by ~2027-10-26). Edge functions:
  `push-notify` (deployed 2026-10-29, with mentions and introductions),
  `link-preview`, `send-invite`, `sign-in-reminder`, `home-screen-handoff`,
  `calendar-inbound`, `apple-token`, `apple-revoke` and `apple-notifications`
  (all deployed; Apple revocation set up live 2026-10-22).
- **Sign-in**: email + password, Google, Apple; passkeys built but off
  (`VITE_PASSKEYS`). No phone sign-in; the Phone provider is off.
  - **Invites**: the hook `signup_needs_an_invite` refuses an uninvited
    sign-up before any email (the owner's choice, knowing it reveals whether
    an address is invited). Admin → Invites → "Anybody can join" opens joining
    for events (`club_joining`); a blocked address stays out. A club
    administrator's QR code with no organization is credit only, never entry.
    An org admin's code or link for their organization lets in whoever scans
    it, invite or not, until it expires (a day by default) or is turned off
    (`20261028960000`). The owner, 2026-10-28: kept on purpose to help the club
    grow; if strangers get in, remove them and make codes credit only again.
  - **Email**: links in mail open `thesciclub.com/auth/confirm.html`
    (`lib/email-link.ts`, `supabase/templates/`), not supabase.co, which put
    mail in spam. Hosted templates go through the Management API, only after
    the client that has the page. Resend's free plan sends 100 a day;
    Supabase caps 100 an hour. SPF and Apple's registration of the domain and
    senders let Hide My Email deliver.
  - **Joined on a computer, link opened on a phone**: the computer retries the
    typed password every 15 s for 15 minutes (`onboarding/confirm-elsewhere.ts`).
  - **Passwords**: a reset link works once, for an hour; saving one signs out
    other devices and emails the member. No way in at all:
    `scripts/set-member-email.mjs`, then Forgot password.
  - **Apple**: Services ID `com.thesciclub.web`; the secret expires
    **2027-04-09** (`scripts/apple-secret.mjs` makes the next; every date
    the club renews is on Admin → Keys & renewals). The store
    app signs in natively as `com.thesciclub.app`. Each Apple sign-in hands
    a refresh token to `apple-token` (native: the authorization code; web:
    the `provider_refresh_token` after the redirect), kept in
    `private.apple_tokens`; deleting the identity, with the account or by
    Unlink, queues it for `apple-revoke` (5.1.1(v); `20261022160000`), which
    only the database may call (vault `apple_revoke_secret`, as
    `push_notify_secret`). Revocations given up after seven tries show on
    Admin → Keys & renewals; once the cause is fixed, `update
    private.apple_revocations set attempts = 0 where attempts >= 7;`.
    Apple's notices go to `apple-notifications`, shown on Admin → Keys &
    renewals (`20261022170000`). Before this, web Apple sign-ins kept no token: those
    members are revoked only if they sign in with Apple again first.
  - **Google**: its own widget (`lib/google-identity.ts`); the OAuth client
    allows only `https://thesciclub.com`, so not locally. The iPhone Home
    Screen app signs in through Chrome or Safari on `/app-sign-in`
    (`lib/google-in-browser.ts`, `home-screen-handoff`). The store app uses
    Google Sign-In with its iOS client (`VITE_GOOGLE_IOS_CLIENT_ID`), with a
    nonce, so Supabase's "Skip nonce checks" stays off.
  - **Home Screen app**: a signed-in iPhone tab hands the app a single-use
    code by cookie (`lib/home-screen-handoff.ts`).
- **Store app** (Capacitor 8, `com.thesciclub.app`, iPhone only; Android
  second): the web build bundled, never loaded from the site.
  `pnpm native:sync` builds `dist-native` (`vite build --mode native`: no
  service worker, its own CSP `<meta>` from `native-csp.ts`) and copies it
  into `ios/` and `android/`; `pnpm native:assets` remakes icons and splash
  from `assets/`. iOS uses Swift Package Manager; no Mac here, so
  `.github/workflows/ios-build-check.yml` builds it unsigned for the
  Simulator, in Alfredx48/TheSciClub only (`ios-release.yml` signs and uploads:
  see Release to TestFlight). `isNative()`
  (`lib/standalone.ts`) keeps out of the app everything browser-only:
  worker and reload, web push, install nudge and steps, the Home Screen
  hand-off, passkeys. Notifications on an iPhone come through APNs instead
  (`lib/push/app-push.ts`; Open, Native push). Location on an iPhone goes
  through `@capacitor/geolocation` (`lib/device-location.ts`), as WKWebView's
  own asked twice; Android keeps the web view's, coarse only. Apple and
  Google sign in natively (`lib/native-sign-in.ts`,
  `@capgo/capacitor-social-login` with Facebook's
  SDK left out: `scripts/check-native-build.mjs`), iPhone only. Links made
  for others use `siteOrigin()`; the rest of the shell (splash, status bar,
  back, outside links, links that open the app, iPhone Text Size) is
  `lib/native-shell.ts`. Universal Links: `public/.well-known/
  apple-app-site-association` (`src/universal-links.test.ts` says which
  paths and why). Fake it in a browser with
  `window.CapacitorCustomPlatform = { name: 'ios' }`.
  YouTube cards in the app frame the club's player page
  (`public/embed/youtube.html`, its own headers in `netlify.toml`), since
  YouTube refused capacitor://localhost on 1.0.1; an "Open in YouTube" link
  sits under it. Needs the page live on `main` before the next TestFlight.
- **Checks**: 4,891 tests in 378 files on 2026-11-08; `pnpm check` (alone),
  `pnpm test` and `pnpm build` gate every push. While working,
  `pnpm test:related <files>`; which tests to add: `CLAUDE.md`.

## Open

- **For the owner: Adaptive Rec Hub organizations held back**: 251 the club
  did not add (`20261103010000`) because their own page did not say they
  serve people with SCI/D or wheelchair users. Many, like NSCD and Challenge
  Aspen, likely do. The owner ticks those to add on the review page,
  https://claude.ai/artifact/CVNPu4CZh6BV9xfTNDBjwy (private to the owner;
  Copy my choices gives the list to paste).
- **Team River Runner is out** (`20261103060000`, the owner 2026-11-03): it is
  for veterans only. Removed as an administrator would; don't add it back.
  Its places' contact notes (`20261103030000`) stay in the table for any
  organization to use.
- **Reactions notify, and the icon counts kinds**: a reaction to a message
  or post notifies its author like a like (`reaction`, switch "Reactions to
  my posts and messages" on Me; never self, never between a blocked pair
  either way). The icon's number is the kinds among what the bell has not
  shown (Messages, Replies, Likes, Reactions, Events, Grants, Reminders,
  Invites, Reports; a kind switched off is not counted). `20261028000000` and
  `20261028010000` are live. The owner, 2026-10-28, "clear only 1 of 2"
  (`20261028900000`, live): opening one conversation or topic, one row
  in the bell, or one pressed push clears that thing only; the bell's list
  clears all. A push's address carries its tag as `?n=`
  (`compose.ts` `withTag`), which `OpenedNotification` hands to
  `notifications_mark_read_by_tag`. Swiping a notification away clears
  nothing: iOS reports it only for a registered category with
  customDismissAction, which `@capacitor/push-notifications` cannot register,
  and the web's `notificationclose` has no session to call with. Probes:
  `reaction-notifications.sql`, `icon-badge-kinds.sql`,
  `a-notification-clears-where-it-is-opened.sql`.
- **Location ZIP codes and address suggestions (live)**: each organization location has an optional ZIP (`postal_code`,
  five digits or ZIP+4; never in `geocode_key`, so no pin goes stale). The
  Street address box suggests addresses from Komoot's Photon as an
  administrator or organization account types (`lib/address-suggestions.ts`,
  `admin/address-field.tsx`; never Nominatim, whose policy forbids
  type-ahead); a pick fills street, city, state and ZIP, never the label.
  Privacy Policy names Photon (wording for the owner to approve). Probe: `organization-place-zip.sql`.
- **App Store: 1.0.5 (build 6) submitted 2026-10-25, waiting for review**,
  manual release. Reviewer signs in as `review@thesciclub.com`; `peer@` and
  `deleteme@` are in the review notes (all Zoho aliases; passwords only in
  App Store Connect and the owner's password manager). Don't use the demo
  accounts during review; after release run `scripts/demo-reviewers.mjs
  --live --reset`, and keep them for every update. A rejection arrives in
  App Store Connect → App Review. Owner-side sheet: `app-store-submission.md`
  (untracked).

- **Keys & renewals, live** (the owner, 2026-10-27): Admin's Sign-in
  tab is renamed (`?tab=sign-in` still opens it) and lists everything the
  club renews, soonest first, with its steps; an administrator saves a new
  date or adds an item (`renewals`, `20261028200000`; the Apple secret's
  date stays in `sign_in_secrets`). Check `sign-in-reminder` was redeployed
  (`functions deploy sign-in-reminder --no-verify-jwt`), which makes the 30-day emails cover
  every dated item (until then Apple's only; never twice). Then enter the
  Apple Developer membership and domain dates, and check the distribution
  certificate's (seeded as about 2027-10-21). Probe: `renewals.sql`.
- **ParaCliffHangers, Wheel With Me, Active Fund, live** (the owner,
  2026-10-27). `20261028300000`: ParaCliffHangers' Indoor page is its own feed
  (`scrapers/paracliffhangers-meetups.js`): each chapter's schedule made into
  dates 92 days ahead in its state's zone, nothing for one it cannot read
  (Durham's "various Saturdays" is logged nightly), and a date the page stops
  giving is deleted (`complete`, `vanishedEvents`); Adaptive Rec Hub skips
  ParaCliffHangers and its three upcoming copies go; nineteen gyms on the map
  by name (paused Brick and Flemington left off). `20261028310000`: an
  organization's city may be empty; Wheel With Me's is. `20261028320000`: the
  Active Fund's next dates are not announced. Saving ParaCliffHangers in Admin copies
  Berkeley (its main place) into the directory's "Bay Area", as for any
  organization with places. Probes: `paracliffhangers-meetups.sql`,
  `wheel-with-me-has-no-place.sql`, `active-fund-dates-not-announced.sql`.

- **Share a post into a chat, live** (the owner, 2026-10-25; website and
  1.0.4+ on 2026-10-26, with editing in the composer): Share
  beside React and Reply on every post and Home card sends it to a
  conversation or a member, with an optional line. The message holds only
  `shared_post_id`; `chat_shared_posts` draws the card with the reader's
  own rights, else "This post isn't available" (closed room, removed,
  deleted, a block either way). Probe: `shared-posts.sql`. Kept by the owner (2026-10-25): a
  blocked member sees "isn't available" on a post by the member who blocked
  them, and the Share refusal says the same, so they can infer the block, as
  "You can't message this member" already lets them.
- **Events from calendar invitations** (live 2026-10-23): invite
  `invites@events.thesciclub.com` (or `invites+<short code>@`) to an event in
  Google, Outlook or Apple Calendar and it is added, changed and cancelled in
  the club (`20261022220000`, `/events/invites`, the `calendar-inbound`
  function). The club does not own thesciclub.org.
  - **Route**: `events.thesciclub.com`'s MX is Resend, so `invites@` reaches
    Resend directly, never Zoho's spam folder (the owner, 2026-10-23). The
    older `events@thesciclub.com` still works as a backup: a Zoho alias whose
    filter forwards it to `inbox@events.thesciclub.com`, but Zoho filters skip
    spam, so it can stall there. Resend posts `email.received` to the function
    (webhook set; deployed `--no-verify-jwt`). Whom it was meant for comes from
    the headers; anything not for `invites@`/`events@` gets 200 and nothing else.
  - **Trust**: original From + Resend's DMARC pass: added. A representative's
    invitation otherwise is held (DMARC fail/none, or a From rewritten by
    Zoho, whose original is never verified). A From at thesciclub.com (any
    subdomain) or Zoho is never a sender. Anybody else: ignored, no reply.
    The invitation's other guests are never kept.
  - **Place and link**: meeting links go to the link, the place keeps the
    address, a US address gives city and state (`place.ts`, `20261023000000`).
  - **Changes**: an update replaces the event, so a new id and no RSVPs. The
    reply names the link the club holds; no reply means it never arrived.
    Google asks whom to tell, so an update can skip `invites@`. Probe:
    `calendar-invite-updates.sql`.
  - **A change is just applied** (the owner, 2026-11-17, `20261117120000`):
    one to an event already on the calendar keeps that event's host and is
    never held for an organization again; only an unverified one waits.
    Google's "this and following events" sends the old invitation, ending the
    day before, and a new one whose UID is the old one's with `_R<date>`: the
    new one carries the same series on from that day (same ids, RSVPs, who
    can see it), and the old one keeps only the dates before
    (`calendar_invites.continues`). The function makes the ending one wait
    four seconds so the other is taken first. Probe:
    `calendar-invite-following.sql`, run on the test project in a rolled-back
    transaction (no local stack on the owner's Mac).
  - **Guests and notes** (the owner, 2026-11-17, `20261117130000`): guests
    who said yes or maybe and are active members are RSVPd (Going,
    Interested) on the event and each coming date; only member ids are kept
    (`payload.guestMembers`), every other address is dropped before anything
    is stored. A member's own answer is never changed, and a later "no" in
    the calendar takes nothing back. Attached files (Google's meeting notes)
    are links in `events.attachments`, read by signed-in members only, under
    "Notes and files" on the event's page. Probe: `calendar-invite-guests.sql`.
    Not yet seen on a real invitation: whether Google's emailed file carries
    the attachment and each guest's answer.
  - **Asking, and the emails** (the owner, 2026-11-17, `20261117150000`): a
    guest who is a member and has not answered gets one message from the
    invitation's sender in their own conversation (name, when, link), once
    for each invitation however it changes (`calendar_invite_asks`); not
    somebody who cannot see the event, has answered in the club, or cannot
    be messaged (`chat_open_direct` decides). Each email that added,
    changed, held, cancelled or refused an invitation is one line in
    `calendar_invite_emails` (a trigger on `calendar_invites`), shown under
    "Invitation emails" on the event's page to whoever may change it
    (`event_invitation_emails`). Emails before it left only the last one.
    Probe: `calendar-invite-asks-and-emails.sql`.
    Can't go (`event_declines`) counts as an answer in the club too
    (`20261117170000`): no chat invite, and a guest who accepted in their
    calendar is not made Going again to a date they said Can't go to.
  - `invites@` tested end to end 2026-10-24 (function deployed). The
    website still shows `events@` until the branch reaches `main`.

- **Ask anonymously, put off** (the owner, 2026-10-22: later, after smaller
  changes). A post's `author_id` is readable by every member (table-level
  select on `chat_topics`/`chat_posts`, embeds by
  `chat_*_author_id_fkey`, `chat_topics_for.author_id`/`participant_ids`,
  realtime, `notifications.actor_id`, `my_notifications`, `push_owed`), so
  hiding it on screen is not enough. The plan when it is picked up: an
  `anonymous` flag; revoke select on `author_id` and expose a masked
  `shown_author_id` (null when anonymous) with its own foreign key for
  embeds; a way for the author to know a post is theirs; notifications and
  push say "A member"; administrators read the real author through an
  admin-only function. Earlier choices: administrators see who; questions
  and replies.

- **Every event public by default** (the owner, 2026-10-22): `20261022200000`
  sets the default to `public` and makes the club's existing events public
  (all imported from public calendars), not live until the owner's push.
  A signed-out visitor on `/events/<id>` is sent to `/e/<id>` when the event
  is public (`RequireMember`), so an address copied from the bar works too.
- **Public events and audiences** (2026-10-22, the owner): `20261022180000`
  and `20261022190000` are live, and the client with them (released to
  `main` on its own, ahead of this branch's unreleased work). Not filtered
  yet: the daily "N new events" count for followers includes a groups-only
  event (a number, never a title); a member with an event cover's path can
  read it. The PGlite script in the session that built it covered 31 cases;
  worth a `supabase/tests/event-audiences.sql`.
- **A registration is not an invite, live** (the owner, 2026-10-22: "a
  security hole"). `20261022190000` let any address registered for a public
  event sign up and join; `20261022230000` (live 2026-10-23) puts
  `i_am_invited` and the sign-up hook back (probe
  `a-registration-is-not-an-invite.sql`). Nobody joined that way.

- **Legal pages, live 2026-10-26** (`release-legal` → `main`, owner approved
  the wording 2026-10-25): Terms, Privacy and `/delete-account` name Alfred
  Shaheen as operator and `hello@thesciclub.com` as contact, and cover the
  iPhone app, Apple and Google sign-in, push, public event guest lists and
  calendar invitations. Kept as written: no postal address, guest-list
  labels, guest-list sign-ups kept to 90 days after the event, calendar
  invitations kept. The same release put the Universal Links file live, the
  sign-up agreement line on the join and sign-in forms, and took the
  consultation call off the closed door. Still to do: paste
  `https://thesciclub.com/delete-account` into Play's Data safety form; a
  lawyer should read the pages (injury details are health information).

- **Native sign-in and Universal Links, not live** (2026-10-22), in order:
  1. Google: an iOS OAuth client (bundle `com.thesciclub.app`, Team
     `3RZ3A2CJ9N`) in the web client's project; `gh variable set
     VITE_GOOGLE_IOS_CLIENT_ID -R Alfredx48/TheSciClub --body '<its ID>'`.
  2. Supabase → Authentication → Providers → Google → Client IDs: the web
     client's ID, then a comma and the iOS one.
  3. Precondition: Supabase's Apple provider Client IDs must include
     `com.thesciclub.app` (it lists `com.thesciclub.web,com.thesciclub.app`,
     seen 2026-10-22). Without it every native Apple tap fails.
  4. Apple Developer: `com.thesciclub.app` grouped with the Services ID's
     primary App ID (Sign In with Apple on both).
  5. Supabase secrets, from the Sign in with Apple .p8: `pnpm exec supabase
     secrets set APPLE_TEAM_ID=3RZ3A2CJ9N APPLE_SIWA_KEY_ID=<key ID>
     APPLE_SIWA_KEY_P8="$(cat AuthKey_<key ID>.p8)"`.
  6. Vault, in the SQL editor (`20261022160000` makes the secret too if
     this has not; `apple-revoke` never holds it, the database checks it):
     ```sql
     do $$
     begin
       if not exists (select 1 from vault.secrets where name = 'apple_revoke_secret') then
         perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
           'apple_revoke_secret', 'Sent by apple_revoke_send, checked by apple_revocations_due.');
       end if;
       if not exists (select 1 from vault.secrets where name = 'apple_revoke_url') then
         perform vault.create_secret(
           'https://erijdvqnxavwezsbbojv.supabase.co/functions/v1/apple-revoke', 'apple_revoke_url');
       end if;
     end $$;
     select name from vault.secrets where name like 'apple_revoke_%' order by name;
     ```
     Expect `apple_revoke_secret`, `apple_revoke_url`.
  7. `pnpm exec supabase db push --linked --dry-run` lists exactly
     `20261022160000` and `20261022170000` (the four before them are live);
     then the push.
  8. `pnpm exec supabase functions deploy apple-token`, then
     `apple-revoke --no-verify-jwt` and `apple-notifications
     --no-verify-jwt`. A bare `curl -X POST …/functions/v1/apple-revoke`
     must answer 401 `not the database`.
  9. Apple Developer → the primary App ID → Sign In with Apple →
     Server-to-Server Notification Endpoint:
     `https://erijdvqnxavwezsbbojv.supabase.co/functions/v1/apple-notifications`.
  10. `git push origin scaffold-and-peers-deck`; `git tag -a ios-v1.0.1 -m
      "What to test"` and `git push origin ios-v1.0.1`. `main` only once
      `hello@thesciclub.com` receives mail (Legal pages, above); then
      `curl -sI https://thesciclub.com/.well-known/apple-app-site-association`
      is 200 JSON with no redirect, and links open the app.

  Probes: `apple-revocation.sql`, `apple-notices-and-joining.sql`. On the
  first device and live runs, look for: **Google in the app**: an
  "Invalid access_token" or `at_hash` error means stop passing
  `accessToken` in `signInWithGoogleNatively` and `linkGoogleNatively`.
  **Web Apple**: after `?apple=signin` the URL fragment has
  `provider_refresh_token` and `apple-token` answers 200; if not, web Apple
  sign-ins keep no token. **apple-token's log**: `WARNING the
  no-ID-token fallback` means Apple's refresh answer had no ID token (the
  line names its fields); a web keep without it means Apple sends one, so
  delete the fallback (`onlySub` in `apple-token/handler.ts`) and its test.
- **Native push in the iPhone app, live in TestFlight 1.0.3** (owner tested
  on a device, 2026-10-24). The device token
  is a `push_subscriptions` row, `apns:<production|sandbox>:<hex>`
  (`push_subscribe_app`, `20261023030000`), so blocks, mutes, switches,
  `push_forget` and deletion cover it; `push-notify` sends it to Apple
  (`apns.ts`; 410 or BadDeviceToken forgets it). Asked as the Home Screen app
  asks, never on the app's first launch; Me has the row, and Open Settings
  after a refusal; a tap routes like a link that opened the app. How it was
  set up (done for 1.0.3; redo only for a new key or project):
  1. `pnpm exec supabase db push --linked --dry-run` lists `20261023030000`
     (with whatever else is unreleased); then the push.
  2. Secrets, from the APNs .p8 on the owner's own machine (it goes straight
     from the file into the command):
     `pnpm exec supabase secrets set APNS_KEY_ID=W8K8K2VX3C
     APNS_TEAM_ID=3RZ3A2CJ9N APNS_BUNDLE_ID=com.thesciclub.app
     APNS_KEY_P8="$(base64 < AuthKey_W8K8K2VX3C.p8 | tr -d '\n')"`. With
     no file, only the password manager's base64: `read -rs APNS_KEY_P8`,
     paste, Enter, then `APNS_KEY_P8="$APNS_KEY_P8"` in the same command.
  3. `pnpm exec supabase functions deploy push-notify --no-verify-jwt`.
  4. Nothing in the Apple portal while Push Notifications stays on for
     `com.thesciclub.app`: `release_build` makes a new App Store profile when
     the old one lacks `aps-environment`. If the run says the App ID does not
     have it, turn Push Notifications on there and run again.
  First device: turn on in Me → Settings, have another account message you,
  read the lock screen, tap it cold and warm. push-notify's log: `Apple said
  403 InvalidProviderToken` is a wrong key, key ID or team; every token
  `BadDeviceToken` is the wrong environment; `skipped` is missing secrets.
  Known and accepted: anybody once signed in on a phone can read its token and
  take it over, as with web push; APNs payloads are readable by Apple, unlike
  web push's (a sentence in Privacy, for the owner to word).
  **Icon badge, built, not yet on a device**: every push carries
  `aps.badge` (0 clears it), as web push does; while open the app sets it
  itself (`lib/icon-badge.ts`, `@capawesome/capacitor-badge` 8.0.4, only once
  notifications are allowed), and signing out clears it. The number is how
  many kinds the bell has not shown (see Open, Reactions and the icon).
- **Store app, still to build**: Android (Google needs a client
  made with the Play signing SHA-1, Apple there is a web flow, and App
  Links need `public/.well-known/assetlinks.json` with the Play signing
  SHA-256; push needs a Firebase project, its `google-services.json`, an
  `fcm:<token>` endpoint and an FCM sender in `push-notify`'s `deliver`, and
  `isAppPush()` widened; `android/` is not synced with the push plugin yet);
  the demo reviewers run live (`scripts/demo-reviewers.mjs
  --live`). Never run on a device: Text Size, the CSP under WebKit,
  Nominatim with the app's User-Agent, native sign-in, Universal Links.
- **Home Screen pairing, to retire** once members have the store app (owner's
  call, not before): `/app-sign-in`, `lib/google-in-browser.ts`,
  `lib/home-screen-handoff.ts`, the `home-screen-handoff` function and
  `pair_home_screen_app`; that closes F6 to F9.

- **Removed before `20261020010000`** (Remove now deletes the sign-in
  account too; probe `removed-member-can-rejoin.sql`): those accounts are
  still there with no member. Whoever is invited again can sign in with their
  old password, or Forgot password, and finish joining; or delete the account
  in Supabase → Users first.

- **Security scan of 2026-10-17**: fixes live; each commit names its probe.
  Left open on purpose: the Home Screen pairing hand-off (F6 to F9), until
  members have the store app (Open, Home Screen pairing).
- **Codex review of 2026-10-27**: the Peers directory now reads every page
  (`members-pagination.test.ts`); the Check workflow runs `pnpm check` and
  `pnpm test` on pushes to `main` and pull requests, and only reports (the
  owner: no gate on Netlify; check locally before pushing). Still open:
  - **A conversation reloads its whole history** on every realtime change
    (`useThreadMessages`, `threads.ts`; no debounce in `useRealtimeRows`).
    Load the recent messages, older ones on demand. Not felt at today's sizes.
  - **Most probes need a person**: 83 of 94 in `supabase/tests` print expect
    lines; make the outcomes `raise exception` asserts so CI can run them
    (also needs a local Supabase in CI).
  - **Link-preview DNS rebinding** (`resolvesPublicly`, `extract.ts`): Supabase
    ticket filed 2026-10-27 asking whether Edge Functions can reach private
    addresses. Blocked: note it there and close. Not: the owner picks accepting
    it (members only; only a title and picture come back) or an outbound
    proxy. Never probe internal addresses from a function to find out.
- **`SPEED-PLAN.md`: Steps 1 to 7 live** (2026-10-29). Step 1 `19a6ed6`
  (badges recount at most once per 1.5 s, app only); Steps 2 to 6
  `20261029140000` to `20261029180000`, released in two rounds (2 to 5, then
  6) with clean Postgres logs between; Step 7 `20261029230000` (Admin's
  roster searched and paged by `admin_member_search`). Undo SQL for 2 to 6 in
  `supabase/undo/<version>.sql`. Steps 8 (retest, then the Supabase plan) and
  9 at the owner's word. Load-test copy and fixes: `~/projects/sciclub-loadtest/`.
- **Posts and topics** (the owner, 2026-10-29; `20261029240000` to
  `20261029260000`, live): until somebody else replies, the author edits a
  post freely and may remove it; after, only adds words or photographs after
  what is there (the trigger `chat_posts_keep_answered_words`, which also
  stops the author's removal; administrators still remove anything). The
  author's own replies do not count. A topic posted with only its title is
  edited as its title (`chat_edit_topic_title`). The starter deletes their
  own topic while nobody else has posted (`chat_delete_my_topic`, offered as
  Delete topic in the opening post's •••); administrators delete any topic.
  Anybody who can read a post sees its earlier versions; a conversation's
  stay administrators'. The opening post is drawn under the title as the
  topic's own (unnumbered; answers count from 1), and views and Share show
  once, on its row.
- **Legal wording of 2026-10-29 for the owner to approve**: Privacy Policy
  and Terms on trusted partners and on editing and removing posts (shown to
  the owner in the session; not yet answered).
- **Signing in on Stats**: the `oauth` amr was never seen (no Google
  locally). Check the first real Google and Apple sign-ins say google and
  apple. Probe: `supabase/tests/admin-sign-in-methods.sql`.
- **Text-message sign-in, once Twilio is ready** (the owner, 2026-10-13; not
  before): "Text me a code" first on Sign in and Join, the rest staying;
  joining by phone carries the invite token in `signInWithOtp`'s data.
  **Waiting on Twilio** (Varun, Onboarding and Compliance Support) to confirm
  Verify's pooled sender (then withdraw the refused A2P campaign; its opt-in
  proof is `c550eff^:public/sms-opt-in/`) or the campaign with a public
  opt-in page and SMS terms back in Privacy and Terms (the old section:
  `d4f26ef:src/routes/legal/privacy.tsx`). Build to their answer.
- **Speed work of 2026-10-22, live** (client only). If not done yet, make the
  small copies for photographs already stored, with
  `pnpm dev` running (it uses the app's own code), dry run first:
  `SUPABASE_URL=https://erijdvqnxavwezsbbojv.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=<sb_secret_…> pnpm reprocess-photos --thumbs
  --dry-run`, then without `--dry-run`. Adds files only; safe to run again.
  Until then faces fall back to the whole photograph, as before.
- **Supabase free plan**: pauses after a quiet week, **no backups**. Move to
  the paid tier and test a restore.
- **Passkeys**: on (seen 2026-10-27: Supabase on, RP ID `thesciclub.com`,
  origin `https://thesciclub.com`, display name `The SCI Club`; the live build
  has `VITE_PASSKEYS`); website only (the store app's page is not
  thesciclub.com). Welcome back offers a saved passkey in the email box's
  suggestions (conditional mediation, the owner's choice 2026-10-27); the
  button shows only where a browser can't, and only if a passkey was added or
  used in that browser (`club:passkey-here`; a site cannot ask). After an
  email-and-password sign-in, an account with no passkey gets one suggested:
  the browser saves one quietly where it can (conditional create), else "Sign
  in faster next time?"; Not now holds 30 days (`club:passkey-offer-snoozed`). A Netlify preview can't test them:
  an origin must be the relying party's domain. Never change the RP ID: every
  passkey dies. Off: remove the Netlify variable and deploy.
- **Owner's calls, pending**: thesciclub.org (Netlify alias, `@` and `www` A records to
  `75.2.60.5` at Spaceship).
- **Tried by the owner 2026-10-27**: a notification tapped from the lock
  screen opens it; joining on a computer and confirming on a phone.
- **Never tried for real**: an hour of VoiceOver; the date boxes with Voice
  Control and autofill; signed photos on a phone; pinch zoom in the
  installed app and the photo viewer; Hide My Email through an invite link;
  Google from the Home
  Screen app on an iPhone (`googlechromes://`, `x-safari-https://`,
  `OPEN_WAIT_MS` 800); the first nightly import after an administrator
  changed an imported event; repeating events on a Supabase stack.
- **Small, not asked for**: "Rather not say" toggles on Your details are under
  44px with no `data-target`; onboarding's photo step asks for no description.
- **Unused in the database**: `my_claimable_profile`, `photo_is_my_claimable`,
  and `before_user_created` (`20260911120000`).

## Built, and where to look

All live. Migration headers and the files named say how and why.

- **Trusted partners** (the owner, 2026-10-29; `20261029100000`,
  `20261029120000`): professionals an administrator makes partners in Admin →
  Members, with a title shown as "Trusted partner · <title>"
  (`components/partner-label.tsx`; the name is `PARTNER_ROLE_NAME` in
  `lib/club-partners.ts`, one place to rename). Unlimited invites; their own
  code with no organization lets people in (`qr_codes.made_as_partner`).
  `/stats` (Stats & controls, `20261031110000`, for org admins, partners and
  administrators, `private.can_connect`; `/partner` redirects): an
  organization's numbers (`my_organization_stats`, only what its page already
  shows; `my_organization_events`, one row an event held, turnout only of
  those who said Going; `my_organization_weeks`, eight weeks), its people
  (`organization_people`, ten then See all) and Notify your people
  (`20261103000000`: `notify_members_of_event`, 12 hours between notices to
  one person, opened = its notification read; "every new event" is
  `organizations.notifies_members_since`, sent by cron five minutes on; needs
  `push-notify` deployed for the push), their numbers,
  Connect two members, My people (never messages or
  contact details beyond addresses they invited) and introductions. Connecting
  (`make_introduction`, also Introduce… in a profile's •••) asks nobody (the
  owner, 2026-10-31): it opens a group at once, the connector too only if they
  ticked the box, starting with an `introduced` notice (their note); the two
  get the ordinary `group_add` notification; a pair is connected once. The
  answer page `/introductions/:id` serves only those asked before that. The
  card page is gone; `my_partner_card` still gives the title.
  Joining offers "Professional", which grants nothing. Probes were run on a
  throwaway stack; none is saved under `supabase/tests`.
- **Admin finds every member** (`20261029230000`): the roster is searched and
  paged by `admin_member_search` (50 at a time, an exact match first) and
  counted by `admin_member_counts`; the org admin picker searches the same way.

- **Blocking**: Block in the ••• of a profile, message, post or reply
  (`BlockMemberSheet`, `peers/block-sheet.tsx`), Me → Settings → Blocked
  members, Admin → Reports → Blocks (`#blocks`), where Monday's count leads;
  the New reports switch covers it. `member_blocks` is readable by
  the blocker only; content hides both ways through `private.my_hidden_member_ids()`
  (not from an administrator; `20261104203000`), the Blocked list reads `my_blocked_member_ids()`,
  Peers both ways in the views; `members_blocked()` is never granted.
  Probes: `member-blocks.sql`, `blocks-weekly.sql`, `blocks-both-ways.sql`.
- **Profile reports**: Report beside Block in a profile's ••• (`report_member`,
  `ReportSheet kind="profile"`), a copy in `chat_reports.profile_snapshot`,
  listed under Admin → Reports as a profile report. The photograph path is
  kept like a chat photograph: no delete or overwrite while named, so each
  upload is a new file name (`savePhoto`). Deleting the account unnames it
  (trigger on `members`) and the folder clearing takes it; `deleteMyAccount`
  clears the folder again after the delete. Probe: `profile-reports.sql`;
  storage steps in `pnpm check-photo-policy`.

- **Joining**: invites are emailed links (`send-invite`) that fill in their
  address (`invite_address_for_token`). A refused sign-up goes straight to the
  closed door, with the inviting organizations' logos and the consultation
  link (`lib/consultation.ts`).
- **Onboarding** picks up where it was left (`progress.ts`,
  `save_onboarding_progress`), never keeping the password, email, ZIP or
  photo; the account's copy goes when the member is made, or after 90 days.
  `onboarding_steps` feeds Stats. Notifications are asked once, by the
  installed app (`AskOnOpening`).
- **Google photo** (2026-10-22): a Google account is offered its
  photo on the photo step and Your details, copied only on a tap. The browser
  fetches it from `lh3.googleusercontent.com` (connect-src; Google allows any
  origin) and uploads it as a chosen file (`lib/google-photo.ts`).
- **Admin → Stats** (`admin_club_stats(period)`): counts, never who, from what
  the club already keeps, in place of Google Analytics (turned down). Two
  things name members, by the owner's choice and said in Privacy: signing in
  (`admin_sign_in_methods`, `sign_ins` from `record_sign_in`, not Supabase's
  audit log, which keeps emails and IPs) and who viewed a post (Chat).
- **Me**: tabs Profile, Settings, Account (`?tab=` replaced). The
  email is read only (an administrator uses the script). Phone is optional,
  for event hosts; Going shares email, and phone if given, with the host
  (Admin → Going, `event_host_contacts`).
- **Install**: a nudge on phone browsers (`lib/install.ts`; Not now hides it 3
  days). `lib/standalone.ts` trusts only `navigator.standalone` on iPhones.
  The installed app is **The Sci Club**; page zoom is stopped only there.
  Share target: Android only (`/share-target`, `sw.ts`, `/share`).
- **Display** (Me → Settings, Me's "Aa" button, and the keyboard's second
  stop on every screen; the owner took the button off the other tabs 2026-10-22):
  appearance, higher contrast, text size, easier-to-read text, underline
  links, bigger tap targets, reduce motion; per device (`lib/accessibility.tsx`).
  Built in place of an overlay widget like accessiBe, on purpose.
- **Privacy at the API**: events, series, tag links and RSVP counts are
  members-only; `chat_authors` keeps its security barrier; organizations stay
  readable for the closed door.
- **Chat**: read receipts from the current roster. Eight reaction emoji, one
  per member per item (`chat_set_reaction`). A view is one per member, from
  opening, seeing on Home (`lib/chat/home-views.ts`), liking or reacting,
  counted from 2026-10-10. For an administrator the count opens who viewed
  (`admin_post_viewers`; Mobile or Desktop from 2026-10-21). Save
  (`chat_saves`, private) lists on Me → Saved. Posts take
  `DescriptionEditor`'s small Markdown; messages are not formatted. A
  member's photo opens their profile (`AvatarLink`, for a pointer only).
- **Link previews**: `link-preview` fetches a card; a refusing page stays a
  plain link. Backfill: `select public.link_preview_backfill();` (it queues);
  one: `link_preview_request('chat_posts', <id>)`.
- **Notifications**: a `notifications` row per member before any push (kept
  30 days). A tap reaches a running or starting app through the worker
  (`NAVIGATE`, `FollowNotification`); in the store app, through
  `pushNotificationActionPerformed` (`lib/native-shell.ts`). Probe:
  `push-app-tokens.sql`.
- **Speed** (2026-10-22): Home, Peers, Chat,
  Events and Me stay mounted once opened (`KeptTabs` in `App.tsx`, React's
  `<Activity>`): hidden, a tab keeps its state and scroll and its effects
  stop; shown again, its reads run
  again behind what is drawn, so hooks keep their data while they re-read
  the same query (`shown` refs). A new member, or none, remounts the shell
  and clears signed URLs and shared reads (`RequireMember`). Photographs
  have a small copy beside them (`<name>.thumb.<ext>`: 400px for members,
  800px for chat), made at upload (`uploadPhoto`, `uploadAttachments`);
  `usePhotoUrl(path, 'thumb')` and `useSmallCopies` draw it, or the
  photograph where there is none. Measured with a scratch Playwright script
  against a throwaway stack behind a 0.3s HTTP/2 proxy (in the commits).
- **Home**: Admin → Rooms has a Home-feed switch per room (`show_in_home`).
  Events on Home are within Events' default 50 miles of home, online ones
  anywhere (`events_within_miles`). Distance is measured from exactly what
  the map may show (`private.visible_event_places`, `20261025020000`): the
  exact pin, else the city middle, else the host organization's confirmed
  main place in the same state. The nightly import reads a city from the
  event's own address when the map misses (`address.js`), and places those
  cities.
- **Map** (2026-10-25, migrations `20261025015000`–`040000`): List | Map on
  Events and Peers (`src/routes/map/`, `src/lib/map/`). Peers are a count at
  a confirmed city middle (`city_places.settlement`), never finer; "Show me
  on the map" in Me. Below zoom 5, one labelled pin a state, moved at most
  18px for room (`foldByState`, `apart`, the `-states` layers); from 5, bubbles
  by distance. The map stops zooming out where the lower 48 fill the frame.
  The list's distance filter does not apply to the map. Events and
  organization places get an exact pin only
  when the geocoded address matches the current one; a save starts the
  Geocode workflow (`.github/workflows/geocode.yml`, `20261026000000`;
  Nominatim refuses Supabase's servers), which places it in a couple of
  minutes under daily caps (`private.geocode_claim`). An organization's
  place is its logo in a purple ring, else its short code on gold
  (`organization-badges.ts`): drawn when MapLibre 6's missing-image resolver
  asks, fetched once, kept across theme changes. Tiles: one archive,
  `usa-<build>` (streets across the US, 9.6 GB; the two-file us/ca builds
  before it come off R2 once no app asks), on Cloudflare R2 behind the
  `tiles-worker/` Worker at sciclub-tiles.thesciclub.workers.dev (owner's
  account; `pnpm tiles-worker:deploy`, `pnpm map-tiles --upload`; a new
  build's files go up before the deploy that names them). Organization
  places data: `~/.cache/thesciclub-map/` on the owner's machine.
- **Events**: administrators and an organization's designated members add,
  change and delete them (Pacific time). A series' dates are rows made 92
  days ahead, extended nightly (`event-series-extend`). Administrators change
  imported events (`admin_override`; the ingest keeps it; Revert restores).
- **Organizations**: Admin → Organizations; organization accounts edit their
  own at `/organizations/manage`. They, administrators and linked
  representatives invite without limit (`my_invite_permissions()`); mentors
  have ten. "Represents" tags and affiliation badges are never self-picked.
- **Members**: `@username` on profiles, cards and chat lists. The seeded
  directory is gone; the owner holds a copy.

## Rules the owner set

- **Push only at the owner's word**, gated on `pnpm check`'s exit status run
  alone (never piped). `sci-club-logo/` and `logos-from-you/` are the owner's
  untracked folders.
- **Live database and functions only at the owner's word**: `pnpm exec
  supabase db push` lists what it will apply and asks first. Migrations go
  live before the client that needs them, or the client falls back (as the
  view functions do). Deploy with `pnpm exec supabase functions
  deploy <name>` (no `--linked`; add `--no-verify-jwt` where config.toml has
  it). **Never `supabase config push`** (placeholder Twilio credentials in
  config.toml).
- **Tell the owner before pushing anything that could break an installed
  iPhone app** (2026-11-05). The store app bundles its own build, so screen
  changes are safe; old builds (1.0.5, 1.2.0) keep using the live database,
  the edge functions, and the site pages the app opens (`/embed/youtube.html`,
  `/auth/confirm.html`, `/reset-password`, `/join`, `/e/…`, `/terms`,
  `/privacy`, `/.well-known/apple-app-site-association`). Removing or renaming
  any of those, or changing what they accept, breaks it; adding is safe. Say
  which build and what breaks, and wait for the owner's word.
- **Commit small, one change each, each passing check alone.** Comments say
  why, briefly. No `Co-Authored-By: Claude` line.
- **The repo is public: no real phone number, and nothing saying who is an
  administrator**, in any file or commit; that lives only in the live
  database.
- **Accessibility over brand.** Text never shrinks to fit.
- **"Member", never "user"**, in anything a member reads.
- **No control for a thing the app does not do**; CONTEXT.md's deferred list
  is not built unasked.
- **Look at what you changed**: `SHOOT_BASE=http://localhost:5183 pnpm shoot
  <route>` (`--text=larger`, `--both`, `--scroll=<px>`) and read the PNG, or a
  scratch Playwright script signing in as `scripts/shoot.mjs` does.
- **Probes** (`supabase/tests/`, each rolled back, header says how to run):
  as a signed-in role, a savepoint per expected refusal, read every log
  against its `expect` lines, count on a fresh stack, sabotage a fix once.
- **Organization facts come from the organization's own site, visible text
  only** (never hidden SEO markup, directories or governing bodies). Every
  organization added or scraped gets at least a city and a two-letter state,
  with the source URL and quoted text. Some location info but an uncertain
  state (a region, a city in several states, an area code): ask the owner.
  None at all: leave it null. Full rules, on the owner's machine:
  `~/.claude/projects/-home-alfred-projects-thesciclub/memory/org-facts-from-their-own-sites.md`.
- **Decided, do not reopen**: no phone sign-in or SMS (2026-10-10, until the
  Twilio item above). Staying Driven Wheelchair Fitness is online
  (`STATED_FORMATS` in `jobs/event-ingest/classify.js`) until NorCal SCI says
  otherwise; any other event with no format, ask. A deleted account's words
  stay as "Deleted member"; the member left in a direct conversation with
  them can delete it. No colour-blind mode: nothing relies on colour alone.
  Netlify's "hosted on Netlify" HTML comment stays.
- **Words in rooms, and times** (2026-11-18): what a member starts in a room
  is a **post** (a **question** is a post asked as one), what is written
  under it is a **reply**. The code and database still say topic
  (`chat_topics`) and post (`chat_posts`); only what people read changed, in
  the app, the notification settings and the lock-screen words
  (`push-notify/compose.ts`). A room's card and page count posts, the questions among them,
  replies and views and say when it was last active
  (`chat_room_stats`, `20261118170000`; `roomCounts` in `room-card.tsx`).
  Every time on content is `chatTime`: just now, minutes, hours, days ago,
  and a date from a week old; a component that shows one calls `useMinute()`
  so it keeps up. Messages inside a conversation keep their clock under the
  day's heading.
- **The way back** (2026-11-18): one thin line at the top of every screen
  below a tab's first, naming the screen the member was on and going there
  (`components/back-line.tsx`, the owner's pick of three drawn options). The
  trail is `lib/back-trail.ts`: it starts again at a tab's first screen, and
  each tab keeps its own when left. A screen's own back link is wrapped in
  `OwnBack` (`BackLink` does it): not drawn under the line, and where back
  goes when nothing is remembered (a notification, a shared link, a
  refresh). A new screen needs no line of its own, only an `h1`, which names
  it on the next screen's line. Rooms and posts keep their breadcrumb.
- **Three fixes from the owner's reports** (2026-11-18): whoever speaks for
  an event's organization is not asked "how did it go?" (they may not review
  it; `20261118200000`), and the review page gives a refused member their own
  reason. A Home card quotes a reply made with Reply on the post itself, not
  only one filed under nothing (`home_topics_ranked`, `20261118210000`, one
  condition changed in the ranking of `20261118190000`; `lib/home/topics.ts`
  for the read without it), and every quoted reply says when it came. Peers'
  Include filter has "SCI peers" in place of "Mentors" and "Non-mentors".
- **Home's filter** (2026-11-18): Show is whose posts (Everything, My posts,
  My replies, From my orgs), Type is the kinds Show used to list, Sort by is
  the order, a menu of seven (Default ranking; most recent replies or posts;
  most views, replies, upvotes or engaged users, `20261118240000`). The
  default is still `home_topics_ranked`; any other choice asks
  `home_topics_shown` (`20261118230000`) which posts and in what order, and
  the card quotes the first reply. From my orgs is posts by members of the
  reader's organizations and the events those hold; My posts and My replies
  are posts alone.

- **Debug mode** (2026-11-18): an administrator's switch in Me's Settings,
  kept in that browser. While on, a pill over every screen opens its request
  times: each request on one time line, and the ones that waited for one
  another (`lib/debug-log.ts`, `components/debug-panel.tsx`). `timedFetch`
  and `cardsShown` in `page-speed.ts` tell it; nothing is sent anywhere.
- **Home is posts alone, read in one request** (2026-11-18, "for now"): no
  event or peer cards, none of their reads, no Events or People under Type
  and no Distance in the filter; members find those in their own tabs. The
  owner means to add them back later: `feed.ts` still mixes the three kinds
  and `HomeFilterSheet` still draws Distance when handed `home`, so restore
  the reads in `routes/home/page.tsx` from the commit before this one, and
  draw the posts without waiting for them. Search reads events, members and
  organizations itself once opened (`HomeSearchReading`). The posts come
  from `home_feed` (`20261118260000`): the order and everything a card is
  drawn from in one answer, read as the member; a database without it gets
  the two requests as before. Votes, views and reactions are still three
  small reads after it, and do not hold up the text.
- **The default order** (`private.chat_topic_rank`, for Home and a room's
  Top; the same for every member): a post's last activity, 4 hours newer for
  each vote on its opening post (net of downvotes, not the author's own, the
  first 12, so at most 48 hours; doubled at the owner's word, 2026-11-18,
  `20261118270000`), and 24 hours newer while an administrator's boost runs.

## Environment

- `.env.local` **points at production** (`pnpm dev`, `pnpm shoot` and Vitest
  read it). The service key is `sb_secret_…`, sent to storage as `apikey`.
  Owner's terminal needs `nvm use 24`.
- **Local dev on the local stack**:
  ```
  VITE_SUPABASE_URL=http://127.0.0.1:54321 \
  VITE_SUPABASE_ANON_KEY=$(pnpm exec supabase status -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)["PUBLISHABLE_KEY"])') \
  ./node_modules/.bin/vite --port 5183 --strictPort
  ```
  Stop by port (`ss -ltnp | grep :5183`), never `pkill -f`.
- **Local stack**: `pnpm exec supabase start -x
  imgproxy,studio,edge-runtime,logflare,vector,supavisor` (keep storage-api,
  realtime and mailpit; include `edge-runtime` to run functions). New
  migration: `migration up --local`, then `notify pgrst, 'reload schema';`.
  After `db reset`: `pnpm demo-member`. Restart the stack after config.toml
  or a template changes. Mail links say port 5173: change it to 5183.
- **Fresh stack** for probes: copy `supabase/` to scratch, new `project_id`,
  ports and inspector port, `start --workdir <dir>`; `stop --workdir <dir>
  --no-backup` after.
- **Seeded local accounts**, password `local-dev-password` (`supabase/seed.sql`
  lists them): `alfred@` (admin), `maya@` (mentor), `sam@`, `invited@`,
  `stranger@`, `newcomer@` (all `@local.test`), and the phone-only Phoebe,
  `/dev-login?phone=14155550199`. Mail is at http://127.0.0.1:54324.
- **Store-review demo accounts**: `scripts/demo-reviewers.mjs` (usage in its
  header; local by default, `--live` asks for the project ref). Names start
  "Demo ", usernames `demo.`; `--reset` after a review, `--remove` to delete.
  Invites come from the member whose address is given in
  `DEMO_INVITER_EMAIL` at run time, never written in a file.
- **psql**: `docker run --rm -i --network host -e PGPASSWORD=postgres
  postgres:17-alpine psql -h 127.0.0.1 -p 54322 -U postgres -d postgres`.
- **Playwright**: chromium with `LD_LIBRARY_PATH` as in `pnpm shoot`; no
  WebKit. Headless has no Push API and denies notifications: override
  `Notification.permission` in an init script.
- **CSP** (`netlify.toml`): `index.html`'s two inline scripts by hash and the
  Supabase host. `src/csp.test.ts` gives the new hash; a new outside host goes
  there too, and reaches the store app's policy by itself (`native-csp.ts`).
- **Release to TestFlight** (`.github/workflows/ios-release.yml`, fastlane in
  `ios/App/fastlane`; Alfredx48/TheSciClub only, secrets in its `app-store`
  environment): a tag may sit on the working branch (TestFlight is private;
  owner, 2026-10-22); a manual run is from main only. Once, `gh variable set
  VITE_SUPABASE_URL -R Alfredx48/TheSciClub` and the same for
  `VITE_SUPABASE_ANON_KEY` and `VITE_GOOGLE_IOS_CLIENT_ID` (public values).
  `release_build` makes a new App Store profile if the old one lacks Sign in
  with Apple or Associated Domains (`App.entitlements`); before
  `release_upload`, a step fails the run if the .app holds Facebook's SDK. Then `git tag -a
  ios-v1.0.0 -m "What to test"` and `git push origin ios-v1.0.0` (or Actions →
  iOS release → Run workflow on main), approve it in Actions, and the build
  shows in TestFlight 10–20 minutes after the upload. The tag gives the
  version; the build number is TestFlight's latest + 1; the tag message (else
  the commit subject) is What to Test. A failed run: read the step that
  failed. No Apple Distribution identity: re-export the .p12 with 3DES/SHA1.
  Profile error: the App ID `com.thesciclub.app` or the key's role.
  Xcode missing: `XCODE_VERSION` in both iOS workflows.
- **Netlify**: `pnpm exec netlify … --filter thesciclub`. Verify a deploy by
  grepping the live bundle for a string only the new code has.
- **Ingest**: `.github/workflows/event-ingest.yml`, daily 04:10 UTC from
  `main`, rewrites every event's format (a fix goes in `jobs/`, not the
  database). It runs in Alfredx48/TheSciClub only, with its own Supabase
  secret key; it's off in Able-Bodied, which holds no secrets (2026-10-22).
  Dry run: `gh workflow run "Event ingest" --repo Alfredx48/TheSciClub -f
  dry_run=true`.
- **Supabase logs** through the Management API: `…/analytics/endpoints/logs`,
  `from logs where source_name = 'auth_logs'`.

## Traps

- **Email code length**: the app takes 6 digits (`CODE_LENGTH`), and so must
  Supabase → Authentication → Email → Email OTP Length. It was 8 on the live
  project until 2026-10-29; `config.toml` does not reach the live project.
- **No test may reach the network.** A screen gaining a hook means its test
  stubs it (`@/lib/photos`, `@/lib/push/notifications` especially).
- **Tests that pass by not testing**: text the screen never draws; a check
  before data loads; mocking the thing under test; a probe run as the
  superuser. Make each new test fail once.
- **Other sessions share the folder**: commit named paths only, never `-a`.
- **APNs environment**: the app labels its token production unless built
  with `VITE_APNS_ENVIRONMENT=sandbox`, which only an Xcode development build
  wants. Never in a release: Apple would refuse every token and the club
  would forget them.
- **Migration numbers**: fetch before numbering one. `db push` silently skips
  a version the live database already has, even from another file.
- **Nothing is granted by itself** (Supabase, from 2026-10-30; locally now,
  `auto_expose_new_tables = false`): a migration that makes a table, view or
  function grants what anon, authenticated and service_role need, by name,
  or the API answers 42501. `20261020000000` wrote down every older grant.
  Never Supabase's suggested blanket grant. If a newer CLI rejects the
  config key, delete it: the behaviour is then the default.
- **A new view is writable by default** and runs as its owner, bypassing
  every policy. Revoke all from `public, anon, authenticated` by name, grant
  select. `create or replace view` drops `security_barrier`: restate it.
  `api-grants.sql` steps 13–14 catch both.
- **Postgres**: definer functions have RLS off and check visibility
  themselves; `events` columns are granted by name; `upsert` needs update:
  use `ignoreDuplicates`; `clock_timestamp()` where rows are ordered by time;
  policies of one kind are ORed; names over 63 characters are cut silently.
- **Testing the sign-up gate**: an address with an account never reaches the
  hook (Supabase answers "check your email" and may send nothing): use a
  never-used address.
- **Length limits** are in the database and as `maxLength`
  (`lib/member-limits.ts`); a test holds the two together.
- **Pre-membership screens** read through `my_invite_status()`,
  `claim_invite()` and `invite_address_for_token()`.
- **Photos**: private buckets; every face is a signed URL (`usePhotoUrl`,
  `MemberAvatar`). Anything new that uploads or deletes one handles its small
  copy too (Speed, above). `photo_alt` belongs to one picture; a new one clears it.
  Delete files through the Storage API, before the rows that make them
  readable.
- **Colours by role, light and dark**: `emphasis` for links, outlines and
  progress; `bg-action` for filled buttons; `bg-plate` for header bands;
  `navy` only on a white chip over a photo. High contrast overrides tokens
  (`theme-contrast.test.ts` measures every pair). `/join` is always light
  (`useForceLight`), matching the screenshots registered with Twilio.
- **Sizing**: text boxes in `em`; controls under 44px get
  `data-target="small"`.
- **Focus and speech**: sheets use `useDialogFocus`; success is said with
  `useAnnounce`; a route change focuses `main`. iOS opens a keyboard, or the
  notification prompt, only inside a tap.
- **Motion** is one-shot CSS in `index.css` (`bell-ring`, `like-pulse`,
  `arrive`, `step-in`; after React Bits, no animation libraries). Fill
  `backwards`, never `both` or `forwards`: a transform left on a card traps
  the fixed sheets it opens. Motion driven by script (`CountUp`, smooth
  scrolling) asks `motionReduced()`, which follows Display → Reduce motion;
  the CSS kill switch cannot stop it.
- **Home's `{ from: 'home', segment }` state** drives the back link and the
  lit tab (`litTab` in `app-nav.tsx`).
- **Where the app lands** is written in five places: `App.tsx`, onboarding,
  dev-login, not-found, admin. `AskOnOpening` sits in front of all of them.
- **Realtime**: a table not in the publication delivers nothing.
- **`pnpm fix`** reformats: re-read a file before a second scripted edit.

## Shared pieces, not to write twice

`member-avatar.tsx`, `SegmentPills`, `composer.tsx`, `ReportControl` /
`report-sheet.tsx`, `BlockMemberSheet`, `FilterSheetShell`, `useDialogFocus`,
`useAnnounce`, `SmallButton` / `ReasonField` (`admin/controls.tsx`), `lib/chat/time.ts`,
`describeError` / `describeThrown`, `organization-badge.tsx`, `ClubMark` /
`ClubWordmark` (the owner's SVGs, never redrawn), `DateFields` /
`lib/date-parts.ts` (every date as typed boxes; only the event form opens the
phone's calendar), `NotificationsStep`, `useHoldScroll`, `LinkPreviewCard`,
`DescriptionEditor` / `EventDescription`, `useSession`, `CountUp`,
`PasswordReveal` (every password box).
