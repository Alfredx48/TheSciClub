import { describe, expect, it } from 'vitest';
import { findLinks, hrefFor, LABEL_LENGTH, labelFor } from '@/lib/links';

const links = (text: string) =>
  findLinks(text).flatMap((piece) => (piece.kind === 'link' ? [piece.href] : []));

describe('findLinks', () => {
  it('leaves text with no address alone', () => {
    expect(findLinks('See you Friday')).toEqual([{ kind: 'text', text: 'See you Friday' }]);
  });

  it('finds an address and keeps the words around it', () => {
    expect(findLinks('Try this https://example.com/cushion today')).toEqual([
      { kind: 'text', text: 'Try this ' },
      { kind: 'link', href: 'https://example.com/cushion', label: 'example.com/cushion' },
      { kind: 'text', text: ' today' },
    ]);
  });

  it('opens a www. address over https', () => {
    expect(links('go to www.amazon.com/dp/B00ABC')).toEqual(['https://www.amazon.com/dp/B00ABC']);
  });

  it('finds several', () => {
    expect(links('https://a.org and http://b.net/x')).toEqual(['https://a.org/', 'http://b.net/x']);
  });

  it('leaves the full stop that ends a sentence out of the address', () => {
    expect(links('It is at https://example.com/x.')).toEqual(['https://example.com/x']);
    expect(links('Really? https://example.com/x!')).toEqual(['https://example.com/x']);
  });

  it('keeps a bracket the address opened, and drops one it did not', () => {
    expect(links('https://en.wikipedia.org/wiki/Spinal_cord_(anatomy)')).toEqual([
      'https://en.wikipedia.org/wiki/Spinal_cord_(anatomy)',
    ]);
    expect(links('(see https://example.com/x)')).toEqual(['https://example.com/x']);
  });

  // The whole point of the scheme check.
  it('never makes a link of anything that is not a web address', () => {
    expect(links('javascript:alert(1)')).toEqual([]);
    expect(links('mail me at bo@example.com')).toEqual([]);
    expect(links('e.g. T6.Complete amazon.com')).toEqual([]);
  });
});

// The owner, 2026-11-09: an address in a message opens Google Maps.
describe('street addresses', () => {
  const addresses = (text: string) =>
    findLinks(text).flatMap((piece) => (piece.kind === 'link' ? [piece.label] : []));

  it('links one to Google Maps, with its unit, city, state and ZIP', () => {
    expect(findLinks('Meet at 1200 Valencia St, San Francisco, CA 94110 at noon.')).toEqual([
      { kind: 'text', text: 'Meet at ' },
      {
        kind: 'link',
        href: 'https://www.google.com/maps/search/?api=1&query=1200%20Valencia%20St%2C%20San%20Francisco%2C%20CA%2094110',
        label: '1200 Valencia St, San Francisco, CA 94110',
      },
      { kind: 'text', text: ' at noon.' },
    ]);
    expect(addresses('It is 350 5th Ave Suite 3, New York NY')).toEqual([
      '350 5th Ave Suite 3, New York NY',
    ]);
    expect(addresses('Try 100 Park Avenue South. Or 42 St Marks Pl')).toEqual([
      '100 Park Avenue South',
      '42 St Marks Pl',
    ]);
    // A city with no state after it is left out rather than guessed at.
    expect(addresses('See you at 9 Main St, I will be early')).toEqual(['9 Main St']);
  });

  it('leaves numbers that are not addresses alone', () => {
    for (const text of [
      'I did 3 laps around the track',
      'We have 2 big dogs',
      'Back at 10 PM',
      'C5 since 2012, T6 Complete',
      'Room 204 is on the left',
    ]) {
      expect(addresses(text)).toEqual([]);
    }
  });
});

describe('hrefFor', () => {
  it('refuses an address with no dotted host', () => {
    expect(hrefFor('http://localhost/x')).toBeNull();
  });
});

describe('labelFor', () => {
  it('drops the scheme and www.', () => {
    expect(labelFor('https://www.example.com/a')).toBe('example.com/a');
    expect(labelFor('https://example.com/')).toBe('example.com');
  });

  // The Amazon case: most of the address is tracking.
  it('drops a long query and cuts what is left', () => {
    const amazon =
      'https://www.amazon.com/ROHO-Quadtro-Select-Cushion-Wheelchair/dp/B00ABCDEF/ref=sr_1_3?crid=2XYZ&keywords=roho+cushion&qid=1727000000&sprefix=roho%2Caps%2C160&sr=8-3';
    const label = labelFor(amazon);
    expect(label.startsWith('amazon.com/ROHO-Quadtro')).toBe(true);
    expect(label).not.toContain('crid');
    expect(label.length).toBeLessThanOrEqual(LABEL_LENGTH);
    expect(label.endsWith('…')).toBe(true);
  });

  it('keeps a short query', () => {
    expect(labelFor('https://example.com/search?q=roho')).toBe('example.com/search?q=roho');
  });
});
