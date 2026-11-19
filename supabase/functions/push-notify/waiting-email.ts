/**
 * What has waited a day on a member, by email (20261119100000, the owner,
 * 2026-11-19: "send an e-mail if they have not been addressed for 24
 * hours"). One email listing everything that waits on them, as
 * waiting_emails returns it; each thing is emailed about once.
 *
 * The sentences are the app's own (notificationSentence in
 * src/lib/notifications.ts) for these kinds.
 */

export interface WaitingItem {
  kind: string;
  count: number;
  actor: string | null;
  place: string | null;
  detail: string | null;
  /** In the app: "/events/invites". */
  url: string;
  since: string;
}

export interface DueWaiting {
  email: string;
  name: string | null;
  items: WaitingItem[];
}

export interface WaitingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function waitingSentence(item: WaitingItem): string {
  const given = item.actor?.trim() ?? '';
  const name = given === '' ? 'A member' : given;
  switch (item.kind) {
    case 'report':
      return item.count > 1 ? `${item.count} reports to look at` : 'A member reported something';
    case 'invite_request': {
      const through = item.place ? ` through ${item.place}` : '';
      return item.count > 1
        ? `${item.count} people asked for an invite${through}`
        : `${item.detail ?? 'Somebody'} asked you for an invite${through}`;
    }
    case 'join_request': {
      const org = item.place ?? 'your organization';
      return item.count > 1
        ? `${item.count} people asked to join ${org}`
        : `${name} asked to join ${org}`;
    }
    case 'calendar_invite': {
      const title = item.place ? `“${item.place}”` : 'An event from your calendar';
      return item.detail === 'choose'
        ? `Choose which organization hosts ${title}`
        : `${title} is waiting for approval`;
    }
    case 'organization_request':
      return `${name} asked to add ${item.place ?? 'an organization'}`;
    case 'introduction':
      return `${name} would like to introduce you to ${item.place ?? 'another member'}`;
    case 'family_link':
      return `${name} asked to be linked to you as family`;
    default:
      return 'Something is waiting for you';
  }
}

/** "1 day", "3 days". */
function waited(since: string, now: Date): string {
  const days = Math.max(1, Math.floor((now.getTime() - new Date(since).getTime()) / 86_400_000));
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function waitingEmail(due: DueWaiting, site: string, now: Date = new Date()): WaitingEmail {
  const first = due.name?.trim().split(/\s+/)[0] ?? '';
  const hello = first ? `Hi ${first},` : 'Hi,';
  const lines = due.items.map((item) => ({
    sentence: waitingSentence(item),
    waited: waited(item.since, now),
    url: `${site}${item.url}`,
  }));
  const one = lines.length === 1;
  const intro = one
    ? 'This is waiting for you in The SCI Club:'
    : `These ${lines.length} things are waiting for you in The SCI Club:`;
  const notifications = `${site}/notifications`;
  const text = [
    hello,
    '',
    intro,
    '',
    ...lines.map((l) => `- ${l.sentence} (waiting ${l.waited})\n  ${l.url}`),
    '',
    `They stay at the top of your notifications until they're done: ${notifications}`,
    '',
    'You get this when something has waited a day for you. Each one is emailed about once.',
    '',
    'The SCI Club',
  ].join('\n');
  const html = `<p>${escapeHtml(hello)}</p>
<p>${escapeHtml(intro)}</p>
<ul>
${lines
  .map(
    (l) =>
      `<li><a href="${escapeHtml(l.url)}">${escapeHtml(l.sentence)}</a> <span style="color:#6b7280">(waiting ${escapeHtml(l.waited)})</span></li>`,
  )
  .join('\n')}
</ul>
<p>They stay at the top of your <a href="${escapeHtml(notifications)}">notifications</a> until they're done.</p>
<p style="color:#6b7280;font-size:13px">You get this when something has waited a day for you. Each one is emailed about once.</p>
<p>The SCI Club</p>`;
  const subject = one
    ? `Waiting for you: ${lines[0]?.sentence ?? ''}`
    : `${lines.length} things are waiting for you in The SCI Club`;
  return { to: due.email, subject, text, html };
}
