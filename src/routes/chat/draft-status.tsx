import type { DraftMediaStatus } from '@/lib/use-draft-media';

export type DraftStorage = 'device' | 'session' | null;

export function DraftStatus({
  storage,
  restored,
  media,
  className,
}: {
  storage: DraftStorage;
  restored: boolean;
  media?: DraftMediaStatus | undefined;
  className?: string;
}) {
  let message: string;
  switch (media) {
    case 'loading':
      message = 'Restoring draft photos…';
      break;
    case 'saving':
      message = 'Saving draft photos…';
      break;
    case 'read-error':
      message = 'The saved draft photos could not be restored.';
      break;
    case 'write-error':
      message = 'The latest photo changes could not be saved on this device.';
      break;
    default:
      if (!storage && media !== 'saved' && media !== 'restored') return null;
      message =
        restored || media === 'restored'
          ? 'Draft restored'
          : storage === 'session' && media !== 'saved'
            ? 'Draft saved for this session'
            : 'Draft saved on this device';
  }
  return <p className={`text-[0.8125rem] text-ink2 ${className ?? ''}`}>{message}</p>;
}
