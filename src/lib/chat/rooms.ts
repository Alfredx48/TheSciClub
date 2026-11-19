import { useCallback, useEffect, useRef, useState } from 'react';
import { POST_MAX_WORDS } from '@/lib/chat/post-length';
import type { ChatWriteResult } from '@/lib/chat/threads';
import {
  type ChatRoom,
  ROOM_CATEGORIES,
  type RoomCategory,
  type RoomStats,
} from '@/lib/chat/types';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { useKeptRead } from '@/lib/kept-reads';
import { matchesSearch } from '@/lib/search';
import { getSupabase } from '@/lib/supabase';

/**
 * The discussion rooms.
 *
 * ---------------------------------------------------------------------------
 * One query for two audiences
 * ---------------------------------------------------------------------------
 * `/chat` and `/admin` read the same `chat_rooms` and get different answers,
 * because the select policy is `is_member() and (opened_at is not null or
 * is_admin())`. A member gets the open rooms; an administrator gets all twelve
 * with `openedAt` null on the shut ones. There is deliberately no "include
 * closed" flag here for the client to pass — the database decides who sees
 * what, and a flag would be a second place that opinion lived.
 *
 * So a component tells the two apart by looking at `openedAt`, not by asking
 * for a different query.
 */

export interface ChatRoomRow {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string | null;
  sort_order: number;
  opened_at: string | null;
  show_in_home: boolean;
  created_by: string | null;
}

export function toRoom(row: ChatRoomRow): ChatRoom {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    // The column is checked against exactly ROOM_CATEGORIES, so an unknown
    // value means the check was changed without this being. Body is the least
    // surprising thing to draw rather than a crash.
    category: (ROOM_CATEGORIES as readonly string[]).includes(row.category)
      ? (row.category as RoomCategory)
      : 'Body',
    icon: row.icon,
    sortOrder: row.sort_order,
    openedAt: row.opened_at,
    showInHome: row.show_in_home,
    createdBy: row.created_by,
  };
}

/**
 * Rooms grouped into the categories, in `sort_order` within each.
 *
 * The categories come out in ROOM_CATEGORIES' order. They used to come out in
 * the order of the lowest `sort_order` in each, which the seed happened to
 * encode for Body · Life · Kit — and which put a category with only member
 * rooms in it (every member room is 1000 and up) wherever its first room fell,
 * so Mind could land after Places on one member's screen and before it on
 * another's. A category with no rooms in it is left out rather than drawn as
 * an empty heading — which is the ordinary case for a member, who sees only
 * the rooms an administrator has opened.
 *
 * Pure, so it is tested without a database.
 */
export function roomsByCategory(rooms: ChatRoom[]): [RoomCategory, ChatRoom[]][] {
  const sorted = [...rooms].sort((a, b) => a.sortOrder - b.sortOrder);
  const grouped = new Map<RoomCategory, ChatRoom[]>();
  for (const room of sorted) {
    const existing = grouped.get(room.category);
    if (existing) existing.push(room);
    else grouped.set(room.category, [room]);
  }
  return ROOM_CATEGORIES.flatMap((category) => {
    const inCategory = grouped.get(category);
    return inCategory ? [[category, inCategory] as [RoomCategory, ChatRoom[]]] : [];
  });
}

export interface ChatRoomsState {
  rooms: ChatRoom[];
  loading: boolean;
  /** The database's own sentence where there is one. */
  error: string | null;
  /** Re-read the list. Used after an administrator opens or closes a room. */
  reload: () => void;
}

