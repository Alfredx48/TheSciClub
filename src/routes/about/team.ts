import { useEffect, useState } from 'react';
import { type BrowseMemberRow, toMember } from '@/lib/members';
import { getSupabase } from '@/lib/supabase';
import type { BrowseMember } from '@/types/domain';

/**
 * The members on About us (about_us_team, 20261115150000), as Peers draws
 * them. City, state, age and injury date are null; the year comes alone. The
 * name is the first name only, and there is no username (20261120130000).
 */
export interface TeamMember {
  member: BrowseMember;
  injuryYear: number | null;
  /** A last name was left off, to be shown blurred. */
  lastNameHidden: boolean;
}

type TeamRow = BrowseMemberRow & {
  injury_year: number | null;
  last_name_hidden?: boolean | null;
};

export interface TeamState {
  team: TeamMember[] | null;
  failed: boolean;
}

/** Read once a visit: the list and each profile share it. */
let kept: Promise<TeamMember[]> | null = null;

function readTeam(): Promise<TeamMember[]> {
  kept ??= Promise.resolve(getSupabase().rpc('about_us_team')).then(({ data, error }) => {
    if (error) throw error;
    return ((data as TeamRow[] | null) ?? []).map((row) => ({
      member: toMember(row),
      injuryYear: row.injury_year,
      lastNameHidden: row.last_name_hidden === true,
    }));
  });
  kept.catch(() => {
    kept = null;
  });
  return kept;
}

export function useTeam(): TeamState {
  const [state, setState] = useState<TeamState>({ team: null, failed: false });
  useEffect(() => {
    let live = true;
    readTeam().then(
      (team) => {
        if (live) setState({ team, failed: false });
      },
      () => {
        if (live) setState({ team: null, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}
