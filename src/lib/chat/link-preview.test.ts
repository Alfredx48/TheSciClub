import { describe, expect, it } from 'vitest';
import {
  appYoutubeEmbedUrl,
  siteOf,
  toLinkPreview,
  youtubeEmbedUrl,
} from '@/lib/chat/link-preview';

const full = {
  url: 'https://www.reeve.org/',
  title: 'Reeve Foundation',
  description: 'Paralysis resources',
  siteName: 'Reeve',
  imagePath: `${'a'.repeat(64)}.webp`,
  youtubeId: null,
};

describe('toLinkPreview', () => {
  it('reads a preview the database wrote', () => {
    expect(toLinkPreview(full)).toEqual(full);
  });

  it.each([
    ['nothing', null],
    ['a string', 'https://x.example'],
    ['an array', [full]],
    ['no address', { ...full, url: null }],
    ['an address a browser would run', { ...full, url: 'javascript:alert(1)' }],
    ['nothing to draw', { url: 'https://x.example', title: '  ', imagePath: null }],
  ])('is no preview for %s', (_, raw) => {
    expect(toLinkPreview(raw)).toBeNull();
  });

  it('drops a picture path or a video id that is not one', () => {
    const preview = toLinkPreview({
      ...full,
      imagePath: '../photos/someone.webp',
      youtubeId: '"><script>',
    });
    expect(preview).toMatchObject({ imagePath: null, youtubeId: null, title: 'Reeve Foundation' });
  });

  it('keeps the other videos only after a first one, and only whole ones', () => {
    const good = {
      url: 'https://youtu.be/bbbbbbbbbbb',
      title: null,
      imagePath: null,
      youtubeId: 'bbbbbbbbbbb',
    };
    const videos = [good, { ...good, youtubeId: 'nope' }, { ...good, url: 'javascript:x' }, 'x'];
    expect(toLinkPreview({ ...full, youtubeId: 'aaaaaaaaaaa', videos })?.videos).toEqual([good]);
    expect(toLinkPreview({ ...full, videos })?.videos).toBeUndefined();
  });

  it('ignores a field of the wrong type rather than drawing it', () => {
    expect(toLinkPreview({ ...full, title: 42, description: { x: 1 } })).toMatchObject({
      title: null,
      description: null,
    });
  });
});

describe('youtubeEmbedUrl', () => {
  it('plays from the privacy-enhanced host, inline on a phone', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1',
    );
  });
});

describe('appYoutubeEmbedUrl', () => {
  it("is the club's player page, passing only the id", () => {
    expect(appYoutubeEmbedUrl('dQw4w9WgXcQ')).toBe(
      'https://thesciclub.com/embed/youtube.html#v=dQw4w9WgXcQ',
    );
  });
});

describe('siteOf', () => {
  it('names the site without its www', () => {
    expect(siteOf('https://www.reeve.org/about')).toBe('reeve.org');
  });
});
