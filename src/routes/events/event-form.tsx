import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AddressField } from '@/components/address-field';
import { BackLink } from '@/components/back-link';
import { OrganizationPicker } from '@/components/organization-picker';
import { SegmentPills } from '@/components/segment-pills';
import { TwoWayToggle } from '@/components/two-way-toggle';
import { useAccount } from '@/lib/account';
import { useAnnounce } from '@/lib/announce';
import { EVENTS_ADDRESS } from '@/lib/calendar-invites';
import { memberDraftKey } from '@/lib/chat/drafts';
import { partsFromIso, readDate } from '@/lib/date-parts';
import { describeThrown } from '@/lib/describe-error';
import { fetchEventVisibility, setEventVisibility } from '@/lib/event-audience';
import {
  adminChangeImportedEvent,
  type CoverChange,
  type EventPhoto,
  type MorePhotoChange,
  makeEventRepeat,
  saveEvent,
  saveEventCover,
  saveEventSeries,
  saveMorePhotos,
  setEventMeetingLink,
  setEventPostalCode,
  useEvents,
} from '@/lib/events';
import { useFormDraft } from '@/lib/form-draft';
import { useMemberOrganizations } from '@/lib/organization-members';
import { useMyOrganizations } from '@/lib/organization-representatives';
import { useOrganizations } from '@/lib/organizations';
import { type PhotoTarget, pastePhotos } from '@/lib/paste-photos';
import { useDraftMedia } from '@/lib/use-draft-media';
import { OrganizationEditor } from '@/routes/admin/organization-editor';
import { DraftStatus } from '@/routes/chat/draft-status';
import {
  type AudienceChoice,
  AudienceField,
  audienceReady,
  sameAudience,
} from '@/routes/events/audience-field';
import { CoverField } from '@/routes/events/cover-field';
import { DescriptionEditor } from '@/routes/events/description-editor';
import {
  ACCESS_DETAILS_MAX,
  CITY_MAX,
  DESCRIPTION_MAX,
  describeRepeat,
  draftFromEvent,
  type EventDraft,
  emptyDraft,
  HOST_NAME_MAX,
  hostOptions,
  LOCATION_MAX,
  NO_ORGANIZATION,
  type RepeatChoice,
  type RepeatEnd,
  readDraft,
  readRepeat,
  readTime,
  repeatLabels,
  TITLE_MAX,
} from '@/routes/events/event-draft';
import { useMayChangeEvent } from '@/routes/events/may-change-event';
import { MorePicturesField } from '@/routes/events/more-pictures-field';
import type { Organization } from '@/types/domain';
import {
  EVENT_FORMAT_LABELS,
  EVENT_FORMATS,
  type EventAudience,
  type EventFormat,
  US_STATES,
} from '@/types/domain';

/**
 * Adding an event by hand, or changing one that was (the owner, 2026-10-05).
 *
 * For every member (the owner, 2026-11-23: "Let's allow all users to create
 * events"): an administrator for anyone, a member who speaks for an
 * organization for it (20261005010000), and any member in their own name, as
 * "Hosted by" (20261123130000). `save_event` decides; this only draws.
 *
 * Times are typed in Pacific and the form says so: a hand-added event has no
 * feed to say what zone it is in, and every organization the club has is in
 * California (lib/events.ts, HAND_ADDED_TIMEZONE). The owner chose the
 * phone/browser calendar for the date (2026-10-06); times remain typed.
 *
 * What is missing is said under the button before it is pressed, one thing
 * at a time in the order the form asks, rather than as a wall of red after.
 */
