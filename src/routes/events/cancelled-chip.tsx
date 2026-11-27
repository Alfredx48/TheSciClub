import { cn } from '@/lib/utils';

/** On a date its organizer cancelled (20261127100000). */
export function CancelledChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex-none rounded-full bg-destructive-fill px-2.5 py-[5px] font-bold text-[0.7375rem] text-white leading-[1.25]',
        className,
      )}
    >
      Cancelled
    </span>
  );
}
