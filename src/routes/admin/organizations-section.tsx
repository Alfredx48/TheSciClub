import { useState } from 'react';
import { useAnnounce } from '@/lib/announce';
import { memberDraftKey } from '@/lib/chat/drafts';
import { removeOrganization } from '@/lib/organization-management';
import {
  decideOrganizationRequest,
  type OrganizationRequest,
  useOrganizationRequests,
} from '@/lib/organization-requests';
import { useOrganizations } from '@/lib/organizations';
import { matchesSearch } from '@/lib/search';
import { SmallButton } from '@/routes/admin/controls';
import { OrganizationEditor } from '@/routes/admin/organization-editor';
import { OrganizationBadge } from '@/routes/events/organization-badge';
import { organizationTown } from '@/routes/events/organization-places';
import type { Organization } from '@/types/domain';

/**
 * Every word of the search somewhere in the name, short code or a place (the
 * owner, 2026-10-28).
 */
export function matchesOrganizationSearch(organization: Organization, search: string): boolean {
  return matchesSearch(
    [
      organization.name,
      organization.shortCode,
      organizationTown(organization),
      ...(organization.places ?? []).flatMap((place) => [place.label, place.city, place.state]),
    ],
    search,
  );
}

/** Administrators manage the directory. Organization accounts edit only their
 * linked entries; the database checks the same scope independently. */