export default function EventFormPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sent, setSent] = useState<string | null>(null);
  const account = useAccount();
  const memberId = account.status === 'member' ? account.userId : null;
  const mine = useMyOrganizations(memberId);
  // Listed first, with a search for the rest (the owner, 2026-11-05).
  const memberOf = useMemberOrganizations(memberId ?? undefined);
  const { organizations, loading: organizationsLoading } = useOrganizations();
  const { events, loading: eventsLoading } = useEvents({
    id: id ?? '00000000-0000-0000-0000-000000000000',
  });
  const existing = id ? (events.find((event) => event.id === id) ?? null) : null;
  const changeable = useMayChangeEvent(
    existing,
    account.status === 'member',
    account.isAdmin,
    mine.ids,
  );

  if (
    account.status === 'loading' ||
    mine.loading ||
    organizationsLoading ||
    (id && eventsLoading) ||
    !changeable.known
  ) {
    return (
      <p role="status" className="px-6 py-10 text-center text-[0.875rem] text-grey">
        Loading…
      </p>
    );
  }
  // Not the permission check — the database refuses either way. Every member
  // may add an event, or ask to add an organization.
  if (account.status !== 'member') return <Navigate to="/events" replace />;

  if (id && !existing) {
    return (
      <p className="px-6 py-10 text-center text-[0.875rem] text-ink2">
        This event is not on the calendar any more.
      </p>
    );
  }
  if (existing && !changeable.may) {
    return <Navigate to={`/events/${existing.id}`} replace />;
  }

  const options = hostOptions(organizations, account.isAdmin, mine.ids);
  // Both are offered to whoever can do both. The event's form stays underneath
  // the organization's, so looking at one loses nothing typed in the other.
  const addingOrganization = !id && searchParams.get('add') === 'organization';
  const kindToggle = !id ? (
    <div className="mt-2">
      <TwoWayToggle
        label="What to add"
        options={ADD_KINDS}
        value={addingOrganization ? 'organization' : 'event'}
        onChange={(next) => {
          setSearchParams(next === 'organization' ? { add: next } : {}, { replace: true });
        }}
      />
    </div>
  ) : null;
  const eventForm = (
    <EventForm
      // A different event is a different form, not this one's state carried over.
      key={`${memberId}:${existing?.id ?? 'new'}`}
      draftKey={existing ? undefined : memberDraftKey(memberId, 'new-event')}
      hidden={addingOrganization}
      top={kindToggle}
      eventId={existing?.id ?? null}
      initial={
        existing
          ? draftFromEvent(existing)
          : (() => {
              // A member who speaks for no organization hosts it themselves,
              // under their own name until they type another.
              if (!account.isAdmin && options.length === 0) {
                return { ...emptyDraft(NO_ORGANIZATION), hostName: account.displayName ?? '' };
              }
              const onlyHost =
                !account.isAdmin && options.length === 1 ? (options[0]?.id ?? null) : null;
              const host = organizations.find((o) => o.id === onlyHost);
              return emptyDraft(onlyHost, host?.state ?? '');
            })()
      }
      initialCover={{ path: existing?.photoPath ?? null, alt: existing?.photoAlt ?? '' }}
      initialMore={existing?.morePhotos ?? []}
      // A new event has a public page unless its organizer says otherwise
      // (the owner, 2026-10-22).
      initialAudience={existing?.audience ?? 'club'}
      initialFailure={coverFailureFrom(location.state)}
      imported={
        existing && !existing.handAdded
          ? {
              changed: existing.adminChanged,
              calendar: existing.calendarValues ?? {},
              timezone: existing.timezone,
            }
          : null
      }
      isAdmin={account.isAdmin}
      // A one-off added by hand, not started yet, can be made to repeat
      // (the owner, 2026-11-06).
      mayRepeat={
        !!existing &&
        existing.handAdded &&
        existing.seriesId === null &&
        Date.parse(existing.startTime) > Date.now()
      }
      options={options}
      yours={new Set([...mine.ids, ...memberOf])}
      adminOf={mine.ids}
    />
  );
  return (
    <>
      {addingOrganization ? (
        <div className="flex-1 overflow-y-auto px-4 py-3 md:px-6">
          <div className="mx-auto w-full max-w-[720px] pb-6">
            <BackLink to="/events?segment=orgs" label="Organizations" />
            {kindToggle}
            {sent ? (
              <p role="status" className="mt-4 text-[0.9375rem] text-ink leading-[1.5]">
                {sent}
              </p>
            ) : (
              <OrganizationEditor
                key={memberId}
                draftKey={memberDraftKey(memberId, 'new-organization')}
                organization={null}
                administrator={account.isAdmin}
                onCancel={() => {
                  void navigate('/events?segment=orgs');
                }}
                onSaved={(warning) => {
                  if (warning) setSent(warning);
                  else if (account.isAdmin)
                    void navigate('/events?segment=orgs', { replace: true });
                  else setSent('Sent. An administrator will look at it, and you will be told.');
                }}
              />
            )}
          </div>
        </div>
      ) : null}
      {eventForm}
    </>
  );
}

const ADD_KINDS = [
  ['event', 'Event'],
  ['organization', 'Organization'],
] as const;

/** The message a save left for the form it reopened, if it left one. */
function coverFailureFrom(state: unknown): string | null {
  const said = (state as { coverFailure?: unknown } | null)?.coverFailure;
  return typeof said === 'string' ? said : null;
}

/** A field's look without its width or spacing, for the boxes that sit in a row. */
const BOX =
  'min-h-[44px] rounded-[12px] border-[1.6px] border-line bg-paper px-3.5 py-2.5 text-[0.9375rem] text-ink outline-none focus:border-emphasis';
const FIELD = `mt-1.5 w-full ${BOX}`;
const LABEL = 'mt-4 block font-bold font-head text-[0.8125rem] text-ink';
const HINT = 'mt-1 text-[0.71875rem] text-grey leading-[1.45]';

interface EventDraftPhotos {
  cover: CoverChange;
  more: MorePhotoChange[];
}

function hasEventDraftPhotos({ cover, more }: EventDraftPhotos) {
  return cover.kind === 'new' || more.some((photo) => photo.kind === 'new');
}

