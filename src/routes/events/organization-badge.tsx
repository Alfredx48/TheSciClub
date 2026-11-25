import { useState } from 'react';
import { logoFillsTile } from '@/lib/organization-management';
import { usePhotoUrl } from '@/lib/photos';
import { cn } from '@/lib/utils';
import { shortCodeFor } from '@/routes/peers/member-card';
import type { Organization } from '@/types/domain';

/**
 * The mark an organization is recognised by, on an event card or its own page.
 *
 * Three states, in order of preference: the organization's own logo, its short
 * code in the club's gold tile, or — for a host the club has no organization
 * for — letters derived from the name the feed gave.
 *
 * ---------------------------------------------------------------------------
 * The fallback is the point
 * ---------------------------------------------------------------------------
 * The logo now comes from our own bucket rather than the organization's CDN,
 * but the fallback matters just as much: five of the six organizations have no
 * logo at all, local development runs with the storage service switched off
 * entirely, and a file can always go missing. A badge that renders as a
 * broken-image glyph reads as this app being broken, so `onError` drops back to
 * the tile and the row looks deliberate either way.
 *
 * That is also why the tile is rendered underneath rather than instead of the
 * image — there is no flash of nothing while it loads.
 */

export interface OrganizationBadgeProps {
  /** The club organization, when the event links to one. */
  organization: Pick<Organization, 'name' | 'shortCode' | 'logoPath'> | null;
  /** The feed's own name for the host, used when there is no organization. */
  hostName?: string | null;
  size?: 'sm' | 'lg';
  /** Less padding around the logo, for a badge inside a pill (role-pill.tsx). */
  tight?: boolean;
  className?: string;
}

export function OrganizationBadge({
  organization,
  hostName,
  size = 'sm',
  tight = false,
  className,
}: OrganizationBadgeProps) {
  const [logoFailed, setLogoFailed] = useState(false);
  // Above the early return: a hook runs on every render or none.
  const logo = usePhotoUrl(organization?.logoPath);

  const name = organization?.name ?? hostName ?? null;
  if (!name) return null;

  const letters = organization?.shortCode ?? shortCodeFor(name);
  const showLogo = Boolean(logo) && !logoFailed;

  // In `em`, off the tile's own letters, so the tile grows with them. In pixels
  // a four-letter short code overflowed its own square at the largest text
  // setting — CDRF by twelve pixels — and the fallback that exists so a missing
  // logo still looks deliberate was the thing that broke.
  const box =
    size === 'lg'
      ? 'h-[3em] w-[3em] rounded-[0.91em] text-[1.375rem]'
      : 'h-[3.45em] w-[3.45em] rounded-[1.09em] text-[0.6875rem]';

  return (
    <span
      className={cn(
        'relative grid flex-none place-items-center overflow-hidden font-extrabold font-head text-white',
        box,
        className,
      )}
      // The gold tile sits underneath the logo rather than beside it, so a slow
      // or failed image never leaves a hole in the row.
      style={{ background: 'linear-gradient(140deg,#8A6512,#D4A83A)' }}
      // Decorative throughout: every place this is used renders the
      // organization's name as text right beside it, so giving the badge a
      // label of its own would read the organization twice to a screen reader.
      aria-hidden="true"
    >
      {/* Four letters never fitted the small tile, at any text size — it was
          simply less obvious before the tile started scaling. CDRF and WWM are
          real: an organization's own short code is whatever its row says, and
          `shortCodeFor` takes up to four initials from a name. Shrunk in `em`
          so it stays proportional at every setting rather than pinned to one.

          Three gets a step of its own because letter widths are not equal:
          NCS fits where WWM does not, and a rule that measured characters
          rather than counting them would be a lot of machinery for a tile
          holding at most four of them. */}
      <span
        className={cn(
          letters.length === 3 && 'text-[0.88em]',
          letters.length > 3 && 'text-[0.76em]',
        )}
      >
        {letters}
      </span>
      {showLogo ? (
        <img
          src={logo ?? ''}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => {
            setLogoFailed(true);
          }}
          // White ground and padding because these are logos drawn for a white
          // page — several are dark marks that would vanish on the gold tile.
          className={cn(
            'absolute inset-0 h-full w-full bg-white object-contain',
            // One saved square on its own colour fills the tile.
            logoFillsTile(organization?.logoPath) ? 'p-0' : tight ? 'p-[1px]' : 'p-1',
          )}
        />
      ) : null}
    </span>
  );
}
