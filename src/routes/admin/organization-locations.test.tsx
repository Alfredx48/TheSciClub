import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OrganizationLocations,
  type PlaceDraft,
  placesToSave,
  toDrafts,
} from '@/routes/admin/organization-locations';

const start = toDrafts([
  {
    id: 'a',
    label: 'Main office',
    address: '3075 Adeline St',
    city: 'Berkeley',
    state: 'CA',
    postalCode: '94703',
  },
  { id: 'b', label: null, address: null, city: 'Fremont', state: 'CA', postalCode: null },
]);
const blank = { label: null, address: null, city: '', state: '', postalCode: null };

let latest: PlaceDraft[] = [];
function Editor() {
  const [places, setPlaces] = useState(start);
  latest = places;
  return <OrganizationLocations places={places} onChange={setPlaces} />;
}

const cities = () => latest.map((place) => place.city);

describe("an organization's locations in its editor", () => {
  it('says a published street address gets a pin, and a P.O. box or store mailbox does not', () => {
    render(<Editor />);
    expect(screen.getByText(/A street address it publishes gets an exact pin/)).toBeVisible();
    expect(screen.getByText(/P\.O\. box or a mailbox at a shipping store/)).toBeVisible();
    expect(screen.getByRole('group', { name: 'Location 1 (main)' })).toBeVisible();
  });

  it('moves a location up and down, the first being the main one', async () => {
    render(<Editor />);
    expect(screen.getByRole('button', { name: 'Move location 1 up' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move location 2 up' }));
    expect(cities()).toEqual(['Fremont', 'Berkeley']);
    await userEvent.click(screen.getByRole('button', { name: 'Move location 1 down' }));
    expect(cities()).toEqual(['Berkeley', 'Fremont']);
  });

  it('adds and removes locations, keeping what is typed in the right one', async () => {
    render(<Editor />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a location' }));
    const third = screen.getByRole('group', { name: 'Location 3' });
    await userEvent.type(within(third).getByRole('combobox', { name: 'City' }), 'Oakland');
    await userEvent.click(screen.getByRole('button', { name: 'Remove location 2' }));
    expect(cities()).toEqual(['Berkeley', 'Oakland']);
  });

  it('saves each location with a city and a state, drops an empty one, and says what is missing', () => {
    expect(placesToSave([...start, ...toDrafts([blank])])).toEqual([
      {
        id: 'a',
        label: 'Main office',
        address: '3075 Adeline St',
        city: 'Berkeley',
        state: 'CA',
        postalCode: '94703',
      },
      { id: 'b', label: null, address: null, city: 'Fremont', state: 'CA', postalCode: null },
    ]);
    expect(placesToSave(toDrafts([{ ...blank, city: 'Reno' }]))).toBe(
      'Each location needs a city and a state.',
    );
    expect(placesToSave(toDrafts([{ ...blank, postalCode: '89501' }]))).toBe(
      'Each location needs a city and a state.',
    );
  });

  it('saves a ZIP code of five digits or ZIP+4, trimmed, and refuses any other', () => {
    const reno = { ...blank, city: 'Reno', state: 'NV' };
    const zip = (postalCode: string) => placesToSave(toDrafts([{ ...reno, postalCode }]));
    expect(zip(' 89501 ')).toEqual([{ ...reno, postalCode: '89501' }]);
    expect(zip('89501-1234')).toEqual([{ ...reno, postalCode: '89501-1234' }]);
    expect(zip('  ')).toEqual([{ ...reno, postalCode: null }]);
    for (const bad of ['8950', '895011234', '89501-12', 'ABCDE']) {
      expect(zip(bad)).toBe('A ZIP code is five digits, or five, a dash and four.');
    }
  });

  it('has a ZIP code box after the state, for a phone’s number keys and autofill', async () => {
    render(<Editor />);
    const first = screen.getByRole('group', { name: 'Location 1 (main)' });
    const zip = within(first).getByRole('textbox', { name: /ZIP code/ });
    expect(zip).toHaveValue('94703');
    expect(zip).toHaveAttribute('inputmode', 'numeric');
    expect(zip).toHaveAttribute('autocomplete', 'postal-code');
    const state = within(first).getByRole('combobox', { name: 'State' });
    expect(state.compareDocumentPosition(zip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.clear(zip);
    await userEvent.type(zip, '94710');
    expect(latest[0]?.postalCode).toBe('94710');
  });

  it('fills in street, city, state and ZIP from a picked suggestion, keeping the label', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      asked.push(url);
      return Promise.resolve(
        Response.json({
          features: [
            {
              type: 'Feature',
              properties: {
                countrycode: 'US',
                osm_key: 'leisure',
                name: 'Berkeley Ironworks',
                housenumber: '800',
                street: 'Potter Street',
                city: 'Berkeley',
                state: 'California',
                postcode: '94710',
              },
            },
          ],
        }),
      );
    });
    render(<Editor />);
    const first = screen.getByRole('group', { name: 'Location 1 (main)' });
    const street = within(first).getByRole('combobox', { name: /Street address/ });
    await userEvent.clear(street);
    await userEvent.type(street, '800 Potter');
    await userEvent.click(await screen.findByRole('option', { name: /Berkeley Ironworks/ }));
    expect(asked.every((url) => url.startsWith('https://photon.komoot.io/api/?'))).toBe(true);
    expect(latest[0]).toMatchObject({
      label: 'Main office',
      address: '800 Potter Street',
      city: 'Berkeley',
      state: 'CA',
      postalCode: '94710',
    });
    expect(street).toHaveValue('800 Potter Street');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