function EventForm({
  eventId,
  draftKey,
  initial,
  initialCover,
  initialMore,
  initialAudience,
  initialFailure,
  imported,
  isAdmin,
  mayRepeat,
  options,
  yours,
  adminOf,
  hidden,
  top,
}: {
  /** Kept mounted while its other half is showing (the page above). */
  hidden: boolean;
  /** Under the way back: the choice of what to add. */
  top: React.ReactNode;
  /**
   * An event from an organization's calendar, changed by an administrator
   * (20261012060000): what is already changed, and what the calendar says
   * for those fields. Null for an event added in the club.
   */
  imported: { changed: string[]; calendar: Record<string, unknown>; timezone: string } | null;
  eventId: string | null;
  draftKey: string | undefined;
  initial: EventDraft;
  /** The picture the event has, and its words, before anything is changed. */
  initialCover: { path: string | null; alt: string };
  initialMore: EventPhoto[];
  /** Who can see it before anything is changed (20261022180000). */
  initialAudience: EventAudience;
  /** A picture that did not go up when the event was saved, said on arrival. */
  initialFailure: string | null;
  isAdmin: boolean;
  /** Changing a one-off that may be made to repeat. */
  mayRepeat: boolean;
  options: Organization[];
  /** The organizations they run or belong to, listed first. */
  yours: Set<string>;
  /** The organizations they are an org admin of: whose members an event can be for. */
  adminOf: Set<string>;
}) {
  const navigate = useNavigate();
  const announce = useAnnounce();
  const photoDraft = useDraftMedia<EventDraftPhotos>(
    draftKey,
    () => ({
      cover: { kind: 'keep', ...initialCover },
      more: initialMore.map((photo) => ({ kind: 'keep', ...photo })),
    }),
    hasEventDraftPhotos,
  );
  const { cover, more } = photoDraft.value;
  // An old event for its host's followers reads as that one organization.
  const startingAudience: AudienceChoice = {
    audience: initialAudience === 'followers' ? 'organizations' : initialAudience,
    groups: [],
    organizations: initialAudience === 'followers' && initial.host ? [initial.host] : [],
    people: [],
  };
  const {
    value: { fields: draft, audience, stateChosen },
    setValue: setForm,
    storage,
    restored,
    discard,
    finish,
  } = useFormDraft(draftKey, () => ({
    fields: initial,
    audience: startingAudience,
    stateChosen: false,
  }));
  const [initialChoice, setInitialChoice] = useState<AudienceChoice>(startingAudience);
  // Which groups, organizations or people it is for, read for the organizer who changes it.
  useEffect(() => {
    if (!eventId || initialAudience === 'club') return;
    let cancelled = false;
    void fetchEventVisibility(eventId).then((result) => {
      if (cancelled || !result.ok || !result.value) return;
      const read = result.value;
      const loaded: AudienceChoice = {
        audience: read.audience === 'followers' ? 'organizations' : read.audience,
        groups: read.groups ?? [],
        organizations:
          read.audience === 'followers' && initial.host
            ? [initial.host]
            : read.organizations.map((o) => o.id),
        people: (read.invitees ?? []).map((m) => ({ ...m, photoAlt: null })),
      };
      setInitialChoice(loaded);
      setForm((current) => ({ ...current, audience: loaded }));
    });
    return () => {
      cancelled = true;
    };
  }, [eventId, initialAudience, initial.host, setForm]);
  // A picture pasted into the description becomes the cover (lib/paste-photos.ts).
  const coverTarget = useRef<PhotoTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(initialFailure);
  const isNew = eventId === null;

  // Read once per keystroke; cheap, and the button and the line under it
  // cannot disagree about what is missing.
  const reading = useMemo(() => readDraft(draft, { isNew, mayRepeat }), [draft, isNew, mayRepeat]);
  const dateReading = readDate(draft.date, { needs: 'day', future: true });
  const dateIso = dateReading.kind === 'date' ? dateReading.iso : null;
  const startReading = readTime(draft.startTime);
  const endReading = readTime(draft.endTime);

  const directory = useOrganizations().organizations;
  const stateOfHost = (id: string) => directory.find((o) => o.id === id)?.state ?? null;

  function set<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    setForm((current) => ({ ...current, fields: { ...current.fields, [key]: value } }));
    // A failure is about what was sent; once the form changes it no longer is.
    setFailure(null);
  }

  function chooseState(state: string) {
    setForm((current) => ({ ...current, stateChosen: true, fields: { ...current.fields, state } }));
    setFailure(null);
  }

  // Whether saving has anything to do to the picture: a new one, taking one
  // off, or new words for the one it has.
  const coverChanged =
    cover.kind === 'new' ||
    (cover.kind === 'remove' && initialCover.path !== null) ||
    (cover.kind === 'keep' && cover.path !== null && cover.alt !== initialCover.alt);

  const moreChanged =
    more.length !== initialMore.length ||
    more.some((item, index) => {
      const was = initialMore[index];
      return item.kind === 'new' || item.path !== was?.path || item.alt !== was.alt;
    });

  // Whose members it can be for: the organizations they are an org admin of,
  // and for a club administrator the host too.
  const audienceOrganizations = options
    .filter((o) => adminOf.has(o.id) || (isAdmin && o.id === draft.host))
    .map((o) => ({ id: o.id, name: o.name, open: o.joinsNeedApproval !== true }));
  const chosenAudience = audience;
  const audienceChanged = isNew || !sameAudience(chosenAudience, initialChoice);
  const meetingChanged = reading.ok && reading.meetingUrl !== initial.meetingUrl.trim();
  // An imported event's ZIP code is its calendar's.
  const postalChanged = !imported && reading.ok && reading.postalCode !== initial.postalCode.trim();

  function submit() {
    if (!reading.ok || saving || photoDraft.loading || !audienceReady(chosenAudience)) return;
    setSaving(true);
    const repeat = reading.repeat;
    const accessDetails = draft.accessDetails.trim();
    const payload =
      accessDetails === initial.accessDetails.trim()
        ? reading.payload
        : { ...reading.payload, accessDetails };
    void (async () => {
      const result =
        repeat && isNew
          ? await saveEventSeries(payload, repeat)
          : imported && eventId
            ? await adminChangeImportedEvent(eventId, payload)
            : await saveEvent({ id: eventId, ...payload });
      if (!result.ok) {
        setFailure(result.error);
        return;
      }
      finish();
      if (draftKey) photoDraft.clear();
      // The picture after the event, because it is filed under the event's
      // id. The event is saved either way; a picture that did not go up
      // reopens this form on the saved event, saying so, rather than leaving
      // a filled-in "add" form that would add the event a second time.
      if (coverChanged) {
        const saved = await saveEventCover(result.id, cover);
        if (!saved.ok) {
          void navigate(`/events/${result.id}/edit`, {
            replace: true,
            state: { coverFailure: `The event is saved. ${saved.error}` },
          });
          return;
        }
      }
      if (moreChanged) {
        const saved = await saveMorePhotos(result.id, more);
        if (!saved.ok) {
          void navigate(`/events/${result.id}/edit`, {
            replace: true,
            state: { coverFailure: `The event is saved. ${saved.error}` },
          });
          return;
        }
      }
      if (meetingChanged) {
        const saved = await setEventMeetingLink(result.id, reading.meetingUrl);
        if (!saved.ok) {
          void navigate(`/events/${result.id}/edit`, {
            replace: true,
            state: { coverFailure: `The event is saved. ${saved.error}` },
          });
          return;
        }
      }
      if (postalChanged) {
        const saved = await setEventPostalCode(result.id, reading.postalCode);
        if (!saved.ok) {
          void navigate(`/events/${result.id}/edit`, {
            replace: true,
            state: { coverFailure: `The event is saved. ${saved.error}` },
          });
          return;
        }
      }
      if (audienceChanged) {
        const saved = await setEventVisibility(result.id, {
          audience: chosenAudience.audience,
          groups: chosenAudience.groups,
          organizations: chosenAudience.organizations,
          people: chosenAudience.people.map((p) => p.id),
        });
        if (!saved.ok) {
          void navigate(`/events/${result.id}/edit`, {
            replace: true,
            state: { coverFailure: `The event is saved. ${saved.error}` },
          });
          return;
        }
      }
      // Last, so the dates it makes take this one's picture, link and audience.
      if (repeat && !isNew) {
        const made = await makeEventRepeat(result.id, repeat);
        if (!made.ok) {
          void navigate(`/events/${result.id}/edit`, {
            replace: true,
            state: { coverFailure: `The changes are saved. ${made.error}` },
          });
          return;
        }
      }
      announce(
        repeat && !isNew
          ? 'Changes saved, and its dates are on the calendar.'
          : !isNew
            ? 'Changes saved.'
            : repeat
              ? 'The event and its dates are on the calendar.'
              : 'The event is on the calendar.',
      );
      // Replacing this screen: Back from the event should not land on a
      // filled-in form that would add it a second time.
      void navigate(`/events/${result.id}`, { replace: true });
    })()
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'The event was not saved.'));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  // A member who speaks for no organization has nothing to choose: they host it
  // themselves (20261123130000). Everyone else may also host in no organization's
  // name. The calendar invitation is an organization's, so it is offered with them.
  const pickHost = isAdmin || options.length > 0;

  return (
    <div hidden={hidden} className="flex-1 overflow-y-auto px-4 py-3 md:px-6">
      <div className="mx-auto w-full max-w-[720px] pb-6">
        <BackLink
          to={eventId ? `/events/${eventId}` : '/events'}
          label={eventId ? 'Event' : 'Events'}
        />
        {top}

        <h1 className="mt-1 font-extrabold font-head text-[1.25rem] text-ink tracking-[-0.01em]">
          {isNew ? 'Add an event' : 'Change this event'}
        </h1>
        <p className="mt-1 text-[0.78125rem] text-grey leading-[1.45]">
          {isNew ? 'It goes on the calendar as soon as you add it. ' : ''}
          Who can see it is chosen below.
        </p>
        {storage || photoDraft.status !== 'idle' ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3">
            <DraftStatus storage={storage} restored={restored} media={photoDraft.status} />
            <button
              type="button"
              disabled={saving || photoDraft.loading}
              className="min-h-11 font-semibold text-[0.8125rem] text-emphasis underline disabled:opacity-50"
              onClick={() => {
                discard();
                photoDraft.clear();
                setFailure(null);
              }}
            >
              Discard draft
            </button>
          </div>
        ) : null}
        {/* The other way in (20261022220000): an invitation from the
            organization's own calendar. */}
        {isNew && pickHost ? (
          <p className="mt-2 rounded-[11px] bg-tint px-3 py-2.5 text-[0.8125rem] text-ink2 leading-[1.45]">
            Or invite <b className="text-ink">{EVENTS_ADDRESS}</b> to the event in Google, Outlook
            or Apple Calendar, and it is added here, and kept up to date when you change it there.
          </p>
        ) : null}
        {imported ? <ImportedNote imported={imported} options={options} /> : null}

        {/* ------------------------------------------------------ host */}
        {pickHost ? (
          <OrganizationPicker
            id="event-host"
            label="Who is hosting it?"
            labelClassName={LABEL}
            yours={options.filter((o) => yours.has(o.id))}
            others={options}
            value={draft.host}
            onChange={(host) => {
              set('host', host);
              // The state follows the host until somebody chooses one.
              if (!stateChosen) {
                set('state', stateOfHost(host) ?? draft.state);
              }
            }}
            placeholder="Choose…"
            none="No organization — self or community hosted"
            noneValue={NO_ORGANIZATION}
            className={FIELD}
          />
        ) : null}

        {draft.host === NO_ORGANIZATION ? (
          <>
            <label htmlFor="event-host-name" className={LABEL}>
              Hosted by
            </label>
            <input
              id="event-host-name"
              value={draft.hostName}
              maxLength={HOST_NAME_MAX}
              onChange={(e) => {
                set('hostName', e.target.value);
              }}
              placeholder={isAdmin ? 'The SCI Club' : 'Your name, or your group’s'}
              className={FIELD}
            />
            <p className={HINT}>
              {isAdmin
                ? 'Shown under "Hosted by" on the event.'
                : 'Your name, or whoever is putting it on. Shown on the event.'}
            </p>
          </>
        ) : null}

        {/* ------------------------------------------------------ what */}
        <label htmlFor="event-title" className={LABEL}>
          What is it called?
        </label>
        <input
          id="event-title"
          value={draft.title}
          maxLength={TITLE_MAX}
          onChange={(e) => {
            set('title', e.target.value);
          }}
          placeholder="Picnic at Lake Merritt"
          className={FIELD}
        />

        {/* ------------------------------------------------------ when */}
        <label htmlFor="event-date" className={LABEL}>
          What day?
        </label>
        <input
          id="event-date"
          type="date"
          min="1900-01-01"
          max="9999-12-31"
          value={dateReading.kind === 'date' ? dateReading.iso : ''}
          onChange={(e) => {
            // Keep the calendar's day as written, without a UTC conversion
            // that could move it to yesterday in Pacific time.
            set('date', partsFromIso(e.target.value));
          }}
          className={FIELD}
        />

        <div className="mt-1 flex flex-wrap gap-2.5">
          <div className="min-w-[9em] flex-1">
            <label htmlFor="event-start" className={LABEL}>
              Starts
            </label>
            <input
              id="event-start"
              value={draft.startTime}
              onChange={(e) => {
                set('startTime', e.target.value);
              }}
              placeholder="6:30 pm"
              aria-describedby="event-time-hint"
              aria-invalid={startReading.kind === 'invalid' ? true : undefined}
              className={FIELD}
            />
          </div>
          <div className="min-w-[9em] flex-1">
            <label htmlFor="event-end" className={LABEL}>
              Ends (optional)
            </label>
            <input
              id="event-end"
              value={draft.endTime}
              onChange={(e) => {
                set('endTime', e.target.value);
              }}
              placeholder="8 pm"
              aria-describedby="event-time-hint"
              aria-invalid={endReading.kind === 'invalid' ? true : undefined}
              className={FIELD}
            />
          </div>
        </div>
        <p id="event-time-hint" className={HINT}>
          Pacific time, with am or pm.
        </p>

        {/* --------------------------------------------------- repeats */}
        {isNew || mayRepeat ? <RepeatFields draft={draft} dateIso={dateIso} set={set} /> : null}

        {/* ----------------------------------------------------- where */}
        {/* A paragraph and not a label: three aria-pressed buttons rather than
            one field, as on Start a room. */}
        <p className={LABEL}>In person or online?</p>
        <SegmentPills<EventFormat | ''>
          segments={EVENT_FORMATS.map((f) => [f, EVENT_FORMAT_LABELS[f]] as const)}
          value={draft.format ?? ''}
          onChange={(next) => {
            set('format', next === '' ? null : next);
          }}
          className="flex-wrap"
        />

        {/* Addresses suggested as it is typed, as on an organization's locations. */}
        <AddressField
          label={
            <span className="mt-1 block font-bold font-head text-[0.8125rem]">
              {draft.format === 'online' ? 'Where (optional)' : 'Where'}
            </span>
          }
          value={draft.location}
          maxLength={LOCATION_MAX}
          suggest={draft.format !== 'online'}
          onChange={(location) => {
            set('location', location);
          }}
          onPick={(found) => {
            const where = found.name ? `${found.name}, ${found.street}` : found.street;
            set('location', where.slice(0, LOCATION_MAX));
            set('city', found.city.slice(0, CITY_MAX));
            if (found.postalCode) set('postalCode', found.postalCode);
            // A picked place's state is a choice: the host no longer moves it.
            chooseState(found.state);
          }}
          placeholder={draft.format === 'online' ? 'On Zoom' : 'Lakeside Park, 666 Bellevue Ave'}
          className={FIELD}
        />

        {/* The owner, 2026-11-06: the call's own link, and a Join button for it. */}
        {draft.format === 'online' || draft.format === 'hybrid' ? (
          <>
            <label htmlFor="event-meeting" className={LABEL}>
              Video call link (optional)
            </label>
            <input
              id="event-meeting"
              type="url"
              inputMode="url"
              value={draft.meetingUrl}
              onChange={(e) => {
                set('meetingUrl', e.target.value);
              }}
              placeholder="https://zoom.us/j/…"
              aria-describedby="event-meeting-hint"
              className={FIELD}
            />
            <p id="event-meeting-hint" className={HINT}>
              Zoom, Google Meet, Teams or any other call. The event shows a Join online button for
              it.
            </p>
          </>
        ) : null}

        {/* Cities suggested as it is typed (the owner, 2026-11-20). */}
        <AddressField
          kind="city"
          label={<span className={LABEL}>City (optional)</span>}
          value={draft.city}
          maxLength={CITY_MAX}
          onChange={(city) => {
            set('city', city);
          }}
          onPick={(found) => {
            set('city', found.city.slice(0, CITY_MAX));
            // A picked city's state is a choice: the host no longer moves it.
            chooseState(found.state);
          }}
          placeholder="Oakland"
          describedBy="event-city-hint"
          className={FIELD}
        />
        <p id="event-city-hint" className={HINT}>
          So members can find it by place.
        </p>

        {/* The owner, 2026-11-20: optional, and a picked address fills it. */}
        {draft.format !== 'online' ? (
          <>
            <label htmlFor="event-zip" className={LABEL}>
              ZIP code (optional)
            </label>
            <input
              id="event-zip"
              value={draft.postalCode}
              maxLength={10}
              inputMode="numeric"
              autoComplete="postal-code"
              onChange={(e) => {
                set('postalCode', e.target.value);
              }}
              placeholder="94404"
              className={FIELD}
            />
          </>
        ) : null}

        <label htmlFor="event-state" className={LABEL}>
          State
        </label>
        <select
          id="event-state"
          value={draft.state}
          onChange={(e) => {
            chooseState(e.target.value);
          }}
          aria-describedby="event-state-hint"
          className={FIELD}
        >
          <option value="">Choose a state</option>
          {US_STATES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
        <p id="event-state-hint" className={HINT}>
          Where it happens, if not where its host is. Its address is looked up there.
        </p>

        {/* ----------------------------------------------------- about */}
        <label htmlFor="event-description" className={LABEL}>
          About it (optional)
        </label>
        <DescriptionEditor
          id="event-description"
          mentions
          value={draft.description}
          maxLength={DESCRIPTION_MAX}
          onChange={(next) => {
            set('description', next);
          }}
          placeholder="What happens, who it is for, and what to bring."
          hintClassName={HINT}
          onPaste={(event) => {
            pastePhotos(event, coverTarget.current);
          }}
        />

        <label htmlFor="event-access-details" className={LABEL}>
          Accessibility (optional)
        </label>
        <p id="event-access-hint" className={HINT}>
          {draft.format === 'online'
            ? 'Share what you know about captions, dial-in, or how to request accommodations.'
            : draft.format === 'hybrid'
              ? 'Share what you know about step-free access, restrooms, parking, captions, or how to request accommodations.'
              : 'Share what you know about step-free entrances, accessible restrooms, parking or drop-off, and how to request accommodations.'}
        </p>
        <textarea
          id="event-access-details"
          aria-describedby="event-access-hint"
          className={FIELD}
          rows={3}
          maxLength={ACCESS_DETAILS_MAX}
          value={draft.accessDetails}
          onChange={(event) => {
            set('accessDetails', event.target.value);
          }}
        />

        {/* ----------------------------------------------------- cover */}
        {/* On an imported event too, for an administrator (20261012070000);
            the import never writes the cover, so it stays. */}
        <CoverField
          ref={coverTarget}
          value={cover}
          onChange={(next) => {
            photoDraft.setValue((current) => ({ ...current, cover: next }));
            setFailure(null);
          }}
          labelClassName={LABEL}
          hintClassName={HINT}
          fieldClassName={FIELD}
        />
        <MorePicturesField
          value={more}
          onChange={(next) => {
            photoDraft.setValue((current) => ({ ...current, more: next }));
            setFailure(null);
          }}
          labelClassName={LABEL}
          hintClassName={HINT}
          fieldClassName={FIELD}
        />

        <AudienceField
          value={chosenAudience}
          onChange={(next) => {
            setForm((current) => ({ ...current, audience: next }));
            setFailure(null);
          }}
          organizations={audienceOrganizations}
          labelClassName={LABEL}
          hintClassName={HINT}
        />

        <label htmlFor="event-registration" className={LABEL}>
          Sign-up link (optional)
        </label>
        <input
          id="event-registration"
          type="url"
          inputMode="url"
          value={draft.registrationUrl}
          onChange={(e) => {
            set('registrationUrl', e.target.value);
          }}
          placeholder="https://"
          className={FIELD}
        />

        <label htmlFor="event-url" className={LABEL}>
          More details at (optional)
        </label>
        <input
          id="event-url"
          type="url"
          inputMode="url"
          value={draft.url}
          onChange={(e) => {
            set('url', e.target.value);
          }}
          placeholder="https://"
          aria-describedby="event-url-hint"
          className={FIELD}
        />
        <p id="event-url-hint" className={HINT}>
          The event shows one button: Register if there is a sign-up link, otherwise this.
        </p>

        {failure ? (
          <p
            role="alert"
            className="mt-4 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
          >
            {failure} What you wrote is still here.
          </p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={!reading.ok || saving || photoDraft.loading || !audienceReady(chosenAudience)}
          aria-describedby={reading.ok ? undefined : 'event-missing'}
          className="mt-4 flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-gold font-bold font-head text-on-gold text-[0.9375rem] transition-colors hover:bg-gold-hi disabled:opacity-40 disabled:hover:bg-gold"
        >
          {saving ? 'Saving…' : isNew ? 'Add the event' : 'Save changes'}
        </button>
        {reading.ok ? null : (
          <p id="event-missing" className="mt-2 text-center text-[0.78125rem] text-grey">
            {reading.problem}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * "Repeats", after Google Calendar (the owner, 2026-10-10): a dropdown that
 * starts at Does not repeat, with Daily, Weekly on <the weekday>, Monthly on
 * <the nth weekday> and Custom. Custom is every N days, weeks or months,
 * ending never, on a date, or after a number of dates.
 *
 * On the page rather than in a pop-up, as the rest of this form is: one more
 * layer is one more thing to dismiss with a switch or at large text, and the
 * choice is read back in a sentence underneath before anything is saved.
 *
 * A native select, as the host is: every phone draws its own picker for it.
 */
function RepeatFields({
  draft,
  dateIso,
  set,
}: {
  draft: EventDraft;
  dateIso: string | null;
  set: <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => void;
}) {
  const labels = repeatLabels(dateIso);
  const choices: RepeatChoice[] = ['none', 'daily', 'weekly', 'monthly', 'custom'];
  const reading = dateIso ? readRepeat(draft, dateIso) : null;
  const custom = draft.repeat === 'custom';

  return (
    <>
      <label htmlFor="event-repeat" className={LABEL}>
        Repeats
      </label>
      <select
        id="event-repeat"
        value={draft.repeat}
        onChange={(e) => {
          set('repeat', e.target.value as RepeatChoice);
        }}
        aria-describedby={draft.repeat === 'none' ? undefined : 'event-repeat-summary'}
        className={FIELD}
      >
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {labels[choice]}
          </option>
        ))}
      </select>

      {custom ? (
        <div className="mt-2.5 rounded-[13px] border border-line bg-tint/40 px-3.5 pt-0.5 pb-3.5">
          <p className={LABEL} id="event-repeat-every-label">
            Repeats every
          </p>
          <div className="mt-1.5 flex gap-2.5">
            <input
              id="event-repeat-every"
              inputMode="numeric"
              value={draft.repeatEvery}
              onChange={(e) => {
                set('repeatEvery', e.target.value);
              }}
              aria-labelledby="event-repeat-every-label"
              className={`${BOX} w-[5em] flex-none text-center`}
            />
            <select
              value={draft.repeatUnit}
              onChange={(e) => {
                set('repeatUnit', e.target.value as EventDraft['repeatUnit']);
              }}
              aria-label="Days, weeks or months"
              className={`${BOX} min-w-0 flex-1`}
            >
              <option value="day">{draft.repeatEvery.trim() === '1' ? 'day' : 'days'}</option>
              <option value="week">{draft.repeatEvery.trim() === '1' ? 'week' : 'weeks'}</option>
              <option value="month">{draft.repeatEvery.trim() === '1' ? 'month' : 'months'}</option>
            </select>
          </div>

          <fieldset className="mt-1">
            <legend className={LABEL}>Ends</legend>
            <EndChoice value="never" draft={draft} set={set}>
              Never
            </EndChoice>
            <EndChoice value="on" draft={draft} set={set}>
              On
              <input
                type="date"
                aria-label="Last date"
                min={dateIso ?? undefined}
                value={draft.repeatUntil}
                onFocus={() => {
                  set('repeatEnd', 'on');
                }}
                onChange={(e) => {
                  set('repeatUntil', e.target.value);
                  set('repeatEnd', 'on');
                }}
                className={`${BOX} ml-1 min-w-0 flex-1`}
              />
            </EndChoice>
            <EndChoice value="after" draft={draft} set={set}>
              After
              <input
                inputMode="numeric"
                aria-label="Number of dates"
                value={draft.repeatCount}
                onFocus={() => {
                  set('repeatEnd', 'after');
                }}
                onChange={(e) => {
                  set('repeatCount', e.target.value);
                  set('repeatEnd', 'after');
                }}
                className={`${BOX} mx-1 w-[5em] flex-none text-center`}
              />
              dates
            </EndChoice>
          </fieldset>
        </div>
      ) : null}

      {draft.repeat !== 'none' ? (
        <p id="event-repeat-summary" className={HINT}>
          {!dateIso
            ? 'Choose the first date above, and the repeat follows from it.'
            : reading?.ok && reading.rule
              ? describeRepeat(reading.rule, dateIso)
              : reading && !reading.ok
                ? reading.problem
                : null}
        </p>
      ) : null}
    </>
  );
}

/** One "Ends" radio, with whatever goes beside its words. */
function EndChoice({
  value,
  draft,
  set,
  children,
}: {
  value: RepeatEnd;
  draft: EventDraft;
  set: <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="mt-2 flex min-h-[44px] items-center gap-2.5 text-[0.9375rem] text-ink">
      <input
        type="radio"
        name="event-repeat-end"
        value={value}
        checked={draft.repeatEnd === value}
        onChange={() => {
          set('repeatEnd', value);
        }}
        className="h-[1.15em] w-[1.15em] flex-none accent-emphasis"
      />
      {children}
    </label>
  );
}

/** What each overridable field is called in this form. */
const FIELD_NAMES: Record<string, string> = {
  title: 'Name',
  description: 'About it',
  start_time: 'Starts',
  end_time: 'Ends',
  location: 'Where',
  city: 'City',
  url: 'More details at',
  registration_url: 'Sign-up link',
  event_format: 'In person or online',
  organization_id: 'Host',
  host_name: 'Host',
};

/**
 * The note on an imported event's form (20261012060000): what changing it
 * does, and, for each field already changed here, what the organization's
 * calendar says now — which can differ from when it was changed, since the
 * import keeps that value current.
 */
function ImportedNote({
  imported,
  options,
}: {
  imported: { changed: string[]; calendar: Record<string, unknown>; timezone: string };
  options: { id: string; name: string }[];
}) {
  const lines = imported.changed
    // One line for the host however it was changed.
    .filter((field) => !(field === 'host_name' && imported.changed.includes('organization_id')))
    .map((field) => ({
      field,
      name: FIELD_NAMES[field] ?? field,
      says: calendarSays(field, imported.calendar, imported.timezone, options),
    }));
  return (
    <div className="mt-3 rounded-[13px] border border-line bg-tint/40 px-3.5 py-3 text-[0.8125rem] text-ink2 leading-[1.5]">
      <p>
        This event comes from the organization's own calendar. What you change here stays when the
        calendar updates each night; anything you leave alone keeps updating from it.
      </p>
      {lines.length > 0 ? (
        <>
          <p className="mt-2 font-bold text-ink">Changed here already — the calendar says:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {lines.map((line) => (
              <li key={line.field}>
                {line.name}: <span className="text-ink">{line.says}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5">To go back to the calendar's version, use Revert on the event.</p>
        </>
      ) : null}
    </div>
  );
}

/** One calendar value, as the form would show it. */
function calendarSays(
  field: string,
  calendar: Record<string, unknown>,
  timezone: string,
  options: { id: string; name: string }[],
): string {
  const value = calendar[field];
  if (field === 'organization_id' || field === 'host_name') {
    const org = typeof calendar.organization_id === 'string' ? calendar.organization_id : null;
    const named = options.find((o) => o.id === org)?.name;
    const host = typeof calendar.host_name === 'string' ? calendar.host_name : null;
    return named ?? host ?? 'no host';
  }
  // Every field kept is text in the JSON (times as ISO strings).
  if (typeof value !== 'string' || value === '') return 'nothing';
  if (field === 'start_time' || field === 'end_time') {
    return new Date(value).toLocaleString('en-US', {
      timeZone: timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  if (field === 'event_format') {
    return EVENT_FORMAT_LABELS[value as EventFormat];
  }
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `“${text.slice(0, 79)}…”` : `“${text}”`;
}
