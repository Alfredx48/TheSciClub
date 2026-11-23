/**
 * Turning a refusal into a sentence a member can read, never the database's own words.
 *
 * Helpers call this **before** the error becomes a string: only the `code` (SQLSTATE or
 * `PGRST…`) tells cases apart honestly (a mentor's invite fails as 42501 or 23505).
 *
 * Our own `raise exception` messages are already prose and pass through untouched (`P0001`,
 * `P0002`, `22023`, or `42501` without "row-level security"). The database's and PostgREST's are
 * translated by code, real strings in describe-error.test.ts; `42501` also needs the phrase, as
 * policies, missing grants and our own raises share it. An unknown code gets a generic sentence
 * plus `console.error`. No code and no known phrase is taken as ours: PostgREST always sends one.
 */

/** The shape supabase-js hands back, and what a thrown `Error` has in common with it. */
export interface Failure {
  message: string;
  /** A SQLSTATE or `PGRST…` string; a `DOMException` carries a legacy number here, which says nothing. */
  code?: string | number | null | undefined;
  name?: string | undefined;
}

/** What was being attempted. Each field is a full sentence; missing ones fall back to general. */
export interface ErrorContext {
  /** Leads the sentence: "Your reply was not posted." */
  attempt?: string;
  /** A check constraint, keyed on its name: `chat_messages_attachments_check` → "Up to 50 photographs on one message." */
  constraints?: Record<string, string>;
  /** The unique index refused: "There is already a room with that name." */
  duplicate?: string;
  /** A policy refused: "Only somebody in the room can post here." */
  refused?: string;
  /** `.single()` found nothing, or a foreign key points at nothing: "That message is not there any more." */
  missing?: string;
}

/** Shown when a code this file does not know arrives; the raw text goes to the console. */
export const GENERIC_FAILURE = 'Something went wrong. Try again in a minute.';
/** Shown for every kind of schema drift — never the raw text, which names tables. */
export const UPDATING_FAILURE = 'The club is being updated. Try again in a minute.';
export const OFFLINE_FAILURE = 'You are offline. Check your connection and try again.';

/** Schema drift — the client is ahead of the database, or behind it. */
const DRIFT_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01', '42703']);
/** The codes our own `raise exception` sentences arrive with. */
const OUR_CODES = new Set(['P0001', 'P0002', '22023']);

const RLS = /row-level security/i;
const GRANT = /^permission denied for (column|table|relation|function|view|schema|sequence)/i;
const CHECK = /violates check constraint "([^"]+)"/;
const DRIFT = /in the schema cache|does not exist/;
const OFFLINE =
  /Failed to fetch|NetworkError|Load failed|network request failed|ERR_INTERNET_DISCONNECTED/i;
const ABORTED = /^AbortError\b|user aborted a request|signal is aborted/i;

/**
 * A bucket's own limits. Their codes ("EntityTooLarge", "InvalidMimeType") are not SQLSTATEs, so
 * they are matched by name and wording *before* the code check; after it, every refused photo read
 * as generic (fixed 2026-09-29). Mind HANDOFF.md's trap: a fixture without a code passes where the
 * real error does not. No caller lead-in: the owner found it too long (2026-10-01).
 */
const STORAGE: [RegExp, string][] = [
  [/mime type .* is not supported/i, "That kind of file can't be used. Try a JPEG or PNG."],
  [/exceeded the maximum allowed size|too large/i, 'That photo is too large. Try a smaller one.'],
];

/**
 * GoTrue's codes, or its wording for versions that send only a message. Email flows only (no
 * phone sign-in). The 429 with no code says "you can only request this after 59 seconds";
 * `unexpected_failure` says "Error sending … email".
 */
const AUTH: [RegExp, string][] = [
  [/^invalid_credentials$|Invalid login credentials/i, 'That email or password is not right.'],
  [
    /^otp_expired$|Email link is invalid or has expired|Token has expired/i,
    'That link has expired or was already used. Ask for a new one.',
  ],
  [
    /^over_(email_send|request)_rate_limit$|rate limit|only request this after/i,
    'Too many attempts or emails. Wait a minute and try again.',
  ],
  [/Error sending .*email/i, 'The email could not be sent. Try again in a minute.'],
];

function lead(attempt: string | undefined, rest: string): string {
  return attempt ? `${attempt} ${rest}` : rest;
}

