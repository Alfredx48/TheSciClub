import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { AddressField } from '@/components/address-field';
import type { OrganizationPlaceDraft as OrganizationPlace } from '@/lib/organization-management';
import { US_STATES } from '@/types/domain';

const field =
  'mt-1 min-h-[44px] w-full rounded-[11px] border border-line bg-paper px-3 py-2 text-[1rem] text-ink';
const small =
  'flex min-h-[44px] items-center gap-1.5 rounded-lg border border-line px-3 font-bold text-[0.875rem] text-ink hover:bg-tint disabled:opacity-40';

/** A place being edited, with a key that stays put while it moves. */
export interface PlaceDraft extends OrganizationPlace {
  key: string;
}

let made = 0;
export function newPlace(): PlaceDraft {
  made += 1;
  return { key: `new-${made}`, label: null, address: null, city: '', state: '', postalCode: null };
}

export function toDrafts(places: OrganizationPlace[]): PlaceDraft[] {
  return places.map((place) => ({ ...place, key: place.id ?? newPlace().key }));
}

/** As the database's check (20261028700000). */
const ZIP = /^\d{5}(-\d{4})?$/;

/** Each kept place has a city and a state; an empty row is dropped. */
export function placesToSave(places: PlaceDraft[]): OrganizationPlace[] | string {
  const filled = (text: string | null) => (text ?? '').trim() !== '';
  const kept = places.filter(
    (p) =>
      filled(p.city) ||
      filled(p.state) ||
      filled(p.address) ||
      filled(p.label) ||
      filled(p.postalCode),
  );
  if (kept.some((p) => !filled(p.city) || !filled(p.state))) {
    return 'Each location needs a city and a state.';
  }
  if (kept.some((p) => filled(p.postalCode) && !ZIP.test((p.postalCode ?? '').trim()))) {
    return 'A ZIP code is five digits, or five, a dash and four.';
  }
  return kept.map(({ key: _, ...place }) => ({
    ...place,
    postalCode: filled(place.postalCode) ? (place.postalCode ?? '').trim() : null,
  }));
}

/**
 * Where an organization is, main place first (the contract of 2026-10-25):
 * label, street address, city, state, ZIP code. Facts from its own website only; a
 * published street address gets an exact pin (the owner, 2026-10-26).
 */
export function OrganizationLocations({
  places,
  onChange,
}: {
  places: PlaceDraft[];
  onChange: (next: PlaceDraft[]) => void;
}) {
  const set = (index: number, change: Partial<OrganizationPlace>) => {
    onChange(places.map((place, i) => (i === index ? { ...place, ...change } : place)));
  };
  const move = (index: number, by: -1 | 1) => {
    const next = [...places];
    const [taken] = next.splice(index, 1);
    if (taken) next.splice(index + by, 0, taken);
    onChange(next);
  };

  return (
    <section aria-labelledby="organization-locations" className="grid gap-2">
      <h4 id="organization-locations" className="text-ink">
        Locations
      </h4>
      <p id="organization-locations-hint" className="text-[0.8125rem] text-grey leading-[1.45]">
        Only as its own website shows them. A street address it publishes gets an exact pin. A P.O.
        box or a mailbox at a shipping store is not a street address: leave it blank, and the
        location shows at its city’s middle. Without a state it is not on the map. Addresses are
        suggested as you type; keep only what its website shows.
      </p>
      {places.length === 0 ? (
        <p className="text-[0.875rem] text-ink2">No locations yet: it is not on the map.</p>
      ) : null}
      <ol className="grid gap-3">
        {places.map((place, index) => {
          const name = `Location ${index + 1}`;
          return (
            <li key={place.key}>
              <fieldset className="rounded-[11px] border border-line p-3">
                <legend className="px-1 font-bold text-ink">
                  {name}
                  {index === 0 ? ' (main)' : ''}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="text-ink">
                    Label <span className="text-grey">(optional)</span>
                    <input
                      className={field}
                      maxLength={80}
                      placeholder="Main office"
                      value={place.label ?? ''}
                      onChange={(e) => {
                        set(index, { label: e.target.value });
                      }}
                    />
                  </label>
                  <AddressField
                    label={
                      <>
                        Street address <span className="text-grey">(as its website shows it)</span>
                      </>
                    }
                    className={field}
                    maxLength={200}
                    describedBy="organization-locations-hint"
                    value={place.address ?? ''}
                    onChange={(address) => {
                      set(index, { address });
                    }}
                    onPick={(found) => {
                      // The label is the editor's own words; a pick fills the rest.
                      set(index, {
                        address: found.street.slice(0, 200),
                        city: found.city,
                        state: found.state,
                        postalCode: found.postalCode || null,
                      });
                    }}
                  />
                  <AddressField
                    kind="city"
                    label="City"
                    className={field}
                    maxLength={160}
                    value={place.city}
                    onChange={(city) => {
                      set(index, { city });
                    }}
                    onPick={(found) => {
                      set(index, { city: found.city.slice(0, 160), state: found.state });
                    }}
                  />
                  <label className="text-ink">
                    State
                    <select
                      className={field}
                      value={place.state}
                      onChange={(e) => {
                        set(index, { state: e.target.value });
                      }}
                    >
                      <option value="">Choose a state</option>
                      {US_STATES.map(([code, label]) => (
                        <option key={code} value={code}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-ink">
                    ZIP code <span className="text-grey">(optional)</span>
                    <input
                      className={field}
                      inputMode="numeric"
                      autoComplete="postal-code"
                      maxLength={10}
                      value={place.postalCode ?? ''}
                      onChange={(e) => {
                        set(index, { postalCode: e.target.value });
                      }}
                    />
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={small}
                    disabled={index === 0}
                    aria-label={`Move ${name.toLowerCase()} up`}
                    onClick={() => {
                      move(index, -1);
                    }}
                  >
                    <ArrowUp aria-hidden="true" className="h-4 w-4" />
                    Up
                  </button>
                  <button
                    type="button"
                    className={small}
                    disabled={index === places.length - 1}
                    aria-label={`Move ${name.toLowerCase()} down`}
                    onClick={() => {
                      move(index, 1);
                    }}
                  >
                    <ArrowDown aria-hidden="true" className="h-4 w-4" />
                    Down
                  </button>
                  <button
                    type="button"
                    className={`${small} text-destructive`}
                    aria-label={`Remove ${name.toLowerCase()}`}
                    onClick={() => {
                      onChange(places.filter((_, i) => i !== index));
                    }}
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className={`${small} justify-self-start`}
        onClick={() => {
          onChange([...places, newPlace()]);
        }}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Add a location
      </button>
    </section>
  );
}
