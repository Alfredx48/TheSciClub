import { Activity, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppNav } from '@/components/app-nav';
import { AskAfterSending } from '@/components/ask-after-sending';
import { BackLine, BackLineProvider, BackTrail } from '@/components/back-line';
import { DebugPanel } from '@/components/debug-panel';
import { DisplaySheetProvider, useOpenDisplaySheet } from '@/components/display-sheet';
import { InstallNudge } from '@/components/install-nudge';
import { InstalledApp } from '@/components/installed-app';
import { NativeShell } from '@/components/native-shell';
import { RequireMember } from '@/components/require-member';
import { UpdateRequired } from '@/components/update-required';
import { AccessibilityProvider, useForceLight } from '@/lib/accessibility';
import { AnnounceProvider } from '@/lib/announce';
import { useUpdateRequired } from '@/lib/app-update';
import { nameScreen } from '@/lib/back-trail';
import { LeaveHomeScreenHandoff } from '@/lib/home-screen-handoff';
import { keptReadsStale } from '@/lib/kept-reads';
import { prefetchMap } from '@/lib/map';
import { noteScreen } from '@/lib/page-speed';
import { FollowNotification } from '@/lib/push/follow-notification';
import { OpenedNotification } from '@/lib/push/opened-notification';
import { countVisit } from '@/lib/web-analytics';
import DevLoginPage from '@/routes/dev-login/page';
import HomePage from '@/routes/home/page';
import DeleteAccountPage from '@/routes/legal/delete-account';
import PrivacyPage from '@/routes/legal/privacy';
import TermsPage from '@/routes/legal/terms';
import NotFoundPage from '@/routes/not-found/page';
import type OnboardingScreen from '@/routes/onboarding/page';

/*
 * Every screen but the doors is fetched when it is first opened, not with the
 * first page (2026-10-14: one 1.16MB script held all of them, Admin and the
 * event editor included). Home and the legal pages stay in the first script.
 * /join keeps its prerendered HTML while its script loads (main.tsx).
 * The other tabs are fetched once the first screen is up (prefetchTabs).
 */
const OrganizationManagementPage = lazy(
  () => import('@/routes/admin/organization-management-page'),
);
const AdminPage = lazy(() => import('@/routes/admin/page'));
const AppSignInPage = lazy(() => import('@/routes/app-sign-in/page'));
const AuthConfirmPage = lazy(() => import('@/routes/auth-confirm/page'));
const GroupMembersPage = lazy(() => import('@/routes/chat/group-members'));
const NewGroupPage = lazy(() => import('@/routes/chat/new-group'));
const NewMessagePage = lazy(() => import('@/routes/chat/new-message'));
const NewRoomPage = lazy(() => import('@/routes/chat/new-room'));
const NewTopicPage = lazy(() => import('@/routes/chat/new-topic'));
const RoomPage = lazy(() => import('@/routes/chat/room-page'));
const SharePage = lazy(() => import('@/routes/chat/share-page'));
const ThreadPage = lazy(() => import('@/routes/chat/thread-page'));
const TopicPage = lazy(() => import('@/routes/chat/topic-page'));
const EventDetailPage = lazy(() => import('@/routes/events/event-detail'));
const EventFormPage = lazy(() => import('@/routes/events/event-form'));
const OrganizationDetailPage = lazy(() => import('@/routes/events/organization-detail'));
const HomeNewPage = lazy(() => import('@/routes/home/new'));
const PublicEventPage = lazy(() => import('@/routes/public-event/page'));
const RegisterForEventPage = lazy(() => import('@/routes/public-event/register'));
const GuestListPage = lazy(() => import('@/routes/events/guest-list'));
const CheckInPage = lazy(() => import('@/routes/events/check-in-page'));
const ReviewPage = lazy(() => import('@/routes/reviews/review-page'));
const CheckInsPage = lazy(() => import('@/routes/events/check-ins-page'));
const HeldInvitesPage = lazy(() => import('@/routes/events/held-invites'));
const IntroductionPage = lazy(() => import('@/routes/introductions/page'));
const InvitesPage = lazy(() => import('@/routes/invites/page'));
const QrCodePage = lazy(() => import('@/routes/me/qr-page'));
const StatsPage = lazy(() => import('@/routes/stats/page'));
const SavedPage = lazy(() => import('@/routes/me/saved-page'));
const MyPostsPage = lazy(() => import('@/routes/me/my-posts-page'));
const NotificationsPage = lazy(() => import('@/routes/notifications/page'));
const MemberDetailPage = lazy(() => import('@/routes/peers/member-detail'));
const AboutPage = lazy(() => import('@/routes/about/page'));
const AboutProfilePage = lazy(() => import('@/routes/about/profile'));
const ProfileAnswersPage = lazy(() => import('@/routes/profile/answers'));
const ProfileDetailsPage = lazy(() => import('@/routes/profile/details'));
const ProfileSurveyPage = lazy(() => import('@/routes/profile/page'));
const ProfileNextPage = lazy(() => import('@/routes/profile/next'));
const RequestInvitePage = lazy(() => import('@/routes/request-invite/page'));
const ResetPasswordPage = lazy(() => import('@/routes/reset-password/page'));