export function useChatRooms(initial?: unknown[]): ChatRoomsState {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The read in flight, so that a reload cancels the one before it and
  // unmounting cancels whichever is running. A counter in state with an effect
  // keyed on it would do the same job and would leave the effect with a
  // dependency it never reads.
  const inFlight = useRef<AbortController | null>(null);
  const startup = useRef(initial);
  const kept = useKeptRead();

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const landed = kept.start('rooms');
    // Read through a call: the type checker narrows `signal.aborted` to false
    // after the first check and flags every later one as dead code.
    const aborted = () => controller.signal.aborted;

    try {
      const { data, error: failure } = await getSupabase()
        .from('chat_rooms')
        .select(
          'id, name, description, category, icon, sort_order, opened_at, created_by, show_in_home',
        )
        .order('sort_order')
        .abortSignal(controller.signal);
      if (aborted()) return;
      if (failure) {
        // A database that predates 20260918020000 has no such table, and the
        // screen should lose its rooms rather than its page.
        setRooms([]);
        setError(describeError(failure, 'Could not load the rooms.'));
        setLoading(false);
        return;
      }
      setRooms((data as ChatRoomRow[]).map(toRoom));
      setError(null);
      setLoading(false);
      landed();
    } catch (e) {
      if (aborted()) return;
      setRooms([]);
      setError(describeThrown(e, 'Could not load the rooms.'));
      setLoading(false);
    }
  }, [kept]);

  useEffect(() => {
    // A kept tab shown again within the minute (lib/kept-reads.ts).
    if (startup.current) {
      setRooms((startup.current as ChatRoomRow[]).map(toRoom));
      setLoading(false);
      startup.current = undefined;
      kept.start('rooms')();
    } else if (!kept.fresh('rooms')) {
      void load();
    }
    return () => {
      inFlight.current?.abort();
    };
  }, [load, kept]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { rooms, loading, error, reload };
}

/**
 * Open or close a room, as an administrator.
 *
 * A function rather than an update, because there is no update policy on
 * `chat_rooms` and there should not be: an RLS update that matches no rows
 * reports success, so a member who found this call would get a cheerful
 * no-op. `admin_set_room_open` refuses in a sentence, and that sentence is
 * what /admin shows.
 */
export async function setRoomOpen(
  roomId: string,
  open: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await getSupabase().rpc('admin_set_room_open', {
    room: roomId,
    is_open: open,
  });
  if (error) return { ok: false, error: describeError(error, 'The room was not changed.') };
  return { ok: true };
}

/** Curate Home without closing the room or changing who can read it. */
export async function setRoomHome(
  roomId: string,
  showInHome: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await getSupabase().rpc('admin_set_room_home', {
      room: roomId,
      show_in_home: showInHome,
    });
    return error
      ? { ok: false, error: describeError(error, 'The Home feed setting was not changed.') }
      : { ok: true };
  } catch (e) {
    return { ok: false, error: describeThrown(e, 'The Home feed setting was not changed.') };
  }
}

/**
 * Starting a room, and the four rules a member meets on the way in.
 *
 * ---------------------------------------------------------------------------
 * The room and its first topic are one form and one call
 * ---------------------------------------------------------------------------
 * `chat_create_room` takes both because a room cannot be born empty —
 * CONTEXT.md's objection to topic rooms is that a room of two dozen members is
 * empty by construction, and the answer is the shape of the flow rather than a
 * rule. There is no `createRoom(name)` here to reach for later.
 *
 * The bounds below are the function's, repeated so the screen can say what is
 * wrong before the round trip rather than after it. They are the only thing in
 * this file that is a second copy of a database rule, and they are the cheap
 * half: the database still decides, and its sentence is what a refusal shows.
 */
export const ROOM_NAME_MIN = 3;
export const ROOM_NAME_MAX = 40;
export const ROOM_DESCRIPTION_MIN = 10;
export const ROOM_DESCRIPTION_MAX = 200;

/**
 * A room's name with its whitespace collapsed, the way the database stores it.
 *
 * `chat_create_room` does this before it checks `lower(name)` against the
 * unique index, so "Shoulder  pain" and "Shoulder pain" are one name. Mirrored
 * here only to find the room a member has just been refused for — never to
 * decide anything, which the database does.
 */
export function normalizeRoomName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/**
 * What is wrong with a room somebody is part-way through describing, or null.
 *
 * Pure, and the sentence is the one the screen shows under the disabled
 * button, so the two cannot disagree about why. It says what to do next rather
 * than which field failed, and it asks for them in the order the form does, so
 * somebody filling it in top to bottom is never told about a field they have
 * not reached.
 */
