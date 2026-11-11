import { describe, expect, it, vi } from 'vitest';
import { type Deps, inviteSignup } from './handler';

function deps(
  overrides: {
    address?: string | null;
    admits?: boolean;
    invited?: boolean;
    mayJoin?: boolean;
    made?: boolean;
    noted?: boolean;
  } = {},
) {
  const {
    address = 'sam@example.com',
    admits = true,
    invited = false,
    mayJoin = false,
    made = true,
    noted = true,
  } = overrides;
  return {
    inviteAddress: vi.fn(() => Promise.resolve(address)),
    codeAdmits: vi.fn(() => Promise.resolve(admits)),
    invited: vi.fn(() => Promise.resolve(invited)),
    mayJoin: vi.fn(() => Promise.resolve(mayJoin)),
    createConfirmedUser: vi.fn(() => Promise.resolve(made ? 'new-account' : null)),
    noteUnproven: vi.fn(() => Promise.resolve(noted)),
    removeUser: vi.fn(() => Promise.resolve()),
  } satisfies Deps;
}

const body = { email: 'Sam@Example.com ', password: 'long enough' };
const byInvite = { ...body, token: 'tok' };
const byCode = { ...body, code: 'abc' };

describe('with an invite link', () => {
  it('makes the account for the address the invite was sent to', async () => {
    const d = deps();
    expect(await inviteSignup(byInvite, d)).toEqual({ created: true });
    expect(d.createConfirmedUser).toHaveBeenCalledWith('sam@example.com', 'long enough', {
      invite_token: 'tok',
    });
  });

  it('trusts them with another address too', async () => {
    const d = deps();
    const other = { ...byInvite, email: 'other@example.com' };
    expect(await inviteSignup(other, d)).toEqual({ created: true });
    expect(d.createConfirmedUser).toHaveBeenCalledWith('other@example.com', 'long enough', {
      invite_token: 'tok',
    });
  });

  it('does not take the address of somebody else with a pending invite', async () => {
    const d = deps({ invited: true });
    const other = { ...byInvite, email: 'other@example.com' };
    expect(await inviteSignup(other, d)).toEqual({ created: false });
    expect(d.createConfirmedUser).not.toHaveBeenCalled();
  });

  it('refuses a link that is used, unknown or revoked', async () => {
    const d = deps({ address: null });
    expect(await inviteSignup(byInvite, d)).toEqual({ created: false });
    expect(d.createConfirmedUser).not.toHaveBeenCalled();
  });
});

describe('with a code', () => {
  it('makes the account while the code lets people in', async () => {
    const d = deps();
    expect(await inviteSignup(byCode, d)).toEqual({ created: true });
    expect(d.createConfirmedUser).toHaveBeenCalledWith('sam@example.com', 'long enough', {
      qr_code: 'abc',
    });
  });

  it('refuses a code that is off, expired or only gives credit', async () => {
    const d = deps({ admits: false });
    expect(await inviteSignup(byCode, d)).toEqual({ created: false });
    expect(d.createConfirmedUser).not.toHaveBeenCalled();
  });

  it('does not take the place of somebody with a pending invite', async () => {
    const d = deps({ invited: true });
    expect(await inviteSignup(byCode, d)).toEqual({ created: false });
    expect(d.createConfirmedUser).not.toHaveBeenCalled();
  });

  it('is used when the invite link is no longer any good', async () => {
    const d = deps({ address: null });
    expect(await inviteSignup({ ...byInvite, code: 'abc' }, d)).toEqual({ created: true });
  });
});

it('refuses a short password, and anything not a sign-up', async () => {
  const d = deps();
  expect(await inviteSignup({ ...byCode, password: 'short' }, d)).toEqual({ created: false });
  expect(await inviteSignup(null, d)).toEqual({ created: false });
  expect(await inviteSignup({ email: 1 }, d)).toEqual({ created: false });
  expect(await inviteSignup(body, d)).toEqual({ created: false });
  expect(d.createConfirmedUser).not.toHaveBeenCalled();
});

it('says no more than false when the account is refused', async () => {
  expect(await inviteSignup(byInvite, deps({ made: false }))).toEqual({ created: false });
});

// The owner, 2026-11-04: in now, confirm the address from Me (20261104110000).
describe('an address still to confirm', () => {
  it('is not noted for a link used at the address it went to', async () => {
    const d = deps();
    await inviteSignup(byInvite, d);
    expect(d.noteUnproven).not.toHaveBeenCalled();
  });

  it('is noted for a link used at another address, and for a code', async () => {
    const d = deps();
    await inviteSignup({ ...byInvite, email: 'other@example.com' }, d);
    await inviteSignup(byCode, d);
    expect(d.noteUnproven).toHaveBeenCalledTimes(2);
    expect(d.noteUnproven).toHaveBeenCalledWith('new-account');
  });

  it('takes the account away again when it cannot be noted', async () => {
    const d = deps({ noted: false });
    expect(await inviteSignup(byCode, d)).toEqual({ created: false });
    expect(d.removeUser).toHaveBeenCalledWith('new-account');
  });
});

// The owner, 2026-11-10: invited, or joining is open, is in now too.
describe('an address that may join now, with no link or code', () => {
  it('is let in, noted to confirm later', async () => {
    const d = deps({ mayJoin: true });
    expect(await inviteSignup(body, d)).toEqual({ created: true });
    expect(d.mayJoin).toHaveBeenCalledWith('sam@example.com');
    expect(d.createConfirmedUser).toHaveBeenCalledWith('sam@example.com', 'long enough', {});
    expect(d.noteUnproven).toHaveBeenCalledWith('new-account');
  });

  it('is refused when not invited and joining is closed, or blocked', async () => {
    const d = deps({ mayJoin: false });
    expect(await inviteSignup(body, d)).toEqual({ created: false });
    expect(d.createConfirmedUser).not.toHaveBeenCalled();
  });

  it('keeps a code the code path refused, for its credit', async () => {
    const d = deps({ invited: true, mayJoin: true });
    expect(await inviteSignup(byCode, d)).toEqual({ created: true });
    expect(d.createConfirmedUser).toHaveBeenCalledWith('sam@example.com', 'long enough', {
      qr_code: 'abc',
    });
    expect(d.noteUnproven).toHaveBeenCalled();
  });

  it('takes the account away again when it cannot be noted', async () => {
    const d = deps({ mayJoin: true, noted: false });
    expect(await inviteSignup(body, d)).toEqual({ created: false });
    expect(d.removeUser).toHaveBeenCalledWith('new-account');
  });
});