let loadedOnboarding: typeof OnboardingScreen | undefined;

export async function loadOnboarding() {
  const module = await import('@/routes/onboarding/page');
  loadedOnboarding = module.default;
  return module;
}

const LazyOnboarding = lazy(loadOnboarding);

function OnboardingPage() {
  const [Page] = useState(() => loadedOnboarding ?? LazyOnboarding);
  return <Page />;
}

// The other four tabs, fetched after the first screen so a first tap on one
// does not wait for its script.
const loadPeers = () => import('@/routes/peers/page');
const loadChat = () => import('@/routes/chat/page');
const loadEvents = () => import('@/routes/events/page');
const loadMe = () => import('@/routes/me/page');
const PeersPage = lazy(loadPeers);
const ChatPage = lazy(loadChat);
const EventsPage = lazy(loadEvents);
const MePage = lazy(loadMe);

/**
 * The script for the screen being opened, asked for as the app starts rather
 * than once the membership check lets the screen render: the two then come
 * over the network together. Started from main.tsx.
 */
const SCREENS: [RegExp, () => Promise<unknown>][] = [
  [/^\/peers\/?$/, loadPeers],
  [/^\/peers\/[^/]+$/, () => import('@/routes/peers/member-detail')],
  [/^\/chat\/?$/, loadChat],
  [/^\/chat\/rooms\/[^/]+\/topics\//, () => import('@/routes/chat/topic-page')],
  [/^\/chat\/rooms\/[^/]+\/?$/, () => import('@/routes/chat/room-page')],
  [/^\/chat\/t\/[^/]+\/?$/, () => import('@/routes/chat/thread-page')],
  [/^\/events\/?$/, loadEvents],
  [/^\/events\/[0-9a-f-]{36}\/?$/, () => import('@/routes/events/event-detail')],
  [/^\/me\/?$/, loadMe],
  [/^\/notifications\/?$/, () => import('@/routes/notifications/page')],
];

export function preloadScreen(pathname: string): void {
  const load = SCREENS.find(([pattern]) => pattern.test(pathname))?.[1];
  if (load) void load().catch(() => undefined);
}

/** Runs `task` when the page is idle; returns a cancel. */
function whenIdle(task: () => void): () => void {
  // Safari before 26 has no requestIdleCallback.
  if (typeof (window.requestIdleCallback as unknown) === 'function') {
    const id = window.requestIdleCallback(task, { timeout: 4000 });
    return () => {
      window.cancelIdleCallback(id);
    };
  }
  const id = window.setTimeout(task, 2000);
  return () => {
    window.clearTimeout(id);
  };
}

function prefetchTabs(): () => void {
  return whenIdle(() => {
    void Promise.allSettled([loadPeers(), loadChat(), loadEvents(), loadMe()]);
  });
}

const TABS = [
  ['/home', HomePage],
  ['/peers', PeersPage],
  ['/chat', ChatPage],
  ['/events', EventsPage],
  ['/me', MePage],
] as const;

/**
 * The five tabs stay mounted once opened, hidden while another screen shows
 * (2026-10-22: each switch read everything again behind placeholders). A
 * hidden tab keeps its data, scroll and choices; its effects stop, and run
 * again when it shows, so its reads refresh behind what is already drawn.
 */
export function KeptTabs() {
  const { pathname } = useLocation();
  const current = TABS.find(([path]) => pathname === path || pathname === `${path}/`)?.[0];
  const [opened, setOpened] = useState<readonly string[]>(current ? [current] : []);
  if (current && !opened.includes(current)) setOpened([...opened, current]);
  // Another screen may change what a tab shows: its next show reads again.
  useEffect(() => {
    if (!current) keptReadsStale();
  }, [current]);
  return TABS.filter(([path]) => opened.includes(path) || path === current).map(
    ([path, Screen]) => (
      // No Suspense of its own: a tab's first script then arrives inside the
      // route change's transition, with the last screen still up.
      <Activity key={path} mode={path === current ? 'visible' : 'hidden'}>
        <Screen />
      </Activity>
    ),
  );
}

/**
 * The signed-in shell: one scrolling surface above a fixed five-tab bar.
 *
 * Onboarding and the profile survey will render outside this shell — they have
 * their own footers and no tab bar — so they are siblings of the shell route
 * rather than children of it.
 */
function AppShell() {
  useEffect(prefetchTabs, []);
  const { pathname } = useLocation();
  const offersMap = /^\/(peers|events)\/?$/.test(pathname);
  useEffect(() => {
    if (offersMap) return whenIdle(prefetchMap);
  }, [offersMap]);

  // Phone-width by default, because that is the design and the PWA target.
  // Widened beyond that rather than left as a 480px ribbon on a big screen —
  // the deck grids into the extra width.
  //
  // The switch is `md` (704px, src/index.css: an iPad mini held upright is
  // 744, 2026-11-07) and not `lg`. At `lg` every window from 480 to
  // 1023 got the ribbon: a browser that is not maximised, a laptop, or half a
  // screen showed a 480px column with ~260px of dead margin either side and the
  // tabs at the bottom, which reads as the app failing to fit rather than as a
  // phone layout. Reported as a Firefox bug; it was neither Firefox nor a bug,
  // it was this number, and both engines measured identically.
  return (
    <div className="app-shell relative mx-auto flex h-dvh w-full max-w-[480px] flex-col overflow-clip bg-canvas md:max-w-[1180px]">
      <DisplaySheetProvider>
        <ShellContent />
      </DisplaySheetProvider>
    </div>
  );
}

function ShellContent() {
  const openDisplay = useOpenDisplaySheet();
  return (
    <BackLineProvider>
      {/* First in the DOM, painted last on a phone and first on a desktop —
          see the ordering note in app-nav.tsx. */}
      {/* The first thing a keyboard reaches: a way past the five tabs to the
          screen. Off-screen until focused, then a navy pill at the top. */}
      <a
        href="#main"
        // Off the top of the shell until focused, then slid in (past the
        // status bar in the store app, index.css). Not sr-only:
        // `not-sr-only` on focus makes it static and it became a strip that
        // pushed the screen down.
        className="-translate-y-[calc(150%_+_env(safe-area-inset-top))] absolute top-2 left-2 z-50 rounded-full bg-action px-4 py-2 font-bold text-[0.875rem] text-white focus:translate-y-0"
      >
        Skip to content
      </a>
      {/* The second thing: Display, from every screen, not only Me, which has
          the button in its header. */}
      <button
        type="button"
        onClick={openDisplay}
        className="-translate-y-[calc(150%_+_env(safe-area-inset-top))] absolute top-2 left-2 z-50 rounded-full bg-action px-4 py-2 font-bold text-[0.875rem] text-white focus:translate-y-0"
      >
        Display settings
      </button>
      <AppNav />
      {/* A pressed notification clears itself (opened-notification.tsx). */}
      <OpenedNotification />
      {/* The one main landmark, so a screen reader can jump past the nav to
          the screen ("main" in the rotor). A flex column the size of the slot
          the routes already filled, so nothing about the layout moves.
          Focusable so the skip link and a route change have somewhere to land. */}
      <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        {/* While a screen's script arrives the tab bar stays and the slot is
            empty; a route change keeps the old screen up meanwhile, since
            React Router changes routes in a transition. */}
        {/* The way back, on every screen below a tab's first (the owner,
            2026-11-18; back-line.tsx). */}
        <BackLine />
        <Suspense fallback={<div className="flex-1" />}>
          <KeptTabs />
          <Routes>
            {/* The five tabs are drawn by KeptTabs, above. */}
            <Route path="/home" element={null} />
            <Route path="/home/new" element={<HomeNewPage />} />
            <Route path="/peers" element={null} />
            <Route path="/peers/:id" element={<MemberDetailPage />} />
            <Route path="/introductions/:id" element={<IntroductionPage />} />
            <Route path="/chat" element={null} />
            {/* A room's slug is in the URL — /chat/rooms/bowel — which is why
            chat_rooms.id is a slug and not a uuid. /new sits above :roomId for
            a reader's sake; React Router ranks a static segment above a dynamic
            one either way, and no room can be called "new" — the seeded twelve
            are fixed and a member room's id always carries a four-character
            suffix. */}
            <Route path="/chat/rooms/new" element={<NewRoomPage />} />
            <Route path="/chat/rooms/:roomId" element={<RoomPage />} />
            <Route path="/chat/rooms/:roomId/new" element={<NewTopicPage />} />
            <Route path="/chat/rooms/:roomId/topics/:topicId" element={<TopicPage />} />
            {/* /chat/t/:threadId and not /chat/threads/:id — a conversation's URL
            is pasted and typed far more than a room's, and the thread id is a
            uuid that is long enough on its own. */}
            <Route path="/chat/t/:threadId" element={<ThreadPage />} />
            {/* Who is in a group, adding to it and leaving it. A screen rather
            than a panel on the conversation: all three are things somebody
            does once, and none of them belongs beside a composer. */}
            <Route path="/chat/t/:threadId/members" element={<GroupMembersPage />} />
            <Route path="/chat/new-group" element={<NewGroupPage />} />
            {/* A conversation with one person, from Chat rather than only from
            their profile (2026-10-10). */}
            <Route path="/chat/new" element={<NewMessagePage />} />
            {/* What another app shared to the club, kept by the service worker
            (manifest share_target; Android). */}
            <Route path="/share" element={<SharePage />} />
            <Route path="/events" element={null} />
            {/* Adding and changing an event by hand: administrators, and members
            who speak for an organization. The page sends anybody else back to
            Events. No event id can be "new": they are uuids. */}
            <Route path="/events/new" element={<EventFormPage />} />
            <Route path="/events/invites" element={<HeldInvitesPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/events/:id/edit" element={<EventFormPage />} />
            <Route path="/events/:id/guests" element={<GuestListPage />} />
            <Route path="/events/:id/check-in" element={<CheckInPage />} />
            <Route path="/events/:id/review" element={<ReviewPage kind="event" />} />
            <Route
              path="/events/organizations/:id/review"
              element={<ReviewPage kind="organization" />}
            />
            <Route path="/events/:id/check-ins" element={<CheckInsPage />} />
            <Route path="/events/organizations/:id" element={<OrganizationDetailPage />} />
            <Route path="/me" element={null} />
            {/* Administrators, org admins and professionals; the page sends
            anybody else to Me. */}
            <Route path="/me/qr" element={<QrCodePage />} />
            <Route path="/me/saved" element={<SavedPage />} />
            <Route path="/me/posts" element={<MyPostsPage />} />
            {/* Unlisted in the tab bar: the bell on Home (phone) and at the end
            of the top bar (desktop) lead here. */}
            <Route path="/notifications" element={<NotificationsPage />} />
            {/* Unlisted in the tab bar; the page redirects a non-mentor away.
            Reached from the Invites card on Me, which is where a member goes
            to find out what their membership lets them do. */}
            <Route path="/invites" element={<InvitesPage />} />
            {/* Org admins and professionals (20261031110000); reached from Me. */}
            <Route path="/stats" element={<StatsPage />} />
            {/* The page's old address, in notifications already sent. */}
            <Route path="/partner" element={<Navigate to="/stats" replace />} />
            {/* Unlisted in the tab bar; the page redirects a non-admin away. */}
            <Route path="/organizations/manage" element={<OrganizationManagementPage />} />
            <Route path="/admin" element={<AdminPage />} />
            {/* Last, and inside the shell on purpose: an unknown path used to match
            the outer `/*`, reach this switch, match nothing, and leave the tab
            bar sitting over an empty page. */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </main>
      {/* After the screen and before the tab bar on a phone (the nav is
          ordered last there): it pushes the screen up rather than covering
          it. Phones' browsers only; see install-nudge.tsx. */}
      <InstallNudge />
      {/* An administrator's request times, when they turned them on in Me. */}
      <DebugPanel />
    </BackLineProvider>
  );
}

export default function App() {
  // An iPhone app too old to use shows only how to update (src/lib/app-update.ts).
  if (useUpdateRequired()) {
    return (
      <AccessibilityProvider>
        <NativeShell />
        <UpdateRequired />
      </AccessibilityProvider>
    );
  }
  return (
    <AccessibilityProvider>
      {/* Above the routes, so a confirmation outlives the screen that sent
          it — see src/lib/announce.tsx. */}
      <AnnounceProvider>
        <InstalledApp />
        <NativeShell />
        <LeaveHomeScreenHandoff />
        <BackTrail />
        <RouteChange />
        <ScreenTimer />
        <CountVisit />
        <FollowNotification />
        <AppRoutes />
      </AnnounceProvider>
    </AccessibilityProvider>
  );
}

/**
 * What a page load does on its own and a route change does not: name the
 * page and put the reader at the top of it.
 *
 * Tapping Peers → Chat swaps the screen without a load, so a screen reader
 * was told nothing, the title stayed "The Sci Club" on every screen, and
 * focus stayed on the tab that was pressed. After each change the title
 * becomes the screen's h1 — "Chat · The Sci Club" — and focus moves to the
 * main landmark, from which the next Tab reaches the screen's first control
 * and a screen reader starts reading the heading. Not on the first render:
 * a page load already announces itself, and stealing focus then would take
 * it from the address bar.
 *
 * One place, keyed on the h1 every screen already has, rather than a title
 * prop on eleven pages that would drift from their headings.
 */
export function RouteChange() {
  const { pathname } = useLocation();
  // The path the last run saw. A run that sees the same path is the first
  // screen (or StrictMode's second pass over it), and does not take focus.
  const last = useRef(pathname);
  // Once per screen: the path is what changes, the heading is what is read.
  useEffect(() => {
    // The heading is not there on the first frame of most screens — the
    // account resolves, the read lands, then the h1 draws — so the title is
    // set from whatever the document holds now and again as it changes,
    // until the next screen.
    const name = () => {
      // A kept tab hides with display: none, and its h1 is still there.
      const heading = [...document.querySelectorAll('main h1, h1')]
        .find((h1) => !hidden(h1))
        ?.textContent.trim();
      document.title = heading ? `${heading} · The Sci Club` : 'The Sci Club';
      // And what the line on the next screen calls this one (back-trail.ts).
      nameScreen(heading);
    };
    name();
    const observer = new MutationObserver(name);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    const changed = last.current !== pathname;
    last.current = pathname;
    const frame = requestAnimationFrame(() => {
      if (changed) document.querySelector<HTMLElement>('main')?.focus();
    });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [pathname]);
  return null;
}

/** Cloudflare's count of visits, by kind of page (web-analytics.ts). */
function CountVisit() {
  const { pathname } = useLocation();
  useEffect(() => {
    countVisit(pathname);
  }, [pathname]);
  return null;
}

/** Where each screen visit starts, for page speed's cards shown (page-speed.ts). */
function ScreenTimer() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    noteScreen(pathname);
  }, [pathname]);
  return null;
}

function hidden(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (getComputedStyle(node).display === 'none') return true;
  }
  return false;
}

