import { Camera, Check } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { attachmentProblem } from '@/lib/chat/attachments';
import { handPhotos, memberDraftKey, readDraft, writeDraft } from '@/lib/chat/drafts';
import { joinEventGroup } from '@/lib/chat/groups';
import { messageAboutMissedCheckIn, useMyCheckIn } from '@/lib/check-ins';

/**
 * "Check in" (the owner, 2026-10-30; 20261030000000), on the event's page
 * around the event and on the page a printed QR code opens. Saying so
 * when it makes somebody an organization's member, with the way to leave.
 */
/** The same button, unlit, until an hour before the event (the owner, 2026-10-31). */
export function CheckInNotYet() {
  return (
    <div className="mt-5">
      <button
        type="button"
        disabled
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[13px] bg-line font-bold font-head text-[0.9375rem] text-ink2"
      >
        I'm here: check in
      </button>
      <p className="mt-2 text-center text-[0.8125rem] text-ink2 leading-[1.45]">
        Check-in opens an hour before the event.
      </p>
    </div>
  );
}

export function CheckInCard({
  eventId,
  eventTitle,
  memberId,
  organizationId,
  hostName = null,
}: {
  eventId: string;
  eventTitle: string;
  memberId: string | null;
  organizationId: string | null;
  /** The organization putting the event on, its primary host, named in the selfie ask. */
  hostName?: string | null;
}) {
  const { checkedIn, joined, busy, error, checkIn } = useMyCheckIn(eventId, memberId);

  if (checkedIn) {
    return (
      <div role="status" className="mt-5 rounded-[14px] border border-line bg-paper p-3.5">
        <p className="flex items-center gap-2 font-bold text-[0.9375rem] text-ink">
          <Check className="h-[18px] w-[18px] flex-none text-emphasis" aria-hidden="true" />
          You're checked in
        </p>
        {joined && organizationId ? (
          <p className="mt-1 text-[0.8125rem] text-ink2 leading-[1.45]">
            You're now a member of {joined}, and in its members' group chat.{' '}
            <Link
              to={`/events/organizations/${organizationId}`}
              className="font-bold text-emphasis underline"
            >
              See {joined}
            </Link>
          </p>
        ) : null}
        {memberId ? (
          <SelfieForTheGroup
            memberId={memberId}
            eventId={eventId}
            eventTitle={eventTitle}
            hostName={hostName}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-5">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          void checkIn();
        }}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[13px] bg-gold font-bold font-head text-[0.9375rem] text-on-gold disabled:opacity-50"
      >
        {busy ? 'Checking in…' : "I'm here: check in"}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Once check-in has closed (the owner, 2026-11-13): "If it is closed add an
 * option to message an admin about it." For the week after it closes
 * (`offerHelp`), a button opens a conversation with the event's organizer or
 * else an administrator (check_in_missed), with a first line in the box to
 * send or change. Somebody who did check in is told so instead.
 */
export function CheckInClosed({
  eventId,
  eventTitle,
  memberId,
  offerHelp,
}: {
  eventId: string;
  eventTitle: string;
  memberId: string | null;
  offerHelp: boolean;
}) {
  const { checkedIn } = useMyCheckIn(eventId, memberId);
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (checkedIn) {
    return (
      <p className="mt-5 flex items-center gap-2 rounded-[14px] border border-line bg-paper p-3.5 font-bold text-[0.875rem] text-ink">
        <Check className="h-[18px] w-[18px] flex-none text-emphasis" aria-hidden="true" />
        You checked in to this event
      </p>
    );
  }

  const canAsk = offerHelp && memberId !== null;
  return (
    <div className="mt-5 rounded-[14px] border border-line bg-paper p-3.5">
      <p className="text-[0.875rem] text-ink2 leading-[1.5]">
        Check-in for this event has closed.
        {canAsk ? ' Were you there and missed it? Let an admin know.' : null}
      </p>
      {canAsk ? (
        <>
          <button
            type="button"
            disabled={opening}
            onClick={() => {
              setOpening(true);
              setFailure(null);
              void messageAboutMissedCheckIn(eventId).then((result) => {
                if (!result.ok) {
                  setFailure(result.error);
                  setOpening(false);
                  return;
                }
                const key = memberDraftKey(memberId, `thread:${result.value}`);
                if (key && !readDraft(key)) {
                  writeDraft(key, `Hi, I was at ${eventTitle} but missed the check-in.`);
                }
                void navigate(`/chat/t/${result.value}`);
              });
            }}
            className="mt-3 flex min-h-11 w-full items-center justify-center rounded-[13px] border-[1.6px] border-emphasis px-4 font-bold font-head text-[0.875rem] text-emphasis disabled:opacity-50"
          >
            {opening ? 'Opening…' : 'Message an admin'}
          </button>
          {failure ? (
            <p role="alert" className="mt-2 text-[0.8125rem] text-destructive leading-[1.45]">
              {failure}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

const SELFIE_DONE = 'club:check-in-selfie:';

function selfieDone(eventId: string): boolean {
  try {
    return localStorage.getItem(SELFIE_DONE + eventId) === '1';
  } catch {
    return false;
  }
}

function markSelfieDone(eventId: string) {
  try {
    localStorage.setItem(SELFIE_DONE + eventId, '1');
  } catch {
    // Private browsing: it is offered again next time.
  }
}

/**
 * Once checked in (the owner, 2026-11-15: "prompt them to take a picture and
 * send it to the group chat ... open the camera in selfie mode", saying it
 * "really helps the organization that is sponsoring the event"). The front
 * camera, where the phone has one; the picture goes into the event's group
 * chat's box, with a first line, for the member to send, change or take back.
 * Not now, or a picture taken, and it is not offered for this event again.
 */
function SelfieForTheGroup({
  memberId,
  eventId,
  eventTitle,
  hostName,
}: {
  memberId: string;
  eventId: string;
  eventTitle: string;
  hostName: string | null;
}) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement | null>(null);
  const [hidden, setHidden] = useState(() => selfieDone(eventId));
  const [opening, setOpening] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (hidden) return null;

  async function share(file: File) {
    const problem = attachmentProblem([file], 0);
    if (problem) {
      setFailure(problem);
      return;
    }
    setOpening(true);
    setFailure(null);
    const result = await joinEventGroup(eventId).catch(() => null);
    if (!result?.ok) {
      setOpening(false);
      setFailure(result?.error ?? 'The group chat did not open. Try again.');
      return;
    }
    const key = memberDraftKey(memberId, `thread:${result.value}`);
    if (key) {
      handPhotos(key, [file]);
      if (!readDraft(key)) writeDraft(key, `Checked in at ${eventTitle}!`);
    }
    markSelfieDone(eventId);
    void navigate(`/chat/t/${result.value}`);
  }

  return (
    <div className="mt-3 border-line border-t pt-3">
      <p className="font-bold text-[0.9375rem] text-ink">Take a picture and share it</p>
      <p className="mt-1 text-[0.8125rem] text-ink2 leading-[1.45]">
        It goes in the event's group chat.{' '}
        {hostName
          ? `It really helps ${hostName}, the organization sponsoring this event.`
          : 'It really helps whoever is putting on this event.'}{' '}
        Nothing is sent until you press Send.
      </p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="user"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void share(file);
        }}
      />
      <button
        type="button"
        disabled={opening}
        onClick={() => {
          input.current?.click();
        }}
        className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-[13px] bg-gold font-bold font-head text-[0.9375rem] text-on-gold disabled:opacity-50"
      >
        <Camera className="h-[18px] w-[18px]" aria-hidden="true" />
        {opening ? 'Opening the group chat…' : 'Take a picture'}
      </button>
      <button
        type="button"
        disabled={opening}
        onClick={() => {
          markSelfieDone(eventId);
          setHidden(true);
        }}
        className="mt-1 flex min-h-[44px] w-full items-center justify-center font-semibold text-[0.84375rem] text-emphasis"
      >
        Not now
      </button>
      {failure ? (
        <p role="alert" className="mt-1 text-[0.8125rem] text-destructive leading-[1.45]">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
