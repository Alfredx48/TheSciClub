import { Capacitor } from '@capacitor/core';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LinkPreview } from '@/lib/chat/types';
import * as standalone from '@/lib/standalone';
import { LinkPreviewCard } from '@/routes/chat/link-preview-card';

const signed = vi.hoisted(() => ({ asked: [] as [string[], string][] }));

// Signing is a read of the club; the card only has to ask the right bucket.
vi.mock('@/lib/chat/attachments', () => ({
  useAttachmentUrls: (paths: string[], bucket: string) => {
    signed.asked.push([paths, bucket]);
    return new Map(paths.map((path) => [path, `https://signed.example/${path}`]));
  },
}));

const page: LinkPreview = {
  url: 'https://www.reeve.org/',
  title: 'The Christopher & Dana Reeve Foundation',
  description: 'Curing spinal cord injury.',
  siteName: 'Reeve',
  imagePath: `${'b'.repeat(64)}.webp`,
  youtubeId: null,
};

const video: LinkPreview = {
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'A song',
  description: 'Rick Astley',
  siteName: 'YouTube',
  imagePath: `${'c'.repeat(64)}.jpg`,
  youtubeId: 'dQw4w9WgXcQ',
};

describe('a page', () => {
  it('is one link to the page, named by its site and title, opening elsewhere', () => {
    render(<LinkPreviewCard preview={page} />);
    const link = screen.getByRole('link', {
      name: /Reeve.*The Christopher & Dana Reeve Foundation/,
    });
    expect(link).toHaveAttribute('href', 'https://www.reeve.org/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    expect(screen.getByText('Curing spinal cord injury.')).toBeInTheDocument();
  });

  it("draws the club's own copy of the picture, from the link-previews bucket", () => {
    signed.asked = [];
    const { container } = render(<LinkPreviewCard preview={page} />);
    expect(signed.asked).toContainEqual([[page.imagePath], 'link-previews']);
    // Decorative: the link is named by its words.
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      `https://signed.example/${page.imagePath}`,
    );
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('names the site from the address when the page did not', () => {
    render(<LinkPreviewCard preview={{ ...page, siteName: null }} />);
    expect(screen.getByText('reeve.org')).toBeInTheDocument();
  });
});

describe('a YouTube video', () => {
  it('loads nothing from YouTube until play is pressed, then plays in place', async () => {
    const { container } = render(<LinkPreviewCard preview={video} />);
    expect(container.querySelector('iframe')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Play video: A song' }));

    const player = container.querySelector('iframe');
    expect(player).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&playsinline=1',
    );
    expect(player).toHaveAttribute('title', 'YouTube video: A song');
    expect(screen.queryByRole('button', { name: /Play video/ })).toBeNull();
  });

  it('on the Home Screen, keeps the thumbnail until YouTube loads without autoplay', async () => {
    const homeScreen = vi.spyOn(standalone, 'isStandalone').mockReturnValue(true);
    try {
      const { container } = render(<LinkPreviewCard preview={video} />);
      expect(container.querySelector('iframe')).toBeNull();
      const thumbnail = container.querySelector('img');

      await userEvent.click(screen.getByRole('button', { name: 'Play video: A song' }));

      const player = container.querySelector('iframe');
      if (!player) throw new Error('no player');
      expect(player).toHaveAttribute(
        'src',
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&rel=0&playsinline=1',
      );
      expect(player).toHaveAttribute('aria-hidden', 'true');
      expect(thumbnail).toBeVisible();
      expect(container.querySelector('img')).toBe(thumbnail);
      expect(screen.getByRole('status')).toBeVisible();

      fireEvent.load(player);

      expect(player).not.toHaveAttribute('aria-hidden');
      expect(player).not.toHaveClass('invisible');
      expect(container.querySelector('img')).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      homeScreen.mockRestore();
    }
  });

  it('on the website, no "Open in YouTube" link is added under the player', async () => {
    render(<LinkPreviewCard preview={video} />);
    await userEvent.click(screen.getByRole('button', { name: 'Play video: A song' }));
    expect(screen.queryByRole('link', { name: /Open in YouTube/ })).toBeNull();
  });

  it("on the website, frames YouTube itself, never the app's player page", async () => {
    const { container } = render(<LinkPreviewCard preview={video} />);
    await userEvent.click(screen.getByRole('button', { name: 'Play video: A song' }));
    const src = container.querySelector('iframe')?.getAttribute('src') ?? '';
    expect(src.startsWith('https://www.youtube-nocookie.com/embed/')).toBe(true);
    expect(src).not.toContain('thesciclub.com');
  });

  // YouTube refuses a frame on capacitor://localhost; the club's page is on thesciclub.com.
  it("in the store app, play frames the club's player page in place", async () => {
    const native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    try {
      const { container } = render(<LinkPreviewCard preview={video} />);
      expect(screen.queryByRole('link', { name: /Open in YouTube/ })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Play video: A song' }));
      const player = container.querySelector('iframe');
      expect(player).toHaveAttribute(
        'src',
        'https://thesciclub.com/embed/youtube.html#v=dQw4w9WgXcQ',
      );
      expect(player).toHaveAttribute('title', 'YouTube video: A song');
      expect(player).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      // Dark, not a white flash, before the page paints.
      expect(player).toHaveClass('bg-black');
      expect(player?.parentElement).toHaveClass('bg-black', 'aspect-video');
    } finally {
      native.mockRestore();
    }
  });

  it('in the store app, an Open in YouTube link under the player is at least 44px tall', async () => {
    const native = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    try {
      const { container } = render(<LinkPreviewCard preview={video} />);
      await userEvent.click(screen.getByRole('button', { name: 'Play video: A song' }));
      const open = screen.getByRole('link', { name: /Open in YouTube/ });
      expect(open).toHaveAttribute('href', video.url);
      expect(open).toHaveAttribute('target', '_blank');
      expect(open).toHaveClass('min-h-[44px]');
      expect(open.previousElementSibling).toBe(container.querySelector('iframe')?.parentElement);
    } finally {
      native.mockRestore();
    }
  });

  it('still links to the video on YouTube by its title', () => {
    render(<LinkPreviewCard preview={video} />);
    expect(screen.getByRole('link', { name: /A song/ })).toHaveAttribute('href', video.url);
  });
});

describe('a small picture', () => {
  it('becomes a thumbnail beside the words once it turns out to be small', () => {
    const { container } = render(<LinkPreviewCard preview={page} />);
    const img = container.querySelector('img');
    if (!img) throw new Error('no picture');
    expect(img.parentElement).toHaveClass('aspect-[1.91/1]');
    Object.defineProperty(img, 'naturalWidth', { value: 100 });
    fireEvent.load(img);
    expect(img.parentElement).toHaveClass('w-[4.5rem]');
    expect(img.parentElement).not.toHaveClass('aspect-[1.91/1]');
  });
});
