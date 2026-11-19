import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Notifications from '@/lib/push/notifications';
import type { NotificationState } from '@/lib/push/notifications';
import { NotificationSettings } from '@/routes/me/notification-settings';

const hook = vi.hoisted(() => ({
  state: null as NotificationState | null,
  error: null as string | null,
  busy: false,
  turnedOn: 0,
  turnedOff: 0,
  /** The store app on an iPhone. */
  app: false,
}));

const kinds = vi.hoisted(() => ({
  muted: null as Set<string> | null,
  toggled: [] as string[],
}));

vi.mock('@/lib/push/notifications', async (importOriginal) => ({
  // The real list, so the test reads the labels a member will.
  NOTIFICATION_KINDS: (await importOriginal<typeof Notifications>()).NOTIFICATION_KINDS,
  isAppPush: () => hook.app,
  useNotificationKinds: () => ({
    muted: kinds.muted,
    busy: null,
    error: null,
    toggle: (kind: string) => {
      kinds.toggled.push(kind);
    },
  }),
  useDeviceNotifications: () => ({
    state: hook.state,
    error: hook.error,
    busy: hook.busy,
    turnOn: () => {
      hook.turnedOn++;
    },
    turnOff: () => {
      hook.turnedOff++;
    },
  }),
}));

beforeEach(() => {
  hook.state = null;
  hook.error = null;
  hook.busy = false;
  hook.turnedOn = 0;
  hook.turnedOff = 0;
  hook.app = false;
  kinds.muted = new Set();
  kinds.toggled = [];
});

