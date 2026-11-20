import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BackLink } from '@/components/back-link';
import { attachmentFolder, deleteAttachments, uploadAttachments } from '@/lib/chat/attachments';
import { POST_MAX } from '@/lib/chat/post-length';
import { roomsByCategory, useChatRooms } from '@/lib/chat/rooms';
import { createTopic } from '@/lib/chat/topics';
import { describeThrown } from '@/lib/describe-error';
import { type Shared, sharedBody, sharedTitle, takeShared } from '@/lib/share-target';
import { PostOptions } from '@/routes/chat/post-options';

/**
 * Posting what another app shared ("Share to The SCI Club", Android's share
 * menu, 2026-10-10): a link from the browser, words, or photographs from the
 * phone's gallery.
 *
 * The service worker kept the share (src/sw.ts); this reads it once and lays
 * it out as a new topic, General unless another room is chosen, the words
 * editable and the photographs shown. Post makes the topic; nothing is
 * posted without it.
 */
export default function SharePage() {
  const navigate = useNavigate();
  const rooms = useChatRooms();
  const [shared, setShared] = useState<Shared | null | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [chosenRoom, setChosenRoom] = useState<string | null>(null);
  const [isQuestion, setIsQuestion] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void takeShared()
      .catch(() => null)
      .then((found) => {
        if (cancelled) return;
        setShared(found);
        if (found) {
          setTitle(sharedTitle(found));
          setBody(sharedBody(found));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const urls = (shared?.files ?? []).map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [shared]);

  const open = rooms.rooms.filter((room) => room.openedAt !== null);
  const room =
    open.find((r) => r.id === chosenRoom) ??
    open.find((r) => r.id === 'general') ??
    roomsByCategory(open)[0]?.[1][0] ??
    null;
  const files = shared?.files ?? [];
  const ready = title.trim().length > 0 && room !== null && !saving;

  function post() {
    if (!room || saving || title.trim().length === 0) return;
    setSaving(true);
    setFailure(null);
    const target = room;
    void (async () => {
      let paths: string[] = [];
      if (files.length > 0) {
        const up = await uploadAttachments(files, attachmentFolder('room', target.id));
        if (!up.ok) return up;
        paths = up.value;
      }
      const words = body.trim() || (paths.length > 0 ? '' : title.trim());
      const result = await createTopic(target.id, title.trim(), words, paths, isQuestion);
      if (!result.ok) void deleteAttachments(paths);
      return result;
    })()
      .then((result) => {
        if (!result.ok) {
          setFailure(result.error);
          return;
        }
        void navigate(`/chat/rooms/${target.id}/topics/${result.value}`, { replace: true });
      })
      .catch((e: unknown) => {
        setFailure(describeThrown(e, 'That did not work.'));
      })
      .finally(() => {
        setSaving(false);
      });
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 md:px-6">
      <div className="mx-auto w-full max-w-[720px]">
        <BackLink to="/home" label="Home" />
        <h1 className="mt-1 font-extrabold font-head text-[1.25rem] text-ink tracking-[-0.01em]">
          Share to the club
        </h1>

        {shared === undefined ? (
          <p role="status" className="py-10 text-center text-[0.875rem] text-grey">
            Loading…
          </p>
        ) : shared === null ? (
          <div className="mt-4 rounded-[13px] border border-line bg-paper px-4 py-4">
            <p className="text-[0.875rem] text-ink leading-[1.5]">
              Nothing was shared, or it has already been posted.
            </p>
            <Link
              to="/home"
              className="mt-1 inline-flex min-h-[44px] items-center font-semibold text-emphasis underline"
            >
              Go to Home
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              post();
            }}
          >
            {failure ? (
              <p
                role="alert"
                className="mt-3 rounded-[11px] border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[0.8125rem] text-destructive leading-[1.45]"
              >
                {failure} Nothing has been posted.
              </p>
            ) : null}

            {previews.length > 0 ? (
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {previews.map((src, index) => (
                  <li key={src}>
                    <img
                      src={src}
                      alt={`Shared photograph ${index + 1} of ${previews.length}`}
                      className="aspect-square w-full rounded-[12px] object-cover"
                    />
                  </li>
                ))}
              </ul>
            ) : null}

            <label
              htmlFor="share-title"
              className="mt-4 block font-bold font-head text-[0.875rem] text-ink"
            >
              Say something about it
            </label>
            <input
              id="share-title"
              value={title}
              maxLength={140}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
              className="mt-1.5 min-h-[44px] w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3.5 py-2.5 text-[1rem] text-ink outline-none focus:border-emphasis"
            />

            <label
              htmlFor="share-body"
              className="mt-4 block font-bold font-head text-[0.875rem] text-ink"
            >
              More detail <span className="font-normal text-grey">(optional)</span>
            </label>
            <textarea
              id="share-body"
              rows={4}
              maxLength={POST_MAX}
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
              className="mt-1.5 w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3.5 py-2.5 text-[0.9375rem] text-ink leading-[1.5] outline-none focus:border-emphasis"
            />

            <PostOptions
              id="share-options"
              question={{ checked: isQuestion, onChange: setIsQuestion }}
            />

            <label
              htmlFor="share-room"
              className="mt-4 block font-bold font-head text-[0.875rem] text-ink"
            >
              Room
            </label>
            <select
              id="share-room"
              value={room?.id ?? ''}
              onChange={(event) => {
                setChosenRoom(event.target.value);
              }}
              className="mt-1.5 min-h-[48px] w-full rounded-[12px] border-[1.6px] border-line bg-paper px-3 text-[1rem] text-ink outline-none focus:border-emphasis"
            >
              {roomsByCategory(open).map(([category, inCategory]) => (
                <optgroup key={category} label={category}>
                  {inCategory.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <button
              type="submit"
              disabled={!ready}
              className="mt-4 flex min-h-[48px] w-full items-center justify-center rounded-[13px] bg-gold font-bold font-head text-[0.9375rem] text-on-gold transition-colors hover:bg-gold-hi disabled:opacity-40"
            >
              {saving ? 'Posting…' : 'Post it'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
