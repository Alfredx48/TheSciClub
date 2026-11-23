/**
 * The map's way in from the rest of the app. Everything else in this folder
 * is its own chunk (vite.config.ts), left out of the service worker's
 * precache; this file must not import it, only load it.
 *
 *   const MapCanvas = lazy(loadMapCanvas);
 */

export type {
  AddLayerObject,
  ExpressionSpecification,
  GeoJSONSource,
  LngLatBounds,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
  StyleImageMetadata,
} from 'maplibre-gl';
export type { MapCanvasProps, MapMarker } from './map-canvas';

import { mapUsedBefore } from '@/lib/map-used';

export { noteMapUsed } from '@/lib/map-used';

export const loadMapCanvas = () => import('./map-canvas');

/** The one face the basemap keeps glyphs for (style.ts): a caller's labels use it too. */
export const MAP_FONT = 'Noto Sans Regular';

interface Connection {
  saveData?: boolean;
  effectiveType?: string;
}

/** Not on Data Saver or a 2G connection: there the map loads when opened. */
export function mayPrefetchMap(): boolean {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  if (connection?.saveData === true) return false;
  return connection?.effectiveType !== 'slow-2g' && connection?.effectiveType !== '2g';
}

let prefetched = false;

/**
 * The map's script, its worker and both archives' headers, never tiles. Once
 * a page, silently: a failure leaves the map to load when opened.
 *
 * Only on a device that has shown the map before (the owner, 2026-11-23):
 * about 1 MB of script, fetched on every opening of Peers and Events, for
 * members who stay on the list. Others get it when they reach for Map.
 */
export function prefetchMap(): void {
  if (prefetched || !mapUsedBefore() || !mayPrefetchMap()) return;
  prefetched = true;
  void loadMapCanvas()
    .then((module) => module.warmMap())
    .catch(() => undefined);
}
