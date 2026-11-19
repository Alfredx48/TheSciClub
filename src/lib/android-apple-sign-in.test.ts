import { expect, it, vi } from 'vitest';
import {
  androidAppleCallback,
  finishAndroidApple,
  startAndroidApple,
} from '@/lib/android-apple-sign-in';

const { auth } = vi.hoisted(() => ({
  auth: {
    getSession: vi.fn(),
    linkIdentity: vi.fn<(request: { options: { redirectTo: string } }) => unknown>(),
    exchangeCodeForSession: vi.fn(),
  },
}));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth }) }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: vi.fn() } }));

it('exchanges a callback only for the pending Apple flow and its original account', async () => {
  const returnUrl = 'com.thesciclub.app://auth/apple';
  const wrongFlow = new URL(`${returnUrl}?code=abc&attempt=other`);
  expect(androidAppleCallback('https://thesciclub.com/auth/apple?code=abc')).toBeNull();
  expect(androidAppleCallback(`${returnUrl}/extra?code=abc`)).toBeNull();
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'member' } } }, error: null });
  auth.linkIdentity.mockResolvedValue({
    data: { url: 'https://appleid.apple.com/', flowId: 'mine' },
  });
  auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: null });

  await expect(finishAndroidApple(wrongFlow)).resolves.toBeNull();
  await expect(startAndroidApple('linked')).resolves.toMatchObject({ redirected: true });
  const code = new URL(auth.linkIdentity.mock.lastCall?.[0].options.redirectTo ?? '');
  code.searchParams.set('code', 'abc');
  await expect(finishAndroidApple(wrongFlow)).resolves.toBeNull();
  await expect(finishAndroidApple(code)).resolves.toBe('/me?tab=account&apple=linked');
  expect(auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('abc', { flowId: 'mine' });
  await expect(finishAndroidApple(code)).resolves.toBeNull();

  await startAndroidApple('linked');
  const nextCode = new URL(auth.linkIdentity.mock.lastCall?.[0].options.redirectTo ?? '');
  nextCode.searchParams.set('code', 'abc');
  auth.getSession.mockResolvedValue({
    data: { session: { user: { id: 'someone-else' } } },
    error: null,
  });
  await expect(finishAndroidApple(nextCode)).resolves.toBeNull();
  expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
});
