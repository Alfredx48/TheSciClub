/**
 * What About us blurs (the owner, 2026-11-15: "Blur out the city, age, injury
 * month/date"). The database never sends those (about_us_team,
 * 20261115150000), so what is blurred is a stand-in, the same for everybody,
 * and there is nothing real in the page to unblur.
 */

export const STAND_IN_AGE = '35';
export const STAND_IN_PLACE = 'Sacramento, CA';
export const STAND_IN_DAY = 'June 15';
export const STAND_IN_MONTH = 'June';
/** The last name (the owner, 2026-11-20; 20261120130000): only the first name is sent. */
export const STAND_IN_LAST_NAME = 'Johnson';

/** Shown blurred; a screen reader hears that it is hidden, not the stand-in. */
export function Blurred({ children }: { children: string }) {
  return (
    <>
      {/* A faint pill of the text's own colour behind it, so it reads as
          hidden on a photograph as well as on paper: white text blurred on
          a dark photo was all but gone. */}
      <span
        aria-hidden="true"
        className="inline-block select-none rounded-[6px] px-1 align-baseline leading-tight [text-shadow:none]"
        style={{ backgroundColor: 'color-mix(in srgb, currentColor 22%, transparent)' }}
      >
        <span className="inline-block blur-[4px]">{children}</span>
      </span>
      <span className="sr-only">hidden</span>
    </>
  );
}

/** "Hannah ▒▒▒": the first name, and a blurred last name when there is one. */
export function TeamName({ first, lastNameHidden }: { first: string; lastNameHidden: boolean }) {
  return (
    <>
      {first}
      {lastNameHidden ? (
        <>
          {' '}
          <Blurred>{STAND_IN_LAST_NAME}</Blurred>
        </>
      ) : null}
    </>
  );
}

/** "Injured ▒▒▒ 2019": the month and day blurred, as precise as was given. */
export function InjuredIn({ year, precision }: { year: number | null; precision: string | null }) {
  if (!year) return null;
  return (
    <>
      Injured{' '}
      {precision === 'day' || precision === 'month' ? (
        <>
          <Blurred>{precision === 'day' ? STAND_IN_DAY : STAND_IN_MONTH}</Blurred>{' '}
        </>
      ) : null}
      {year}
    </>
  );
}
