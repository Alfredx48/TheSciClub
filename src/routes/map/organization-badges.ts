import type { MapLibreMap } from '@/lib/map';

/**
 * An organization's place on the map: its own logo in a white disc, ringed
 * in the organizations' purple, or its short code on the black of
 * organization-badge.tsx when it has none. Drawn once into pixels and kept:
 * a theme change or a remounted map adds the same pixels again, never a
 * second download. A logo is fetched only when MapLibre asks for its badge,
 * that is when one of its places is drawn; until it arrives, and if it fails,
 * the short code stands in.
 */

export const PLUM = '#5b3d8f';
const WHITE = '#ffffff';
/** Matches organization-badge.tsx's tile. */
const TILE_FROM = '#3A3A3A';
const TILE_TO = '#0B0B0B';
const HEAD = '"Atkinson Hyperlegible Next", "Segoe UI", system-ui, sans-serif';

/** MapLibre's image id for an organization's badge. */
export const BADGE_PREFIX = 'org-logo-';
/** Across, in CSS pixels at the default text size. */
export const BADGE_SIZE = 32;
const MIDDLE = BADGE_SIZE / 2;
/** The white disc inside the purple ring. */
const INNER = 12.75;

export interface BadgeSource {
  shortCode: string;
  logoPath: string | null;
  /** Signed URL; null until it is signed, or when storage refuses it. */
  logoUrl: string | null;
}

export interface Badge {
  data: ImageData;
  ratio: number;
}

type Logo = CanvasImageSource & { width: number; height: number };

let textScale = 1;

/** Drawn this sharp for the text size given (applyTextScale). */
export function setBadgeScale(scale: number): void {
  textScale = scale;
}

export const pixelRatio = () =>
  Math.min(4, Math.max(2, Math.ceil((globalThis.devicePixelRatio || 1) * textScale)));

/** Across, in pixels, of the copy a logo's shape is read from. */
const SAMPLE = 40;

/**
 * A square logo with nothing but white or clear outside its circle, so
 * filling the disc cuts nothing off.
 */
function isRound(logo: Logo): boolean {
  if (Math.abs(logo.width / logo.height - 1) > 0.05) return false;
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const pen = canvas.getContext('2d', { willReadFrequently: true });
  if (!pen) return false;
  pen.drawImage(logo, 0, 0, SAMPLE, SAMPLE);
  const { data } = pen.getImageData(0, 0, SAMPLE, SAMPLE);
  if (data.length < SAMPLE * SAMPLE * 4) return false;
  const middle = SAMPLE / 2;
  // A pixel and a half of the circle's own soft edge is allowed past it.
  for (let y = 0; y < SAMPLE; y++) {
    for (let x = 0; x < SAMPLE; x++) {
      if (Math.hypot(x + 0.5 - middle, y + 0.5 - middle) <= middle + 1.5) continue;
      const i = (y * SAMPLE + x) * 4;
      const clear = (data[i + 3] ?? 0) < 32;
      const white = Math.min(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0) > 235;
      if (!clear && !white) return false;
    }
  }
  return true;
}

/** Paths, not roundRect, which iOS 15's Safari lacks. */
export function drawBadge(look: { logo: Logo } | { letters: string }): Badge | null {
  const ratio = pixelRatio();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(BADGE_SIZE * ratio);
  canvas.height = canvas.width;
  const pen = canvas.getContext('2d');
  if (!pen) return null;
  pen.scale(ratio, ratio);
  const disc = (r: number, fill: string | CanvasGradient) => {
    pen.beginPath();
    pen.arc(MIDDLE, MIDDLE, r, 0, Math.PI * 2);
    pen.fillStyle = fill;
    pen.fill();
  };
  // A white edge for the dark basemap, the purple ring for the light one.
  disc(MIDDLE, WHITE);
  disc(15, PLUM);
  if ('logo' in look) {
    disc(INNER, WHITE);
    const { width, height } = look.logo;
    if (width > 0 && height > 0) {
      // The largest box of the logo's shape inside the disc, a little in; a
      // round logo fills the disc instead (the owner, 2026-10-28: SCI-FIT's
      // was a small circle in a white ring).
      const aspect = width / height;
      const round = isRound(look.logo);
      const h = round ? 2 * INNER : (2 * (INNER - 0.75)) / Math.sqrt(1 + aspect * aspect);
      const w = round ? h : aspect * h;
      pen.save();
      pen.clip();
      pen.drawImage(look.logo, MIDDLE - w / 2, MIDDLE - h / 2, w, h);
      pen.restore();
    }
  } else {
    // CSS's 140deg, across the disc.
    const [dx, dy] = [Math.sin((140 * Math.PI) / 180), -Math.cos((140 * Math.PI) / 180)];
    const tile = pen.createLinearGradient(
      MIDDLE - dx * INNER,
      MIDDLE - dy * INNER,
      MIDDLE + dx * INNER,
      MIDDLE + dy * INNER,
    );
    tile.addColorStop(0, TILE_FROM);
    tile.addColorStop(1, TILE_TO);
    disc(INNER, tile);
    const letters = look.letters;
    if (letters) {
      // As the tile steps three and four letters down; then to fit the disc.
      let size = 11 * (letters.length > 3 ? 0.76 : letters.length === 3 ? 0.88 : 1);
      pen.font = `800 ${size}px ${HEAD}`;
      const room = 2 * (INNER - 2);
      const wide = pen.measureText(letters).width;
      if (wide > room) {
        size *= room / wide;
        pen.font = `800 ${size}px ${HEAD}`;
      }
      pen.fillStyle = WHITE;
      pen.textAlign = 'center';
      pen.textBaseline = 'middle';
      pen.fillText(letters, MIDDLE, MIDDLE + 0.5);
    }
  }
  return { data: pen.getImageData(0, 0, canvas.width, canvas.height), ratio };
}