describe('NotificationSettings', () => {
  // Null is both "the club cannot send yet" and "still reading". Neither may
  // draw a control: the first would do nothing, the second is about to change.
  it('draws nothing while there is no state', () => {
    const { container } = render(<NotificationSettings userId="u1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says how to add the club to the Home Screen, and offers no button', () => {
    hook.state = 'install';
    render(<NotificationSettings userId="u1" />);
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says which iOS is needed when the installed app still cannot', () => {
    hook.state = 'unsupported';
    render(<NotificationSettings userId="u1" />);
    expect(screen.getByText(/iOS 16\.4 or later/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('turns on from off', async () => {
    hook.state = 'off';
    render(<NotificationSettings userId="u1" />);
    expect(screen.getByText('Off on this device.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on notifications' }));
    expect(hook.turnedOn).toBe(1);
  });

  it('turns off from on', async () => {
    hook.state = 'on';
    render(<NotificationSettings userId="u1" />);
    expect(screen.getByText('On for this device.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(hook.turnedOff).toBe(1);
  });

  // The system will not ask again, so a button would do nothing.
  it('says where in Settings a refusal is changed, and offers no button', () => {
    hook.state = 'refused';
    render(<NotificationSettings userId="u1" />);
    expect(screen.getByText(/open Settings, then Notifications/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Settings' })).not.toBeInTheDocument();
  });

  it('in the iPhone app, opens the club’s page in Settings after a refusal', () => {
    hook.state = 'refused';
    hook.app = true;
    render(<NotificationSettings userId="u1" />);
    expect(screen.getByText(/turn on Allow Notifications/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      'app-settings:',
    );
  });

  // The state sentence is what answers the button, so it must be announced.
  it('speaks a change of state', () => {
    hook.state = 'on';
    render(<NotificationSettings userId="u1" />);
    expect(screen.getByText('On for this device.')).toHaveAttribute('aria-live', 'polite');
  });

  it('shows a failure as an alert', () => {
    hook.state = 'off';
    hook.error = 'Notifications were not turned on.';
    render(<NotificationSettings userId="u1" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Notifications were not turned on.');
  });

  it('cannot be pressed twice while it works', () => {
    hook.state = 'off';
    hook.busy = true;
    render(<NotificationSettings userId="u1" />);
    expect(screen.getByRole('button', { name: 'One moment…' })).toBeDisabled();
  });

  describe('the notification kinds', () => {
    it('can be edited even when alerts are off on this browser', async () => {
      hook.state = 'off';
      render(<NotificationSettings userId="u1" />);
      await userEvent.click(screen.getByRole('button', { name: /Choose which notifications/ }));
      expect(screen.getByRole('button', { name: /Being added to a group/ })).toBeInTheDocument();
    });

    // Folded away: the list filled a phone screen (the owner, 2026-10-07).
    it('are folded behind one button that says how many are on', async () => {
      hook.state = 'on';
      kinds.muted = new Set(['group_add']);
      render(<NotificationSettings userId="u1" />);
      expect(
        screen.queryByRole('button', { name: /Events I am going to, the day before/ }),
      ).toBeNull();
      const fold = screen.getByRole('button', { name: /Choose which notifications/ });
      expect(fold).toHaveAttribute('aria-expanded', 'false');
      expect(fold).toHaveTextContent(/\d+ of \d+ on/);
      await userEvent.click(fold);
      expect(fold).toHaveAttribute('aria-expanded', 'true');
      expect(
        screen.getByRole('button', { name: /Events I am going to, the day before/ }),
      ).toBeInTheDocument();
    });

    // 20261105160000, the owner's wording.
    it('says a busy conversation notifies at most every 2 minutes', async () => {
      hook.state = 'on';
      render(<NotificationSettings userId="u1" />);
      await userEvent.click(screen.getByRole('button', { name: /Choose which notifications/ }));
      expect(
        screen.getByText(
          /A busy conversation notifies you at most every 2 minutes, saying how many are new, and not while you have it open\./,
        ),
      ).toBeInTheDocument();
    });

    it('offer each kind as a switch that says whether it is on', async () => {
      hook.state = 'on';
      kinds.muted = new Set(['group_add']);
      render(<NotificationSettings userId="u1" />);
      await userEvent.click(screen.getByRole('button', { name: /Choose which notifications/ }));
      expect(
        screen.getByRole('button', { name: /Events I am going to, the day before/ }),
      ).toHaveAttribute('aria-pressed', 'true');
      const group = screen.getByRole('button', { name: /Being added to a group/ });
      expect(group).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(group);
      expect(kinds.toggled).toEqual(['group_add']);
    });

    // The owner, 2026-10-27: reactions notify, with their own switch beside Likes.
    it('offer reactions as a switch of their own, next to likes', async () => {
      hook.state = 'on';
      kinds.muted = new Set(['reaction']);
      render(<NotificationSettings userId="u1" />);
      await userEvent.click(screen.getByRole('button', { name: /Choose which notifications/ }));
      const likes = screen.getByRole('button', { name: /Likes on my posts and replies/ });
      const reactions = screen.getByRole('button', {
        name: /Reactions to my posts, replies and messages/,
      });
      expect(likes).toHaveAttribute('aria-pressed', 'true');
      expect(reactions).toHaveAttribute('aria-pressed', 'false');
      expect(likes.closest('li')?.nextElementSibling).toBe(reactions.closest('li'));
      await userEvent.click(reactions);
      expect(kinds.toggled).toEqual(['reaction']);
    });

    // 20261029070000: a mention has its own switch, after reactions.
    it('offer mentions as a switch of their own', async () => {
      hook.state = 'on';
      kinds.muted = new Set(['mention']);
      render(<NotificationSettings userId="u1" />);
      await userEvent.click(screen.getByRole('button', { name: /Choose which notifications/ }));
      const reactions = screen.getByRole('button', {
        name: /Reactions to my posts, replies and messages/,
      });
      const mentions = screen.getByRole('button', { name: /Being mentioned in a post or reply/ });
      expect(mentions).toHaveAttribute('aria-pressed', 'false');
      expect(reactions.closest('li')?.nextElementSibling).toBe(mentions.closest('li'));
      await userEvent.click(mentions);
      expect(kinds.toggled).toEqual(['mention']);
    });

    // Do not spend a switch on something that cannot happen to this member.
    it('show invites to mentors only and reports to administrators only', async () => {
      hook.state = 'on';
      const { unmount } = render(<NotificationSettings userId="u1" />);
      await userEvent.click(screen.getByRole('button', { name: /Choose which notifications/ }));
      expect(screen.queryByRole('button', { name: /Somebody I invited/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /New reports/ })).toBeNull();
      unmount();
      render(<NotificationSettings userId="u1" isMentor isAdmin />);
      await userEvent.click(screen.getByRole('button', { name: /Choose which notifications/ }));
      expect(screen.getByRole('button', { name: /Somebody I invited/ })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'New reports, and the weekly count of blocks' }),
      ).toBeInTheDocument();
    });
  });
});