export function OrganizationsSection({
  administrator = true,
  memberId,
  ids,
  onChange,
}: {
  administrator?: boolean;
  memberId?: string | null;
  ids?: ReadonlySet<string>;
  onChange?: () => void;
}) {
  const { organizations, loading, error, reload } = useOrganizations();
  const [editing, setEditing] = useState<Organization | OrganizationRequest | 'new' | null>(null);
  const waiting = useOrganizationRequests(administrator);
  const [removing, setRemoving] = useState<Organization | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const announce = useAnnounce();
  const theirs = administrator
    ? organizations
    : organizations.filter((organization) => ids?.has(organization.id));
  const visible = theirs.filter((organization) => matchesOrganizationSearch(organization, search));
  function changed() {
    reload();
    waiting.reload();
    onChange?.();
  }
  const reviewing = editing && editing !== 'new' && 'draft' in editing ? editing : null;
  const editingOrganization =
    editing && editing !== 'new' && !('draft' in editing) ? editing : null;
  const decline = (request: OrganizationRequest) => {
    setBusy(true);
    setFailure(null);
    void decideOrganizationRequest(request.id, false, null)
      .then((result) => {
        if (result.ok) {
          announce(`${request.draft.name} declined.`);
          waiting.reload();
        } else setFailure(result.error);
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <section>
      <h2 className="mt-4 font-extrabold font-head text-ink">Organizations</h2>
      {error || failure || waiting.error ? (
        <p role="alert" className="mt-2 text-destructive">
          {error ?? failure ?? waiting.error}
        </p>
      ) : null}
      {waiting.requests.length > 0 && !editing ? (
        <div className="mt-3 rounded-[14px] border border-line bg-paper px-3.5 py-3">
          <h3 className="font-bold text-ink">Waiting for approval</h3>
          <ul className="mt-1">
            {waiting.requests.map((request) => (
              <li key={request.id} className="border-line border-b py-2.5 last:border-b-0">
                <p className="font-bold text-[0.875rem] text-ink">{request.draft.name}</p>
                <p className="text-[0.8125rem] text-ink2">
                  Asked by {request.memberName ?? 'a former member'}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <SmallButton
                    onClick={() => {
                      setEditing(request);
                    }}
                  >
                    Review
                  </SmallButton>
                  <SmallButton
                    disabled={busy}
                    onClick={() => {
                      decline(request);
                    }}
                  >
                    Decline
                  </SmallButton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {administrator && !editing ? (
        <button
          type="button"
          onClick={() => {
            setEditing('new');
          }}
          className="mt-2 min-h-[44px] rounded-lg bg-action px-4 font-bold text-white"
        >
          Add organization
        </button>
      ) : null}
      {editing ? (
        <OrganizationEditor
          key={editing === 'new' ? `${memberId}:new` : editing.id}
          draftKey={editing === 'new' ? memberDraftKey(memberId, 'new-organization') : undefined}
          organization={editingOrganization}
          {...(reviewing ? { request: reviewing } : {})}
          administrator={administrator}
          onCancel={() => {
            setEditing(null);
          }}
          onSaved={(warning) => {
            setEditing(null);
            setFailure(warning ?? null);
            changed();
          }}
        />
      ) : null}
      {!loading && theirs.length > 1 ? (
        <div className="mt-3">
          <label
            htmlFor="admin-organization-search"
            className="block font-bold font-head text-[0.875rem] text-ink"
          >
            Find an organization
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              id="admin-organization-search"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              placeholder="Name, short code or city"
              className="min-h-[44px] min-w-0 flex-1 basis-[14rem] rounded-[10px] border border-line bg-canvas px-3 text-[0.875rem] text-ink outline-none focus:border-emphasis"
            />
            {search ? (
              <SmallButton
                onClick={() => {
                  setSearch('');
                }}
              >
                Clear search
              </SmallButton>
            ) : null}
          </div>
          {search.trim() ? (
            <p role="status" className="mt-2 text-[0.8125rem] text-grey">
              {visible.length} matching organization{visible.length === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <p className="mt-3 text-grey">Loading organizations…</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-[14px] border border-line bg-paper">
          {visible.length === 0 ? (
            <p className="p-3 text-grey">
              {search.trim()
                ? 'No organization matches that search.'
                : administrator
                  ? 'No organizations yet.'
                  : 'An administrator can link your account to the organizations you manage.'}
            </p>
          ) : (
            visible.map((organization) => (
              <div
                key={organization.id}
                className="flex flex-wrap items-center gap-2 border-line border-b p-3 last:border-b-0"
              >
                {/* The badge members see, so a missing logo is noticed here. */}
                <OrganizationBadge organization={organization} />
                <div className="min-w-0 flex-1 basis-[8rem]">
                  <h3 className="font-bold text-ink">{organization.name}</h3>
                  <p className="text-[0.8125rem] text-grey">
                    {organization.shortCode} · {organizationTown(organization)}
                  </p>
                </div>
                {/* Together, so the badge does not push Remove onto a line of
                    its own beneath the name on a phone. */}
                <div className="flex flex-none gap-2">
                  <SmallButton
                    aria-label={`Edit ${organization.name}`}
                    onClick={() => {
                      setFailure(null);
                      setEditing(organization);
                    }}
                  >
                    Edit
                  </SmallButton>
                  {administrator ? (
                    <SmallButton
                      destructive
                      aria-label={`Remove ${organization.name}`}
                      onClick={() => {
                        setFailure(null);
                        setRemoving(organization);
                      }}
                    >
                      Remove
                    </SmallButton>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {removing ? (
        <div className="mt-3 rounded-[14px] border border-destructive/30 bg-paper p-3">
          <p className="text-ink">Remove {removing.name} from the directory?</p>
          <p className="mt-1 text-[0.8125rem] text-grey">
            Its representative links will be removed. Existing events and invites stay on record.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              disabled={busy}
              type="button"
              className="min-h-[44px] rounded-lg bg-destructive px-4 font-bold text-white disabled:opacity-50"
              onClick={() => {
                setBusy(true);
                void removeOrganization(removing.id)
                  .then((result) => {
                    if (result.ok) {
                      setRemoving(null);
                      setEditing(null);
                      announce('Organization removed.');
                      changed();
                    } else setFailure(result.error ?? 'The organization was not removed.');
                  })
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              {busy ? 'Removing…' : 'Remove organization'}
            </button>
            <button
              disabled={busy}
              type="button"
              onClick={() => {
                setRemoving(null);
              }}
              className="min-h-[44px] rounded-lg border border-line px-4 text-ink"
            >
              Keep organization
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
