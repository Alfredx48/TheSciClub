/** Whether this device has shown the map (lib/map/index.ts prefetchMap). Outside lib/map so it costs nothing. */

const USED_KEY = 'club:map-used';

/** This device has shown the map, on Peers or Events. */
export function noteMapUsed(): void {
  try {
    localStorage.setItem(USED_KEY, '1');
  } catch {
    // Storage refused: the map then loads when opened, as for a new member.
  }
}

export function mapUsedBefore(): boolean {
  try {
    return localStorage.getItem(USED_KEY) === '1';
  } catch {
    return false;
  }
}
