/**
 * Reading a list of people to invite out of a spreadsheet (the owner,
 * 2026-11-14): a Google Sheet's link, rows copied out of any spreadsheet
 * (tab-separated), a CSV, or addresses copied out of an email's To line.
 *
 * Who may invite, and what happens to an address already in the club, is the
 * database's to say (admin_invite_list, 20261114010000). This only finds the
 * addresses and the names beside them.
 */

export interface SheetPerson {
  email: string;
  /** What the email greets them as; null when the sheet has no name for them. */
  name: string | null;
}

export interface ReadSheet {
  people: SheetPerson[];
  /** Rows with something in them but no email address, to show back. */
  skipped: string[];
  /** The same address more than once: kept once. */
  repeats: number;
}

/** At most this many at a time, as the database allows. */
export const SHEET_LIMIT = 200;

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * A Google Sheets link to the CSV of that tab, which Google serves to a
 * browser when the sheet is shared as "Anyone with the link". Null for
 * anything else.
 */
export function sheetCsvUrl(link: string): string | null {
  const id = /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(link)?.[1];
  if (!id) return null;
  const gid = /[#?&]gid=(\d+)/.exec(link)?.[1];
  return `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`;
}

/** Rows of cells: tab-separated when there are tabs (a paste), else CSV with quotes. */
export function parseTable(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  if (source.includes('\t')) {
    return source.split(/\r?\n/).map((line) => line.split('\t'));
  }
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source.charAt(i);
    if (quoted) {
      if (c === '"' && source.charAt(i + 1) === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (c === ',' || c === ';') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source.charAt(i + 1) === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function clean(value: string): string {
  return value
    .replace(/[<>"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A name for the greeting, or null; never an address and never too long. */
function nameFrom(value: string | undefined): string | null {
  const name = clean(value ?? '');
  if (!name || EMAIL.test(name) || name.length > 80) return null;
  return name;
}

/**
 * The people in a table. With a header row naming an email column, that
 * column, and the name: a Name column, else First name and Last name put
 * together (the owner, 2026-11-19: "There could be a name column or a 'First
 * Name' and 'Last Name' column").
 * Without one, every cell holding an address is a person, named by the words
 * around the address ("Ana Ruiz <ana@example.com>") or, when the row has only
 * the one address, by the row's first other cell.
 */
export function peopleIn(table: string[][]): ReadSheet {
  const rows = table.filter((r) => r.some((c) => c.trim() !== ''));
  const header = rows[0] ?? [];
  const isHeader = header.some((c) => /e-?mail/i.test(c)) && !header.some((c) => EMAIL.test(c));
  const found: SheetPerson[] = [];
  const skipped: string[] = [];

  if (isHeader) {
    const at = (re: RegExp) => header.findIndex((c) => re.test(c.trim()));
    const emailAt = at(/e-?mail/i);
    const firstAt = at(/^(first|given|preferred)\b|^first ?name$/i);
    const lastAt = at(/^(last|family|sur)\b|^last ?name$|^surname$/i);
    const nameAt = header.findIndex(
      (c, i) => i !== firstAt && i !== lastAt && i !== emailAt && /name/i.test(c.trim()),
    );
    const named = (row: string[]) =>
      (nameAt >= 0 ? nameFrom(row[nameAt]) : null) ??
      nameFrom([row[firstAt] ?? '', row[lastAt] ?? ''].join(' '));
    for (const row of rows.slice(1)) {
      const email = EMAIL.exec(row[emailAt] ?? '')?.[0];
      if (!email) {
        skipped.push(row.join(' ').trim());
        continue;
      }
      found.push({ email, name: named(row) });
    }
  } else {
    for (const row of rows) {
      const holding = row.filter((c) => EMAIL.test(c));
      if (holding.length === 0) {
        skipped.push(row.join(' ').trim());
        continue;
      }
      for (const cell of holding) {
        // Several addresses in one cell ("a@x.com b@y.com"): each one, named
        // by the words just before it ("Ana Ruiz <ana@x.com>").
        const matches = [...cell.matchAll(new RegExp(EMAIL.source, 'g'))];
        let from = 0;
        for (const match of matches) {
          const at = match.index;
          const around = nameFrom(cell.slice(from, at));
          from = at + match[0].length;
          const beside =
            holding.length === 1 && matches.length === 1
              ? nameFrom(row.find((c) => c.trim() && !EMAIL.test(c)))
              : null;
          found.push({ email: match[0], name: around ?? beside });
        }
      }
    }
  }

  const seen = new Set<string>();
  const people: SheetPerson[] = [];
  let repeats = 0;
  for (const person of found) {
    const key = person.email.toLowerCase();
    if (seen.has(key)) {
      repeats++;
      continue;
    }
    seen.add(key);
    people.push(person);
  }
  return { people, skipped, repeats };
}

/** Everything in one: pasted text or a downloaded CSV. */
export function readSheet(text: string): ReadSheet {
  return peopleIn(parseTable(text));
}
