import { describe, expect, it } from 'vitest';
import { geocodeNow, RUN_FOR_MS } from './geocode-now.js';

/** Each claim takes the next batch; then nothing. Records every call. */
function fakeSupabase(batches, tables = {}) {
  const calls = [];
  const written = [];
  // A query chain that ends in the table's rows, whatever it filters on.
  const read = (table) => {
    const chain = {
      select: () => chain,
      not: () => chain,
      gte: () => chain,
      // biome-ignore lint/suspicious/noThenProperty: a Supabase query is awaited as a thenable
      then: (done) => done({ data: tables[table] ?? [], error: null }),
    };
    return chain;
  };
  return {
    calls,
    written,
    from: (table) => ({
      ...read(table),
      upsert: (row) => {
        written.push([table, row]);
        return Promise.resolve({ error: null });
      },
    }),
    rpc: (name, args) => {
      calls.push([name, args?.p_target ?? null]);
      if (name === 'geocodes_enqueue_stale') return Promise.resolve({ data: 2, error: null });
      if (name === 'geocodes_claim_for_import')
        return Promise.resolve({ data: batches.shift() ?? [], error: null });
      return Promise.resolve({ data: true, error: null });
    },
  };
}

const row = (target_id, query) => ({ kind: 'event', target_id, query, state: 'CA' });
const at = { state: 'CA', latitude: 38.5, longitude: -121.7, precision: 'exact' };

describe('geocodeNow', () => {
  it("places a new member's zip, not waiting for the nightly import", async () => {
    const supabase = fakeSupabase([], { members: [{ zip: '94536' }] });
    await geocodeNow(supabase, {
      lookup: () => Promise.resolve(at),
      lookUpZip: () => Promise.resolve({ state: 'CA', latitude: 37.56, longitude: -122.01 }),
      lookUpCity: () => Promise.resolve(null),
      pauseMs: 0,
    });
    expect(supabase.written).toEqual([
      ['zip_places', expect.objectContaining({ zip: '94536', latitude: 37.56 })],
    ]);
  });

  it('queues, claims and places through the shared queue until nothing is claimable', async () => {
    const supabase = fakeSupabase([[row('e1', 'A, CA'), row('e2', 'B, CA')]]);
    const asked = [];
    await geocodeNow(supabase, {
      lookup: (query) => {
        asked.push(query);
        return Promise.resolve(at);
      },
      pauseMs: 0,
    });
    expect(asked).toEqual(['A, CA', 'B, CA']);
    expect(supabase.calls).toEqual([
      ['geocodes_enqueue_stale', null],
      ['geocodes_claim_for_import', null],
      ['geocode_done', 'e1'],
      ['geocode_done', 'e2'],
      ['geocodes_claim_for_import', null],
    ]);
  });

  it('starts no lookup that could end after five minutes, and gives the rest back', async () => {
    let clock = 0;
    const supabase = fakeSupabase([[row('e1', 'A, CA'), row('e2', 'B, CA'), row('e3', 'C, CA')]]);
    await geocodeNow(supabase, {
      lookup: () => {
        clock += RUN_FOR_MS * 0.7;
        return Promise.resolve(at);
      },
      pauseMs: 0,
      now: () => clock,
    });
    expect(supabase.calls.filter(([name]) => name === 'geocode_done')).toEqual([
      ['geocode_done', 'e1'],
    ]);
    expect(supabase.calls.filter(([name]) => name === 'geocode_release')).toEqual([
      ['geocode_release', 'e2'],
      ['geocode_release', 'e3'],
    ]);
  });

  it('stops claiming after five minutes, however many batches wait', async () => {
    let clock = 0;
    const batches = [1, 2, 3, 4, 5].map((i) => [row(`e${i}`, `${i} Main St, CA`)]);
    const supabase = fakeSupabase(batches);
    await geocodeNow(supabase, {
      lookup: () => {
        clock += 100_000;
        return Promise.resolve(at);
      },
      pauseMs: 0,
      now: () => clock,
    });
    expect(supabase.calls.filter(([name]) => name === 'geocode_done')).toHaveLength(3);
  });
});
