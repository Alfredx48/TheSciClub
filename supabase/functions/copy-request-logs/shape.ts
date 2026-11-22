/**
 * What is kept of one request from Supabase's logs (20261122040000): what was
 * asked, never with its arguments, file names or anybody's id.
 */

/** "/rest/v1/rpc/home_feed" → "rpc:home_feed"; "/rest/v1/events" → "table:events". */
export function endpointOf(path: string): string {
  const [route = ''] = path.split('?');
  const parts = route.split('/').filter(Boolean);
  const [service, , first, second] = parts;
  switch (service) {
    case 'rest':
      if (first === 'rpc' && second) return `rpc:${second}`;
      return first ? `table:${first}` : 'rest';
    case 'auth':
      // /auth/v1/token, /auth/v1/user, /auth/v1/factors/<id>/verify → its first word.
      return first ? `auth:${first}` : 'auth';
    case 'storage':
      // /storage/v1/object/public/<bucket>/<file>: only how it was asked.
      if (first === 'object') {
        // Anything else there is a bucket's name: a plain read.
        const ways = ['public', 'sign', 'authenticated', 'info', 'list', 'move', 'copy'];
        return `storage:${second && ways.includes(second) ? second : 'read'}`;
      }
      return first === 'render' ? 'storage:render' : 'storage';
    case 'functions':
      return first ? `function:${first}` : 'function';
    case 'realtime':
      return 'realtime';
    case 'graphql':
      return 'graphql';
    default:
      return 'other';
  }
}

/** The kind of device, never the browser's own words. */
export function deviceOf(userAgent: string): string {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iphone';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Mobi/i.test(userAgent)) return 'phone';
  if (userAgent.trim() === '') return 'unknown';
  if (/Mozilla|Safari|Chrome|Firefox/i.test(userAgent)) return 'computer';
  return 'server';
}

export interface LogRow {
  id: string;
  timestamp: string | number;
  method?: string;
  path?: string;
  status?: string;
  ms?: string;
  bytes?: string;
  session?: string;
  agent?: string;
  colo?: string;
}

export interface Kept {
  id: string;
  at: string;
  method: string;
  endpoint: string;
  status: number | null;
  ms: number | null;
  bytes: number | null;
  /** Scrambled with the day's key in the database; never stored as it is. */
  session: string;
  device: string;
  colo: string;
}

const number = (value: string | undefined) => {
  const n = Number(value);
  return value === undefined || value === '' || !Number.isFinite(n) ? null : Math.round(n);
};

/** The log API's timestamp: ISO text, or microseconds since 1970. */
function isoOf(timestamp: string | number): string {
  if (typeof timestamp === 'number') return new Date(timestamp / 1000).toISOString();
  return /Z$|[+-]\d\d:?\d\d$/.test(timestamp) ? timestamp : `${timestamp}Z`;
}

export function keep(row: LogRow): Kept {
  return {
    id: row.id,
    at: isoOf(row.timestamp),
    method: row.method ?? '',
    endpoint: endpointOf(row.path ?? ''),
    status: number(row.status),
    ms: number(row.ms),
    bytes: number(row.bytes),
    session: row.session ?? '',
    device: deviceOf(row.agent ?? ''),
    colo: row.colo ?? '',
  };
}