/**
 * The sentence for a failure. Takes the error object itself, never `error.message`: as a string
 * the code is gone.
 */
export function describeError(error: Failure, context?: string | ErrorContext): string {
  const ctx: ErrorContext = typeof context === 'string' ? { attempt: context } : (context ?? {});
  const message = error.message;
  const code = typeof error.code === 'string' ? error.code : '';

  // A fetch that never got through: "Failed to fetch" with code '', or thrown by fetch itself.
  if (OFFLINE.test(message)) return OFFLINE_FAILURE;
  // A hook that aborted its own request has already checked for that and
  // returned, so this is the tab leaving mid-write.
  if (error.name === 'AbortError' || ABORTED.test(message)) {
    return lead(ctx.attempt, 'That did not finish. Try again.');
  }

  // Storage first, by wording, because its code is not a SQLSTATE and would
  // otherwise fall to `unknown` below. See STORAGE.
  if (isStorage(error)) {
    for (const [pattern, sentence] of STORAGE) {
      if (pattern.test(message)) return sentence;
    }
    if (RLS.test(message)) return lead(ctx.attempt, ctx.refused ?? 'You cannot do that here.');
    return unknown(error, ctx);
  }

  if (OUR_CODES.has(code)) return message;

  if (code === '42501') {
    if (RLS.test(message)) return lead(ctx.attempt, ctx.refused ?? 'You cannot do that here.');
    // A grant is missing — the client named a column it may not write, or
    // called a function this role cannot. A bug, not a member's doing.
    if (GRANT.test(message)) return unknown(error, ctx);
    // Our own `raise … using errcode = '42501'`: "Not an administrator".
    return message;
  }

  if (code === '23514') return checkConstraint(message, ctx);
  if (code === '23505') return lead(ctx.attempt, ctx.duplicate ?? 'That one is already there.');
  if (code === '23503' || code === 'PGRST116') {
    return lead(ctx.attempt, ctx.missing ?? 'That is not there any more.');
  }
  if (DRIFT_CODES.has(code)) {
    console.error(error);
    return UPDATING_FAILURE;
  }

  for (const [pattern, sentence] of AUTH) {
    if (pattern.test(code) || pattern.test(message)) return sentence;
  }

  if (code) return unknown(error, ctx);

  for (const [pattern, sentence] of STORAGE) {
    if (pattern.test(message)) return sentence;
  }

  // No code at all. The database's wording is still recognisable, and a test
  // fixture or a thrown Error is the usual source; sort by phrase.
  if (RLS.test(message)) return lead(ctx.attempt, ctx.refused ?? 'You cannot do that here.');
  if (GRANT.test(message)) return unknown(error, ctx);
  if (CHECK.test(message)) return checkConstraint(message, ctx);
  if (message.includes('duplicate key value violates unique constraint'))
    return lead(ctx.attempt, ctx.duplicate ?? 'That one is already there.');
  if (message.includes('violates foreign key constraint'))
    return lead(ctx.attempt, ctx.missing ?? 'That is not there any more.');
  if (DRIFT.test(message)) {
    console.error(error);
    return UPDATING_FAILURE;
  }
  if (!message) return unknown(error, ctx);
  return message;
}

/**
 * The same, for whatever a `catch` caught: usually a fetch `TypeError`, an `AbortError`, or a
 * non-`Error` (supabase-js returns its failures rather than throwing).
 */
export function describeThrown(thrown: unknown, context?: string | ErrorContext): string {
  if (thrown instanceof Error) return describeError(thrown, context);
  return unknown(
    { message: String(thrown) },
    typeof context === 'string' ? { attempt: context } : (context ?? {}),
  );
}

/** storage-js names its errors `StorageApiError`, `StorageUnknownError`, and so on. */
function isStorage(error: Failure): boolean {
  return typeof error.name === 'string' && error.name.startsWith('Storage');
}

function checkConstraint(message: string, ctx: ErrorContext): string {
  const name = CHECK.exec(message)?.[1];
  const own = name ? ctx.constraints?.[name] : undefined;
  return lead(
    ctx.attempt,
    own ?? 'Something in it is not allowed: too long, blank, or too many of one thing.',
  );
}

function unknown(error: Failure, ctx: ErrorContext): string {
  console.error(error);
  return lead(ctx.attempt, GENERIC_FAILURE);
}