/* ------------------------------------------------------------------ caches */

/** By short code: cheap, but drawn once all the same. */
const fallbacks = new Map<string, Badge | null>();
/** By logo path: the finished badge, or null when the logo failed. */
const finished = new Map<string, Badge | null>();
const loading = new Map<string, Promise<Badge | null>>();
const sources = new WeakMap<MapLibreMap, Map<string, BadgeSource>>();
/** What each map was given, so only those are redrawn when a source changes. */
const shown = new WeakMap<MapLibreMap, Map<string, Badge>>();

/** For tests. */
export function forgetBadges(): void {
  fallbacks.clear();
  finished.clear();
  loading.clear();
}

function fallbackFor(letters: string): Badge | null {
  if (!fallbacks.has(letters)) fallbacks.set(letters, drawBadge({ letters }));
  return fallbacks.get(letters) ?? null;
}

async function decode(url: string): Promise<Badge | null> {
  try {
    const response = await fetch(url, { mode: 'cors', referrerPolicy: 'no-referrer' });
    if (!response.ok) return null;
    const picture = await createImageBitmap(await response.blob());
    const badge = drawBadge({ logo: picture });
    picture.close();
    return badge;
  } catch {
    // Offline, refused, or not a picture: the short code stays.
    return null;
  }
}

function load(path: string, url: string): Promise<Badge | null> {
  let pending = loading.get(path);
  if (!pending) {
    pending = decode(url).then((badge) => {
      finished.set(path, badge);
      loading.delete(path);
      return badge;
    });
    loading.set(path, pending);
  }
  return pending;
}

/** A removed map throws on every call: nothing to draw on then. Shared with peer-photos.ts. */
export function put(map: MapLibreMap, id: string, badge: Badge | null): void {
  if (!badge) return;
  try {
    const given = shown.get(map) ?? new Map<string, Badge>();
    shown.set(map, given);
    if (!map.hasImage(id)) {
      map.addImage(id, badge.data, { pixelRatio: badge.ratio });
    } else if (given.get(id) === badge) {
      return;
    } else if (given.get(id)?.data.width === badge.data.width) {
      map.updateImage(id, badge.data);
    } else {
      map.removeImage(id);
      map.addImage(id, badge.data, { pixelRatio: badge.ratio });
    }
    given.set(id, badge);
  } catch {
    // Gone.
  }
}

/** Puts an organization's badge on the map now, its logo after when it has one. */
function draw(map: MapLibreMap, organizationId: string): void {
  const id = `${BADGE_PREFIX}${organizationId}`;
  const source = sources.get(map)?.get(organizationId);
  const path = source?.logoPath ?? null;
  const done = path ? finished.get(path) : undefined;
  if (done) {
    put(map, id, done);
    return;
  }
  put(map, id, fallbackFor(source?.shortCode ?? ''));
  if (!path || !source?.logoUrl || finished.has(path)) return;
  void load(path, source.logoUrl).then((badge) => {
    // Still that organization's logo, and still on this map.
    if (badge && sources.get(map)?.get(organizationId)?.logoPath === path) put(map, id, badge);
  });
}

export const isBadge = (id: string) => id.startsWith(BADGE_PREFIX);

/** For MapLibre's missing-image resolver: a badge the map is about to draw. */
export function addBadge(map: MapLibreMap, id: string): void {
  if (isBadge(id)) draw(map, id.slice(BADGE_PREFIX.length));
}

/** Each organization's short code and logo; a badge already drawn follows a change. */
export function setOrganizationBadges(map: MapLibreMap, next: Map<string, BadgeSource>): void {
  const before = sources.get(map);
  sources.set(map, next);
  const given = shown.get(map);
  if (!given) return;
  for (const [organizationId, source] of next) {
    const old = before?.get(organizationId);
    if (
      old?.shortCode === source.shortCode &&
      old.logoPath === source.logoPath &&
      old.logoUrl === source.logoUrl
    )
      continue;
    if (given.has(`${BADGE_PREFIX}${organizationId}`)) draw(map, organizationId);
  }
}