export function roomProblem(
  name: string,
  category: RoomCategory | null,
  description: string,
  topicTitle: string,
  topicBody: string,
): string | null {
  const cleanName = normalizeRoomName(name);
  if (cleanName.length === 0) return 'Give the room a name.';
  if (cleanName.length < ROOM_NAME_MIN) {
    return `A room's name is at least ${ROOM_NAME_MIN} characters.`;
  }
  if (cleanName.length > ROOM_NAME_MAX) {
    return `A room's name is ${ROOM_NAME_MAX} characters or fewer.`;
  }
  // Nothing is picked to begin with. A default would be one of the six
  // quietly chosen for somebody, and a room filed under the wrong one is not
  // something they can put right afterwards — nobody edits a room.
  if (category === null) return 'Say which part of life the room is about.';
  const cleanDescription = description.trim();
  if (cleanDescription.length === 0) return 'Say what the room is for.';
  if (cleanDescription.length < ROOM_DESCRIPTION_MIN) {
    return `Say a little more about what the room is for — at least ${ROOM_DESCRIPTION_MIN} characters.`;
  }
  if (cleanDescription.length > ROOM_DESCRIPTION_MAX) {
    return `The description is ${ROOM_DESCRIPTION_MAX} characters or fewer.`;
  }
  if (topicTitle.trim().length === 0) return 'Give the first post a title.';
  if (topicBody.trim().length === 0) return 'Write the first topic.';
  return null;
}

/**
 * Rooms whose name contains what somebody is typing.
 *
 * The most likely outcome of a new-room impulse is a room that already exists,
 * and finding it is a better result than making a twin — so this runs under
 * the name field as it is typed. Two characters before it says anything, since
 * one letter matches most of the twelve and a list that is always there is not
 * a suggestion.
 *
 * It searches what the viewer can already see, which for a member is the open
 * rooms. A closed room cannot be offered as an alternative, because they
 * cannot read it; the database still refuses the duplicate name.
 */
export function roomsMatching(rooms: ChatRoom[], name: string, limit = 5): ChatRoom[] {
  const needle = normalizeRoomName(name).toLowerCase();
  if (needle.length < 2) return [];
  return rooms
    .filter((room) => matchesSearch(room.name, needle))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, limit);
}

/**
 * The room a member has been told already has this name, if they can see it.
 *
 * Used to put a link under the refusal. Null where the clash is with a closed
 * room: the database knows about it and refuses, and the member cannot read it,
 * so the sentence stands on its own without a link that would go nowhere.
 */
export function roomNamed(rooms: ChatRoom[], name: string): ChatRoom | null {
  const wanted = normalizeRoomName(name).toLowerCase();
  return rooms.find((room) => room.name.toLowerCase() === wanted) ?? null;
}

/**
 * The room of the viewer's own that has nothing in it yet.
 *
 * The other half of "fill your last room before starting another": the
 * database refuses in a sentence, and this finds the room that sentence is
 * about so the member can be sent to it. Derived from what is already on the
 * screen rather than parsed out of the message — a message is prose and a link
 * should not depend on its wording.
 */
export function roomToFill(
  rooms: ChatRoom[],
  stats: Map<string, RoomStats>,
  memberId: string | null,
): ChatRoom | null {
  if (!memberId) return null;
  return (
    rooms.find((room) => room.createdBy === memberId && stats.get(room.id)?.topicCount === 0) ??
    null
  );
}

/**
 * Start a room and its first topic.
 *
 * Returns the new room's id, which is a slug of the name plus four random
 * characters. The database makes it, not this: the id is in the URL forever
 * and two members typing the same name a second apart must not race for it.
 */
export async function createRoom(
  name: string,
  description: string,
  category: RoomCategory,
  topicTitle: string,
  topicBody: string,
): Promise<ChatWriteResult<string>> {
  const { data, error } = (await getSupabase().rpc('chat_create_room', {
    // Prefixed, every one of them: inside plpgsql a parameter with a column's
    // name is ambiguous against that column, and this function writes name,
    // description and category. PostgREST sends arguments by name, so these
    // are the names. See 20260918170000.
    room_name: name.trim(),
    room_description: description.trim(),
    room_category: category,
    topic_title: topicTitle.trim(),
    topic_body: topicBody.trim(),
  })) as { data: string | null; error: Failure | null };
  if (error) {
    return {
      ok: false,
      error: describeError(error, {
        attempt: 'The room was not started.',
        // The function checks the name itself and says so in a sentence; the
        // index is behind it for two members starting the same room at once.
        duplicate: 'There is already a room with that name.',
        constraints: {
          chat_topics_title_check: 'The first topic needs a title of up to 140 characters.',
          chat_posts_check: `The first post needs some words, and at most ${POST_MAX_WORDS} characters.`,
        },
      }),
    };
  }
  if (!data) return { ok: false, error: 'The room was not started.' };
  return { ok: true, value: data };
}