/** Its children are drawn in light whatever the member chose (useForceLight). */
function InLight({ children }: { children: React.ReactNode }) {
  useForceLight();
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-canvas" />}>
      <Routes>
        {/* Home, since 2026-09-30 (HANDOFF.md "What Home is" decision 6). Until then this
          went to Peers, because Home was a placeholder and landing on it
          opened the app on a page whose own copy pointed elsewhere. Home is
          now the club's recent topics, photographs, events and people in one
          list, and it was released one step at a time and seen on the live
          club before it became the door. The manifest's start_url stays "/",
          so an installed app follows this line too. */}
        <Route path="/" element={<Navigate to="/home" replace />} />
        {/* Outside the shell: onboarding has its own footer and no tab bar. */}
        {/* Always light: see useForceLight. */}
        <Route
          path="/join"
          element={
            <InLight>
              <OnboardingPage />
            </InLight>
          }
        />
        {/* Forgot password and change password both land here, from an emailed
          link. Outside the shell, always light, like /join. */}
        <Route
          path="/reset-password"
          element={
            <InLight>
              <ResetPasswordPage />
            </InLight>
          }
        />
        {/* Every emailed link opens here first (src/lib/email-link.ts). The
          dot keeps an old service worker from answering it with an app that
          has no such page (src/sw.ts). */}
        <Route
          path="/auth/confirm.html"
          element={
            <InLight>
              <AuthConfirmPage />
            </InLight>
          }
        />
        {/* Chrome or Safari, opened by the iPhone Home Screen app to sign in
          with Google there (src/lib/google-in-browser.ts). Outside the shell,
          always light, like /join. */}
        <Route
          path="/app-sign-in"
          element={
            <InLight>
              <AppSignInPage />
            </InLight>
          }
        />
        {/* Asking an org admin for an invite, signed out (20261029030000).
          Outside the shell, always light, like /join. */}
        <Route
          path="/request-invite"
          element={
            <InLight>
              <RequestInvitePage />
            </InLight>
          }
        />
        {/* Outside the shell: its own footer, no tab bar. */}
        <Route path="/profile" element={<ProfileSurveyPage />} />
        <Route path="/profile/answers" element={<ProfileAnswersPage />} />
        <Route path="/profile/details" element={<ProfileDetailsPage />} />
        <Route path="/profile/next" element={<ProfileNextPage />} />
        {/* Development only: signs in the accounts the local seed makes. In a
          build the condition is false, so the route and the page itself are
          dropped from the bundle. See the page's file header. */}
        {import.meta.env.DEV && <Route path="/dev-login" element={<DevLoginPage />} />}
        {/* A public event's page and its registration form, for anybody with
          the link (20261022180000). Outside the shell, always light. */}
        <Route
          path="/e/:id"
          element={
            <InLight>
              <PublicEventPage />
            </InLight>
          }
        />
        <Route
          path="/e/:id/register"
          element={
            <InLight>
              <RegisterForEventPage />
            </InLight>
          }
        />
        {/* Public, with no account: see src/routes/legal/legal-page.tsx. */}
        <Route
          path="/about"
          element={
            <InLight>
              <AboutPage />
            </InLight>
          }
        />
        <Route
          path="/about/:id"
          element={
            <InLight>
              <AboutProfilePage />
            </InLight>
          }
        />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/delete-account" element={<DeleteAccountPage />} />
        <Route
          path="/*"
          element={
            <RequireMember>
              {/* After the first thing a member sends: see AskAfterSending. */}
              <AskAfterSending>
                <AppShell />
              </AskAfterSending>
            </RequireMember>
          }
        />
      </Routes>
    </Suspense>
  );
}
