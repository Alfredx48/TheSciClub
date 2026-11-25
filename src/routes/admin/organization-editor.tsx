import { useEffect, useRef, useState } from 'react';
import { AddressField } from '@/components/address-field';
import { motionReduced } from '@/lib/accessibility';
import { useAnnounce } from '@/lib/announce';
import { useFormDraft } from '@/lib/form-draft';
import { squareOnOwnGround } from '@/lib/image';
import { ORGANIZATION_CATEGORIES, type OrganizationCategory } from '@/lib/organization-categories';
import {
  logoFillsTile,
  type OrganizationDraft,
  saveOrganization,
  saveOrganizationLogo,
  saveOrganizationPlaces,
} from '@/lib/organization-management';
import {
  decideOrganizationRequest,
  type OrganizationRequest,
  requestOrganization,
} from '@/lib/organization-requests';
import { usePhotoUrl } from '@/lib/photos';
import { useDraftMedia } from '@/lib/use-draft-media';
import { cn } from '@/lib/utils';
import { OrganizationGrantsEditor } from '@/routes/admin/organization-grants-editor';
import {
  newPlace,
  OrganizationLocations,
  placesToSave,
  toDrafts,
} from '@/routes/admin/organization-locations';
import { DraftStatus } from '@/routes/chat/draft-status';
import { placesOf } from '@/routes/events/organization-places';
import type { Organization } from '@/types/domain';

/** What Save does to the logo: leave it, replace it, or take it away. */
type LogoChange = { kind: 'keep' } | { kind: 'new'; file: File } | { kind: 'remove' };

const hasLogoFile = (logo: LogoChange) => logo.kind === 'new';

const field =
  'mt-1 min-h-[44px] w-full rounded-[11px] border border-line bg-paper px-3 py-2 text-[1rem] text-ink';

/**
 * The one form for an organization. An administrator's saves. A new one from
 * anybody else is sent to the administrators instead (20261101010000), without
 * a logo or the vouching box, which are theirs to set. `request` opens what a
 * member sent, and saving it approves it.
 */
