import { ImagePlus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { attachmentProblem, photosFromLibrary } from '@/lib/chat/attachments';
import { MAX_MORE_PHOTOS, type MorePhotoChange } from '@/lib/events';
import { usePhotoUrl } from '@/lib/photos';

/**
 * The event form's other pictures (the owner, 2026-10-31), under the cover and
 * shown in a row under it on the event's page. Chosen here and uploaded when
 * the event is saved, as the cover is.
 */
export function MorePicturesField({
  value,
  onChange,
  max = MAX_MORE_PHOTOS,
  label = 'More pictures (optional)',
  hint = `Up to ${MAX_MORE_PHOTOS}, shown in a row under the cover. Members press one to see it large.`,
  addLabel = 'Add more pictures',
  labelClassName,
  hintClassName,
  fieldClassName,
}: {
  value: MorePhotoChange[];
  onChange: (next: MorePhotoChange[]) => void;
  /** A review's pictures use this too (reviews/review-page.tsx). */
  max?: number;
  label?: string;
  hint?: string;
  addLabel?: string;
  labelClassName: string;
  hintClassName: string;
  fieldClassName: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const slotsId = useId();
  const [problem, setProblem] = useState<string | null>(null);

  const remaining = Math.max(0, max - value.length);

  function add(files: File[], overflow: string | null) {
    if (files.length === 0) return;
    const said = files.map((file) => attachmentProblem([file], 0)).find(Boolean) ?? null;
    setProblem(said ?? overflow);
    if (said) return;
    onChange([
      ...value,
      ...files.map((file) => ({
        kind: 'new' as const,
        id: crypto.randomUUID(),
        file,
        alt: '',
      })),
    ]);
  }

  return (
    <>
      <p className={labelClassName}>{label}</p>
      <p className={hintClassName}>{hint}</p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple={remaining > 1}
        disabled={remaining === 0}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const { photos, overflow } = photosFromLibrary(e.target.files, remaining);
          add(photos, overflow);
          e.target.value = '';
        }}
      />

      {value.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-3">
          {value.map((item, index) => (
            <Row
              key={item.kind === 'keep' ? item.path : item.id}
              item={item}
              number={index + 1}
              fieldClassName={fieldClassName}
              onAlt={(alt) => {
                onChange(value.map((other) => (other === item ? { ...item, alt } : other)));
              }}
              onRemove={() => {
                setProblem(null);
                onChange(value.filter((other) => other !== item));
              }}
            />
          ))}
        </ul>
      ) : null}

      {remaining > 0 ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          aria-label={addLabel}
          aria-describedby={slotsId}
          className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-[13px] border-[1.6px] border-line bg-paper px-3.5 font-bold font-head text-[0.875rem] text-emphasis transition-colors hover:bg-tint"
        >
          <ImagePlus className="h-[19px] w-[19px]" aria-hidden="true" />
          {addLabel}
          <span id={slotsId} className="text-[0.75rem] text-ink2">
            {remaining} left
          </span>
        </button>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-1.5 text-[0.78125rem] text-destructive leading-[1.45]">
          {problem}
        </p>
      ) : null}
    </>
  );
}

function Row({
  item,
  number,
  fieldClassName,
  onAlt,
  onRemove,
}: {
  item: MorePhotoChange;
  number: number;
  fieldClassName: string;
  onAlt: (alt: string) => void;
  onRemove: () => void;
}) {
  const saved = usePhotoUrl(item.kind === 'keep' ? item.path : null);
  const [local, setLocal] = useState<string | null>(null);
  const file = item.kind === 'new' ? item.file : null;

  // A preview of a chosen file, released when it goes.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setLocal(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const preview = file ? local : saved;
  return (
    <li className="flex items-start gap-3">
      {preview ? (
        <img
          src={preview}
          alt=""
          className="h-16 w-16 flex-none rounded-[12px] border border-line bg-tint object-cover"
        />
      ) : (
        <span className="h-16 w-16 flex-none rounded-[12px] border border-line bg-tint" />
      )}
      <div className="min-w-0 flex-1">
        <input
          value={item.alt}
          maxLength={200}
          aria-label={`Describe picture ${number} (optional)`}
          placeholder="Describe the picture (optional)"
          onChange={(e) => {
            onAlt(e.target.value);
          }}
          className={fieldClassName}
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove picture ${number}`}
          className="min-h-[44px] font-semibold text-[0.875rem] text-destructive"
        >
          Remove
        </button>
      </div>
    </li>
  );
}
