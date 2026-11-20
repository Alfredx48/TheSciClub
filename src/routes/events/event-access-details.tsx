import { Accessibility } from 'lucide-react';

export function EventAccessDetails({ details }: { details: string | null | undefined }) {
  if (!details?.trim()) return null;
  return (
    <section className="mt-5 rounded-[18px] border border-line bg-paper p-4">
      <h2 className="flex items-center gap-2 font-bold font-head text-[1rem] text-ink">
        <Accessibility aria-hidden="true" className="h-5 w-5 flex-none text-emphasis" />
        Accessibility
      </h2>
      <p className="mt-2 whitespace-pre-wrap wrap-break-word text-[0.9375rem] text-ink leading-[1.55]">
        {details}
      </p>
    </section>
  );
}