export function OrganizationEditor({
  organization,
  draftKey,
  administrator,
  request,
  onSaved,
  onCancel,
}: {
  organization: Organization | null;
  draftKey?: string | undefined;
  administrator: boolean;
  request?: OrganizationRequest;
  /** `warning` when the organization saved and its new logo did not. */
  onSaved: (warning?: string) => void;
  onCancel: () => void;
}) {
  const asking = !organization && !administrator;
  const newDraftKey = organization || request ? undefined : draftKey;
  const {
    value: { fields: draft, tags, places },
    setValue: setForm,
    storage,
    restored,
    finish,
  } = useFormDraft(
    newDraftKey,
    () => {
      const fields: OrganizationDraft = organization ??
        request?.draft ?? {
          name: '',
          shortCode: '',
          city: '',
          description: '',
          tags: [],
          canInvite: true,
        };
      return {
        fields,
        tags: fields.tags.join(', '),
        places: organization
          ? toDrafts(placesOf(organization))
          : request?.places.length
            ? toDrafts(request.places)
            : [newPlace()],
      };
    },
    (saved) => ({ ...saved, places: toDrafts(saved.places) }),
  );
  function setDraft(fields: OrganizationDraft) {
    setForm((current) => ({ ...current, fields }));
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoDraft = useDraftMedia<LogoChange>(
    asking ? undefined : newDraftKey,
    () => ({ kind: 'keep' }),
    hasLogoFile,
  );
  const { value: logo, setValue: setLogo } = logoDraft;
  const [preview, setPreview] = useState<string | null>(null);
  // The chosen file fills its tile once saved (squareOnOwnGround).
  const [newFills, setNewFills] = useState(false);
  const savedLogo = usePhotoUrl(organization?.logoPath);
  const shown = logo.kind === 'new' ? preview : logo.kind === 'remove' ? null : savedLogo;
  const announce = useAnnounce();
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Edit is pressed on a row that may be far down a long directory, and the
  // form opens above the list. Brought into view, with focus on its heading so
  // a screen reader starts there too. The heading and not the first box: on a
  // phone that would open the keyboard over the form being arrived at.
  useEffect(() => {
    form.current?.scrollIntoView({
      block: 'start',
      behavior: motionReduced() ? 'auto' : 'smooth',
    });
    heading.current?.focus({ preventScroll: true });
  }, []);

  // The chosen file, shown before anything is uploaded.
  useEffect(() => {
    if (logo.kind !== 'new') {
      setPreview(null);
      return;
    }
    let url = URL.createObjectURL(logo.file);
    setPreview(url);
    setNewFills(false);
    let gone = false;
    // Shown as it will be saved: square on its own colour, filling the tile.
    void squareOnOwnGround(logo.file, 400).then((square) => {
      if (gone || !square) return;
      URL.revokeObjectURL(url);
      url = URL.createObjectURL(square.file);
      setPreview(url);
      setNewFills(true);
    });
    return () => {
      gone = true;
      URL.revokeObjectURL(url);
    };
  }, [logo]);

  async function save() {
    const toSave = placesToSave(places);
    if (typeof toSave === 'string') {
      setError(toSave);
      return;
    }
    const words = {
      ...draft,
      // The directory's state is its main location's; none clears it.
      state: toSave[0]?.state ?? '',
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    };
    if (asking) {
      const sent = await requestOrganization(words, toSave);
      if (!sent.ok) {
        setError(sent.error);
        return;
      }
      finish();
      announce('Sent to the administrators.');
      onSaved();
      return;
    }
    const result = await saveOrganization(organization?.id ?? null, words);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    finish();
    if (newDraftKey) logoDraft.clear();
    const placed = await saveOrganizationPlaces(result.id, toSave);
    if (!placed.ok) {
      onSaved(`${draft.name.trim()} was saved, but its locations were not: ${placed.error}`);
      return;
    }
    // After the words, because a new organization has no folder to put a
    // logo in until it has an id.
    if (logo.kind !== 'keep') {
      const saved = await saveOrganizationLogo(result.id, logo.kind === 'new' ? logo.file : null);
      if (!saved.ok) {
        onSaved(`${draft.name.trim()} was saved, but its logo was not: ${saved.error}`);
        return;
      }
    }
    if (request) {
      const decided = await decideOrganizationRequest(request.id, true, result.id);
      if (!decided.ok) {
        onSaved(`${draft.name.trim()} was saved, but: ${decided.error}`);
        return;
      }
    }
    announce('Organization saved.');
    onSaved();
  }

  return (
    <>
      <form
        ref={form}
        // Clear of Admin's sticky tabs when brought into view.
        className="mt-3 scroll-mt-20 rounded-[14px] border border-line bg-paper p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (saving || logoDraft.loading) return;
          setSaving(true);
          setError(null);
          void save().finally(() => {
            setSaving(false);
          });
        }}
      >
        <h3 ref={heading} tabIndex={-1} className="font-bold text-ink outline-none">
          {organization
            ? `Edit ${organization.name}`
            : request
              ? 'Review this organization'
              : 'Add organization'}
        </h3>
        <DraftStatus
          storage={storage}
          restored={restored}
          media={logoDraft.status}
          className="mt-1"
        />
        {asking ? (
          <p className="mt-1 text-[0.8125rem] text-ink2 leading-[1.45]">
            An administrator checks it before it is listed, and you will be told.
          </p>
        ) : null}
        <fieldset disabled={saving || logoDraft.loading} className="mt-2 grid gap-3">
          <div hidden={asking}>
            <p id="organization-logo-label" className="text-ink">
              Logo
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              {/* As the badge draws it: on white, kept whole rather than cropped. */}
              <span className="grid h-[66px] w-[66px] flex-none place-items-center overflow-hidden rounded-[14px] border border-line bg-white">
                {shown ? (
                  <img
                    src={shown}
                    alt={logo.kind === 'new' ? 'The logo you chose' : `${organization?.name} logo`}
                    className={cn(
                      'h-full w-full object-contain',
                      (logo.kind === 'new' ? newFills : logoFillsTile(organization?.logoPath))
                        ? 'p-0'
                        : 'p-1.5',
                    )}
                  />
                ) : (
                  <span className="font-extrabold font-head text-[0.875rem] text-grey">
                    {draft.shortCode || '—'}
                  </span>
                )}
              </span>
              <label className="flex min-h-[44px] cursor-pointer items-center rounded-lg border border-line px-4 font-bold text-ink focus-within:ring-2 focus-within:ring-emphasis">
                {shown ? 'Change logo' : 'Choose a logo'}
                <input
                  type="file"
                  // Not SVG: a drawing can carry script, and it is shown to
                  // every member.
                  accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
                  aria-describedby="organization-logo-hint"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
                      setError('Choose a PNG, JPEG or WebP picture.');
                      return;
                    }
                    setError(null);
                    setLogo({ kind: 'new', file });
                  }}
                />
              </label>
              {shown ? (
                <button
                  type="button"
                  onClick={() => {
                    setLogo(organization?.logoPath ? { kind: 'remove' } : { kind: 'keep' });
                  }}
                  className="min-h-[44px] rounded-lg px-3 font-bold text-destructive hover:bg-destructive/10"
                >
                  Remove logo
                </button>
              ) : logo.kind === 'remove' ? (
                <button
                  type="button"
                  onClick={() => {
                    setLogo({ kind: 'keep' });
                  }}
                  className="min-h-[44px] rounded-lg px-3 font-bold text-emphasis hover:bg-tint"
                >
                  Keep the logo
                </button>
              ) : null}
            </div>
            <span id="organization-logo-hint" className="mt-1 block text-[0.8125rem] text-grey">
              {logo.kind === 'remove'
                ? 'The logo comes off when you save. Its short code is shown instead.'
                : logo.kind === 'new'
                  ? 'Saved when you save the organization.'
                  : 'Shown on white beside its events. A square picture fits best.'}
            </span>
          </div>
          <label className="text-ink">
            Organization name
            <input
              className={field}
              required
              maxLength={300}
              value={draft.name}
              onChange={(event) => {
                setDraft({ ...draft, name: event.target.value });
              }}
            />
          </label>
          <label className="text-ink">
            Short code
            <input
              className={field}
              required
              minLength={2}
              maxLength={4}
              pattern="[A-Za-z]{2,4}"
              value={draft.shortCode}
              onChange={(event) => {
                setDraft({ ...draft, shortCode: event.target.value.toUpperCase() });
              }}
            />
            <span className="text-[0.8125rem] text-grey">Two to four letters for its badge.</span>
          </label>
          <label className="text-ink">
            Type
            <select
              className={field}
              required={!organization}
              value={draft.category ?? ''}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  category: (event.target.value || null) as OrganizationCategory | null,
                });
              }}
            >
              <option value="">Choose a type</option>
              {ORGANIZATION_CATEGORIES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
            <span className="text-[0.8125rem] text-grey">The colour of its pin on the map.</span>
          </label>
          {/* Cities suggested as it is typed (the owner, 2026-11-20); a region is typed. */}
          <AddressField
            kind="city"
            label="City or region"
            className={field}
            describedBy="organization-city-hint"
            maxLength={160}
            value={draft.city}
            onChange={(city) => {
              setDraft({ ...draft, city });
            }}
            onPick={(found) => {
              setDraft({ ...draft, city: found.city.slice(0, 160) });
            }}
          />
          <p id="organization-city-hint" className="-mt-2 text-[0.75rem] text-grey">
            Empty when its own site names no place.
          </p>
          <OrganizationLocations
            places={places}
            onChange={(next) => {
              setForm((current) => ({ ...current, places: next }));
            }}
          />
          <label className="text-ink">
            Description
            <textarea
              className={field}
              aria-describedby="organization-description-hint"
              rows={8}
              maxLength={4000}
              value={draft.description}
              onChange={(event) => {
                setDraft({ ...draft, description: event.target.value });
              }}
            />
          </label>
          <p id="organization-description-hint" className="-mt-2 text-[0.75rem] text-grey">
            **bold**, a line starting "- " for a list, and [words](https://…) for a link.
          </p>
          <label className="text-ink">
            Tags
            <input
              className={field}
              maxLength={972}
              value={tags}
              onChange={(event) => {
                const next = event.target.value;
                setForm((current) => ({ ...current, tags: next }));
              }}
            />
            <span className="text-[0.8125rem] text-grey">
              Up to twelve, separated by commas. Up to eighty characters each.
            </span>
          </label>
          {administrator ? (
            <label className="flex min-h-[44px] items-center gap-2 text-ink">
              <input
                type="checkbox"
                checked={draft.canInvite}
                onChange={(event) => {
                  setDraft({ ...draft, canInvite: event.target.checked });
                }}
              />
              Can vouch for members
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="min-h-[44px] rounded-lg bg-action px-4 font-bold text-white"
            >
              {saving
                ? 'Saving…'
                : asking
                  ? 'Send for approval'
                  : request
                    ? 'Approve and save'
                    : 'Save organization'}
            </button>
            <button
              type="button"
              onClick={() => {
                finish();
                logoDraft.clear();
                onCancel();
              }}
              className="min-h-[44px] rounded-lg border border-line px-4 font-bold text-ink"
            >
              {storage || logoDraft.status !== 'idle' ? 'Discard draft' : 'Cancel'}
            </button>
          </div>
        </fieldset>
      </form>
      {/* Its own forms, saved on their own: a grant is not part of Save organization. */}
      {organization ? (
        <OrganizationGrantsEditor
          organizationId={organization.id}
          organizationName={organization.name}
        />
      ) : null}
    </>
  );
}
