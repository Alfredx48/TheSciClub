import { render as renderPlain, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { StandingCard, standingFor } from '@/routes/me/standing';
import type { MyStrike } from '@/routes/me/standing-api';

/** The card links to the Terms, so it needs a router. */
const render = (ui: React.ReactElement) => renderPlain(<MemoryRouter>{ui}</MemoryRouter>);

function strike(o: Partial<MyStrike> = {}): MyStrike {
  return {
    id: 's1',
    reason: 'Sold supplements in a room',
    issuedAt: new Date().toISOString(),
    withdrawnAt: null,
    withdrawnReason: null,
    ...o,
  };
}

/** `months` ago, as an ISO string. */
function monthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

describe('what the card says', () => {
  it('reads Good standing when there is nothing against you, and says no more', () => {
    // The card says where you stand; what can end a membership is in the Terms.
    render(<StandingCard invitedBy="NorCal SCI" strikes={[]} />);
    expect(screen.getByText('Good standing')).toBeInTheDocument();
    expect(screen.queryByText(/Selling to members/)).not.toBeInTheDocument();
  });

  it('names the reason, not just the count', () => {
    // Being told you are on a strike without being told what for is the thing
    // that makes somebody leave quietly rather than correct course.
    render(<StandingCard invitedBy={null} strikes={[strike()]} />);
    expect(screen.getByText('One strike')).toBeInTheDocument();
    expect(screen.getByText('Sold supplements in a room')).toBeInTheDocument();
  });

  it('says plainly what the second one means', () => {
    render(
      <StandingCard
        invitedBy={null}
        strikes={[strike({ id: 'a' }), strike({ id: 'b', reason: 'Repeated a room' })]}
      />,
    );
    expect(screen.getByText('Two strikes')).toBeInTheDocument();
    expect(screen.getByText('One more pauses your membership for 30 days.')).toBeInTheDocument();
  });

  it('says the next three close the account, after a pause for strikes', () => {
    // 20261120110000: three pause a membership for 30 days; three more after
    // that close it. A flag on an anonymous post is one of them.
    render(
      <StandingCard
        invitedBy={null}
        afterPause
        strikes={[strike({ id: 'a' }), strike({ id: 'b', anonymous: true, reason: 'Rude' })]}
      />,
    );
    expect(screen.getByText('One more closes your account for good.')).toBeInTheDocument();
    expect(screen.getByText(/Anonymous post flagged/)).toBeInTheDocument();
  });

  it('leaves out a withdrawn strike, and one that has aged out', () => {
    // Both are on the record and an administrator can see them. A member
    // reading where they stand today is owed what counts today.
    render(
      <StandingCard
        invitedBy={null}
        strikes={[
          strike({ id: 'gone', reason: 'Withdrawn one', withdrawnAt: new Date().toISOString() }),
          strike({ id: 'old', reason: 'Ancient one', issuedAt: monthsAgo(13) }),
        ]}
      />,
    );
    expect(screen.getByText('Good standing')).toBeInTheDocument();
    expect(screen.queryByText('Withdrawn one')).not.toBeInTheDocument();
    expect(screen.queryByText('Ancient one')).not.toBeInTheDocument();
  });

  it('says nothing about strikes before they have loaded', () => {
    // Null, not an empty array: "Good standing" flashed at somebody on two and
    // then corrected itself would be the worst possible moment to be wrong.
    render(<StandingCard invitedBy={null} strikes={null} />);
    expect(screen.getByText('Good standing')).toBeInTheDocument();
  });
});

describe('standingFor', () => {
  it('escalates, and stops escalating past three', () => {
    expect(standingFor(0).title).toBe('Good standing');
    expect(standingFor(1).title).toBe('One strike');
    expect(standingFor(2).title).toBe('Two strikes');
    expect(standingFor(3).title).toMatch(/paused/i);
    expect(standingFor(9).title).toMatch(/paused/i);
  });
});

// The owner, 2026-10-28: a link to the Terms' list, not a panel.
describe('what can end a membership', () => {
  it('links to where the Terms say it', () => {
    render(<StandingCard invitedBy={null} strikes={[]} />);
    expect(screen.getByRole('link', { name: 'What can end a membership' })).toHaveAttribute(
      'href',
      '/terms#losing-your-membership',
    );
  });
});
