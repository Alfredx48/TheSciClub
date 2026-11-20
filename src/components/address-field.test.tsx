import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressField, revealAboveKeyboard } from '@/components/address-field';
import { type AddressSuggestion, forgetSuggestions } from '@/lib/address-suggestions';

const place = (housenumber: string, name?: string) => ({
  type: 'Feature',
  properties: {
    countrycode: 'US',
    osm_type: 'N',
    osm_id: Number(housenumber),
    housenumber,
    street: 'Potter Street',
    name,
    city: 'Berkeley',
    state: 'California',
    postcode: '94710',
  },
});

/** Each ask, held until a test answers it. */
let asks: { url: URL; signal: AbortSignal; answer: (body: unknown, status?: number) => void }[];
let picked: AddressSuggestion[];

function Field() {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <AddressField
        label="Street address"
        className=""
        value={value}
        onChange={setValue}
        onPick={(found) => {
          picked.push(found);
          setValue(found.street);
        }}
      />
      <button type="button">Next</button>
    </form>
  );
}

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
const box = () => screen.getByRole('combobox', { name: 'Street address' });
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
async function answer(features: unknown[], at = asks.length - 1) {
  await act(async () => {
    asks[at]?.answer({ features });
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  // Real time moves the fake clock too: React Testing Library waits on a real timer.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  asks = [];
  picked = [];
  forgetSuggestions();
  vi.stubGlobal('fetch', (input: string, { signal }: { signal: AbortSignal }) => {
    return new Promise<Response>((resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
      asks.push({
        url: new URL(input),
        signal,
        answer: (body, status = 200) => {
          resolve(Response.json(body, { status }));
        },
      });
    });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the street address box', () => {
  it('asks once typing pauses, from the third character, and drops an ask a newer one replaces', async () => {
    render(<Field />);
    const u = user();
    await u.type(box(), '80');
    await wait(1000);
    expect(asks).toHaveLength(0);
    await u.type(box(), '0 P');
    await wait(100);
    expect(asks).toHaveLength(0);
    await wait(50);
    expect(asks).toHaveLength(1);
    expect(asks[0]?.url.searchParams.get('q')).toBe('800 P');
    await u.type(box(), 'o');
    await wait(300);
    expect(asks).toHaveLength(2);
    expect(asks[0]?.signal.aborted).toBe(true);
    expect(asks[1]?.signal.aborted).toBe(false);
    // The dropped one's answer, had it come, draws nothing.
    await answer([place('1')], 0);
    expect(screen.queryByRole('listbox')).toBeNull();
    await answer([place('800', 'Berkeley Ironworks'), place('801')]);
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  // The owner, 2026-11-20: "Can we have it suggest faster?"
  it('narrows what it shows at once as typing goes on, and shows an answer it has had without asking again', async () => {
    render(<Field />);
    const u = user();
    await u.type(box(), '80');
    await u.type(box(), '0');
    await wait(150);
    const street = (housenumber: string, road: string) => ({
      ...place(housenumber),
      properties: { ...place(housenumber).properties, street: road },
    });
    await answer([street('800', 'Potter Street'), street('800', 'Pine Street')]);
    expect(screen.getAllByRole('option')).toHaveLength(2);

    // Before Photon answers "800 Pot", only Potter is left.
    await u.type(box(), ' Pot');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '800 Potter Street, Berkeley, CA 94710',
    ]);

    // Back to "800": the answer had, at once, and Photon not asked again.
    const asked = asks.length;
    await u.type(box(), '{Backspace}{Backspace}{Backspace}{Backspace}');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await wait(300);
    expect(asks).toHaveLength(asked);
  });

  it('is a combobox that says how many it found, and is moved through with the arrows', async () => {
    render(<Field />);
    const u = user();
    await u.type(box(), '800 Potter');
    await wait(300);
    expect(box()).toHaveAttribute('aria-expanded', 'false');
    await answer([place('800', 'Berkeley Ironworks'), place('801')]);
    const list = screen.getByRole('listbox', { name: 'Suggested addresses' });
    expect(box()).toHaveAttribute('aria-expanded', 'true');
    expect(box()).toHaveAttribute('aria-controls', list.id);
    expect(box()).toHaveAttribute('aria-autocomplete', 'list');
    expect(box()).not.toHaveAttribute('aria-activedescendant');
    expect(screen.getByRole('status')).toHaveTextContent('2 addresses suggested.');
    const [first, second] = screen.getAllByRole('option');
    expect(first).toHaveAccessibleName('Berkeley Ironworks, 800 Potter Street, Berkeley, CA 94710');
    await u.keyboard('{ArrowDown}');
    expect(box()).toHaveAttribute('aria-activedescendant', first?.id);
    expect(first).toHaveAttribute('aria-selected', 'true');
    await u.keyboard('{ArrowDown}');
    expect(box()).toHaveAttribute('aria-activedescendant', second?.id);
    await u.keyboard('{ArrowDown}');
    expect(box()).toHaveAttribute('aria-activedescendant', first?.id);
    await u.keyboard('{ArrowUp}');
    expect(box()).toHaveAttribute('aria-activedescendant', second?.id);
    expect(box()).toHaveFocus();
  });

  it('fills in the one chosen with Enter, and says so', async () => {
    render(<Field />);
    const u = user();
    await u.type(box(), '800 Potter');
    await wait(300);
    await answer([place('800'), place('801')]);
    await u.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(picked.map((p) => p.line)).toEqual(['801 Potter Street, Berkeley, CA 94710']);
    expect(box()).toHaveValue('801 Potter Street');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Filled in 801 Potter Street, Berkeley, CA 94710.',
    );
    // A pick asks nothing more.
    await wait(1000);
    expect(asks).toHaveLength(1);
  });

  it('fills in the one tapped, keeping focus in the box', async () => {
    render(<Field />);
    const u = user();
    await u.type(box(), '800 Potter');
    await wait(300);
    await answer([place('800'), place('801')]);
    await u.click(screen.getByRole('option', { name: /^800 Potter/ }));
    expect(picked.map((p) => p.street)).toEqual(['800 Potter Street']);
    expect(box()).toHaveFocus();
  });

  it('closes with Escape, or on leaving it, choosing nothing; Enter alone picks nothing', async () => {
    render(<Field />);
    const u = user();
    await u.type(box(), '800 Potter');
    await wait(300);
    await answer([place('800')]);
    await u.keyboard('{Enter}');
    expect(picked).toEqual([]);
    await u.keyboard('{ArrowDown}{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box()).toHaveAttribute('aria-expanded', 'false');
    expect(box()).not.toHaveAttribute('aria-activedescendant');
    await u.keyboard('{ArrowDown}');
    expect(screen.getByRole('listbox')).toBeVisible();
    // Through the credit's two links, then out.
    await u.tab();
    expect(screen.getByRole('link', { name: 'Photon' })).toHaveFocus();
    expect(screen.getByRole('listbox')).toBeVisible();
    await u.tab();
    await u.tab();
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(picked).toEqual([]);
    expect(box()).toHaveValue('800 Potter');
  });

  it('credits Photon and OpenStreetMap under the suggestions', async () => {
    render(<Field />);
    const u = user();
    await u.type(box(), '800 Potter');
    await wait(300);
    await answer([place('800')]);
    expect(screen.getByRole('link', { name: 'Photon' })).toHaveAttribute(
      'href',
      'https://photon.komoot.io',
    );
    expect(screen.getByRole('link', { name: 'OpenStreetMap contributors' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
  });

  it('stays a plain box when Photon fails or finds nothing, with nothing said', async () => {
    render(<Field />);
    const u = user();
    await u.type(box(), '800 Potter');
    await wait(300);
    await act(async () => {
      asks[0]?.answer({ message: 'busy' }, 503);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('');
    await u.type(box(), ' St');
    await wait(300);
    await answer([]);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box()).toHaveValue('800 Potter St');
    await u.keyboard('{ArrowDown}{Enter}');
    expect(picked).toEqual([]);
  });

  it('stays a plain box when fetch itself throws, as a blocked request does', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    render(<Field />);
    const u = user();
    await u.type(box(), '800 Potter');
    await wait(300);
    expect(screen.queryByRole('listbox')).toBeNull();
    await u.type(box(), ' Street');
    expect(box()).toHaveValue('800 Potter Street');
  });
});

// The owner, 2026-11-20: adding an event and an organization on a phone, no
// suggestions were seen: they were drawn under the keyboard.
describe('suggestions under the keyboard', () => {
  it('are scrolled up into what it leaves visible, never taking the box out of sight', () => {
    const page = document.createElement('div');
    const box = document.createElement('input');
    const list = document.createElement('div');
    page.append(box, list);
    document.body.append(page);
    const at = (element: Element, top: number, bottom: number) => {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top, bottom } as DOMRect);
    };
    const scrollBy = vi.fn();
    // jsdom has none; the page's own scroller.
    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      value: { scrollBy },
    });
    // A keyboard leaves the top 400 visible.
    const keyboard = { offsetTop: 0, height: 400 };

    at(box, 300, 340);
    at(list, 344, 600);
    revealAboveKeyboard(list, box, keyboard);
    // All of the list would need 208; the box can go up 292 and stay seen.
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 208 });

    at(box, 100, 140);
    at(list, 144, 900);
    revealAboveKeyboard(list, box, keyboard);
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 92 });

    scrollBy.mockClear();
    at(list, 144, 380);
    revealAboveKeyboard(list, box, keyboard);
    expect(scrollBy).not.toHaveBeenCalled();
    page.remove();
    Reflect.deleteProperty(document, 'scrollingElement');
  });
});