/**
 * Put photographs on the first post of a room the viewer just started.
 *
 * The room's folder is named after an id the database makes, so the files
 * cannot go up before the room exists. new-room.tsx starts the room, uploads
 * under rooms/<id>/, then calls this; the function checks the caller started
 * the room, that the post has none yet, that nobody has replied, and that
 * every path is a real file of theirs. See 20260923000000.
 */
export async function addFirstPostPhotographs(
  roomId: string,
  paths: string[],
): Promise<ChatWriteResult<null>> {
  const { error } = await getSupabase().rpc('chat_add_first_post_photographs', {
    room: roomId,
    paths,
  });
  if (error) return { ok: false, error: describeError(error, 'The photographs were not added.') };
  return { ok: true, value: null };
}

/**
 * How many topics, posts and members each visible room has.
 *
 * Counts and never names. `chat_room_stats` runs with RLS off — that is what
 * lets it count membership rows nobody may list — and its own `where` is the
 * whole of its access control, so a room the viewer cannot see is simply not
 * in the answer.
 *
 * A room with no topics gets no stats line at all on the card rather than
 * "0 topics · 0 posts · 0 members", which is the invented-content rule broken
 * in the other direction: three zeros read as a room that failed, not as one
 * that has not started.
 */
/** `roomId` reads that one room's line rather than every room's (a room's own page). */
export function useRoomStats(roomId?: string): {
  stats: Map<string, RoomStats>;
  loading: boolean;
  reload: () => void;
} {
  const [stats, setStats] = useState<Map<string, RoomStats>>(new Map());
  const [loading, setLoading] = useState(true);
  // The same shape as useChatRooms above, and for the same reason: a counter in
  // state would leave the effect with a dependency it never reads.
  const inFlight = useRef<AbortController | null>(null);
  const kept = useKeptRead();

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const aborted = () => controller.signal.aborted;
    const landed = kept.start(roomId ?? '');

    try {
      let query = getSupabase()
        .from('chat_room_stats')
        // post_count and member_count are still in the view and are not
        // read. See RoomStats.
        .select('room_id, topic_count, question_count, reply_count, view_count, last_activity_at');
      if (roomId) query = query.eq('room_id', roomId);
      const { data, error } = await query.abortSignal(controller.signal);
      if (aborted()) return;
      if (error) {
        // Stats are decoration on a card that is readable without them, so a
        // failure loses the line and says nothing.
        setStats(new Map());
        setLoading(false);
        return;
      }
      // Typed as string|number rather than number: these are bigint columns,
      // and the client hands a bigint over as a string once it passes 2^53.
      // Saying `number` and being handed "3" would make a card read "3 topics"
      // and the arithmetic beside it nonsense.
      const rows = data as {
        room_id: string;
        topic_count: number | string;
        question_count: number | string;
        reply_count: number | string;
        view_count: number | string;
        last_activity_at: string | null;
      }[];
      setStats(
        new Map(
          rows.map((row) => [
            row.room_id,
            {
              topicCount: Number(row.topic_count),
              questionCount: Number(row.question_count),
              replyCount: Number(row.reply_count),
              viewCount: Number(row.view_count),
              lastActivityAt: row.last_activity_at,
            },
          ]),
        ),
      );
      setLoading(false);
      landed();
    } catch {
      if (aborted()) return;
      setStats(new Map());
      setLoading(false);
    }
  }, [roomId, kept]);

  useEffect(() => {
    if (!kept.fresh(roomId ?? '')) void load();
    return () => {
      inFlight.current?.abort();
    };
  }, [load, kept, roomId]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return { stats, loading, reload };
}
