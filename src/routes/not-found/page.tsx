import { Link } from 'react-router-dom';

/**
 * The page for an address that is not one.
 *
 * It sits inside the shell, so the tab bar is still there and the way out is a
 * tap rather than the back button. Before this, an unknown path under `/*`
 * matched the shell, found no route inside it, and rendered the nav over an
 * empty page — no message, no error, nothing to act on.
 *
 * Only a signed-in member reaches it. A visitor without a member row is sent to
 * `/join` by `RequireMember` before routing gets this far, which is the right
 * answer for them: the club cannot tell a mistyped address from a probe, and
 * the door is the same either way.
 *
 * There is no HTTP status behind this. The app is a single page and the host
 * rewrites every path to index.html, deliberately — see netlify.toml, where
 * that rewrite is what stops a reload of /peers 404ing. So this is what "not
 * found" looks like here, and index.html's noindex covers the crawler half.
 */
export default function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <header className="flex-none border-line border-b bg-paper px-[18px] pt-[18px] pb-3">
        <h1 className="font-extrabold font-display text-[1.5625rem] text-ink">Page not found</h1>
      </header>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
        <p className="text-[0.90625rem] text-ink2 leading-relaxed">
          That address does not go anywhere. The link may be old, or it may have a typo in it.
        </p>
        <p className="text-[0.78125rem] text-grey leading-relaxed">
          {/* The tabs are under the screen on a phone and above it from `md`
              (app-nav.tsx), so the sentence says whichever is true. */}
          Everything in the club is reachable from the tabs <span className="md:hidden">below</span>
          <span className="hidden md:inline">above</span>.
        </p>
        <Link
          to="/home"
          className="mt-2 inline-flex min-h-[44px] items-center rounded-[13px] bg-action px-5 font-bold font-head text-[0.9375rem] text-white"
        >
          Go to Home
        </Link>
      </div>
    </div>
  );
}
