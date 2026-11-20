export type DraftStorage = 'device' | 'session' | null;

export function DraftStatus({
  storage,
  restored,
  className,
}: {
  storage: DraftStorage;
  restored: boolean;
  className?: string;
}) {
  if (!storage) return null;
  return (
    <p className={`text-[0.8125rem] text-ink2 ${className ?? ''}`}>
      {restored
        ? 'Draft restored'
        : storage === 'device'
          ? 'Draft saved on this device'
          : 'Draft saved for this session'}
    </p>
  );
}
