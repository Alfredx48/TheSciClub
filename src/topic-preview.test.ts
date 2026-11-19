import { describe, expect, it } from 'vitest';
import {
  privatePostPage,
  questionTitle,
  sharedQuestionPage,
  topicIdIn,
} from '../netlify/edge-functions/topic-preview';

const ID = '11111111-1111-4111-8111-111111111111';
const URL = `https://thesciclub.com/chat/rooms/r/topics/${ID}?from=abc`;

// The owner, 2026-11-16: the question as the title of a shared link's preview.
// The club is private, so only a link an administrator made to let people in
// shows it; any other link to a post shows nothing of it.
describe('a link to a question in a text message', () => {
  it('shows the question for an invite link, and nothing of a post otherwise', () => {
    expect(topicIdIn(`/chat/rooms/r/topics/${ID}`)).toBe(ID);
    expect(topicIdIn('/chat/rooms/r')).toBeNull();

    const shared = sharedQuestionPage({ title: 'Cushions: <Roho> or "Jay"?' }, URL);
    expect(shared).toContain(
      '<meta property="og:title" content="Cushions: &lt;Roho&gt; or &quot;Jay&quot;?" />',
    );

    const plain = privatePostPage(URL);
    expect(plain).toContain('content="A post on The SCI Club"');
    expect(plain).not.toContain('Cushions');

    const long = questionTitle(`${'word '.repeat(40)}end`);
    expect(long.length).toBeLessThanOrEqual(110);
    expect(long.endsWith('…')).toBe(true);
  });
});
