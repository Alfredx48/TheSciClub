import { useCallback, useEffect, useState } from 'react';
import type { ChatRoom, RoomCategory } from '@/lib/chat/types';
import { describeError, describeThrown, type Failure } from '@/lib/describe-error';
import { getSupabase } from '@/lib/supabase';

/** The topics a member started, for Me → My posts (the owner, 2026-11-09). */
export interface MyTopic {
  id: string;
  roomId: string;
  title: string;
  createdAt: string;
  replyCount: number;
  isQuestion: boolean;
}

export type MyTopicKind = 'all' | 'question' | 'post';

interface Row {
  id: string;
  room_id: string;
  title: string;
  created_at: string;
  reply_count: number;
  is_question?: boolean;
}

/**
 * Newest first, of the kind and room type asked. A topic in a room that is
 * not open is left out, as on Home: administrators can read closed rooms.
 */
export function filterMyTopics(
  topics: readonly MyTopic[],
  rooms: readonly ChatRoom[],
  kind: MyTopicKind,
  category: RoomCategory | 'all',
): MyTopic[] {
  const open = new Map(rooms.filter((r) => r.openedAt !== null).map((r) => [r.id, r]));
  return topics
    .filter((t) => {
      const room = open.get(t.roomId);
      if (!room) return false;
      if (category !== 'all' && room.category !== category) return false;
      if (kind === 'question') return t.isQuestion;
      if (kind === 'post') return !t.isQuestion;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function useMyTopics(userId: string | null) {
  const [topics, setTopics] = useState<MyTopic[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const supabase = getSupabase();
      // An anonymous topic has no author; the member's own come by id
      // (20261120100000).
      const anonymous = (await supabase.rpc('my_anonymous_topic_ids')) as {
        data: string[] | null;
        error: Failure | null;
      };
      if (anonymous.error) {
        setError(describeError(anonymous.error, 'Could not load your posts.'));
        return;
      }
      const anonymousIds = anonymous.data ?? [];
      const mine =
        anonymousIds.length > 0
          ? `author_id.eq.${userId},id.in.(${anonymousIds.join(',')})`
          : `author_id.eq.${userId}`;
      const { data, error: failure } = (await supabase
        .from('chat_topics')
        .select('id, room_id, title, created_at, reply_count, is_question')
        .or(mine)
        .order('created_at', { ascending: false })
        .limit(500)) as { data: Row[] | null; error: Failure | null };
      if (failure) {
        setError(describeError(failure, 'Could not load your posts.'));
        return;
      }
      setTopics(
        (data ?? []).map((row) => ({
          id: row.id,
          roomId: row.room_id,
          title: row.title,
          createdAt: row.created_at,
          replyCount: row.reply_count,
          isQuestion: row.is_question === true,
        })),
      );
    } catch (e) {
      setError(describeThrown(e, 'Could not load your posts.'));
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { topics, error, reload: load };
}
