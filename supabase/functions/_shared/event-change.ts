/**
 * What an event_changed notice says changed (20261120140000), for the bell
 * and the push alike. detail is the new format first when it changed
 * ('in_person', 'online', 'hybrid'), then any of 'date', 'time', 'place',
 * 'link'; or 'cancelled:' and the event's title.
 */

const FORMATS: Record<string, string> = {
  in_person: 'it’s now in person',
  online: 'it’s now online',
  hybrid: 'it’s now in person and online',
};

const PARTS: Record<string, string> = {
  date: 'date',
  time: 'time',
  place: 'location',
  link: 'video call link',
};

/** The cancelled event's title, or null for a change. */
export function cancelledTitle(detail: string | null | undefined): string | null {
  return detail?.startsWith('cancelled:') ? detail.slice('cancelled:'.length) : null;
}

/** "the date and time changed", "it’s now online, and the location changed". */
export function eventChangePhrase(detail: string | null | undefined): string {
  const words = (detail ?? '').split(',');
  const format = words.map((w) => FORMATS[w]).find(Boolean);
  const parts = words.map((w) => PARTS[w]).filter(Boolean);
  const changed =
    parts.length === 0
      ? ''
      : parts.length === 1
        ? `the ${parts[0]} changed`
        : `the ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]} changed`;
  if (format && changed) return `${format}, and ${changed}`;
  return format ?? (changed || 'it changed');
}
