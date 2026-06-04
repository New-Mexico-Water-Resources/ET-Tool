import { bboxPolygon, booleanIntersects } from "@turf/turf";
import type { ClipToPolygonMode } from "./currentJobStore";
import {
  isNoData,
  isPointInPreviewClip,
  NODATA_THRESHOLD,
  PreviewGeoRaster,
  toPreviewClipMask,
} from "./previewGeoraster";

type ClipGeometry = Parameters<typeof booleanIntersects>[1];

const getRasterCellBounds = (georaster: PreviewGeoRaster, x: number, y: number) => {
  const west = georaster.xmin + x * georaster.pixelWidth;
  const east = west + georaster.pixelWidth;
  const north = georaster.ymax - y * georaster.pixelHeight;
  const south = north - georaster.pixelHeight;
  return { west, south, east, north };
};

const getRasterCellPolygon = (georaster: PreviewGeoRaster, x: number, y: number) => {
  const { west, south, east, north } = getRasterCellBounds(georaster, x, y);
  return bboxPolygon([west, south, east, north]);
};

export const isRasterCellTouchedByClip = (
  georaster: PreviewGeoRaster,
  x: number,
  y: number,
  geojson: unknown
): boolean => {
  const mask = toPreviewClipMask(geojson);
  if (!mask) {
    return true;
  }

  const cell = getRasterCellPolygon(georaster, x, y);

  if (booleanIntersects(cell, mask as ClipGeometry)) {
    return true;
  }

  const { west, south, east, north } = getRasterCellBounds(georaster, x, y);
  const centerLng = (west + east) / 2;
  const centerLat = (south + north) / 2;
  if (isPointInPreviewClip(centerLng, centerLat, mask)) {
    return true;
  }

  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ].some(([lng, lat]) => isPointInPreviewClip(lng, lat, mask));
};

/** Entire cell lies within the polygon (all corners and center). */
export const isRasterCellFullyInsideClip = (
  georaster: PreviewGeoRaster,
  x: number,
  y: number,
  geojson: unknown
): boolean => {
  const mask = toPreviewClipMask(geojson);
  if (!mask) {
    return true;
  }

  const { west, south, east, north } = getRasterCellBounds(georaster, x, y);
  const samplePoints: [number, number][] = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
    [(west + east) / 2, (south + north) / 2],
  ];

  return samplePoints.every(([lng, lat]) => isPointInPreviewClip(lng, lat, mask));
};

export const isRasterCellIncludedByClip = (
  georaster: PreviewGeoRaster,
  x: number,
  y: number,
  geojson: unknown,
  mode: ClipToPolygonMode
): boolean => {
  switch (mode) {
    case "inclusive":
      return isRasterCellTouchedByClip(georaster, x, y, geojson);
    case "exclusive":
      return isRasterCellFullyInsideClip(georaster, x, y, geojson);
    case "inverse":
      return !isRasterCellTouchedByClip(georaster, x, y, geojson);
    default:
      return isRasterCellTouchedByClip(georaster, x, y, geojson);
  }
};

export const applyPreviewPolygonClip = (
  georaster: PreviewGeoRaster,
  geojson: unknown,
  mode: ClipToPolygonMode = "inclusive"
): PreviewGeoRaster => {
  const mask = toPreviewClipMask(geojson);
  if (!mask) {
    return georaster;
  }

  const values = georaster.values[0].map((row) => [...row]);
  let minValue = Infinity;
  let maxValue = -Infinity;

  for (let y = 0; y < georaster.height; y++) {
    for (let x = 0; x < georaster.width; x++) {
      if (!isRasterCellIncludedByClip(georaster, x, y, geojson, mode)) {
        values[y][x] = NODATA_THRESHOLD;
        continue;
      }

      const value = values[y][x];
      if (!isNoData(value)) {
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }
    }
  }

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return georaster;
  }

  return {
    ...georaster,
    values: [values],
    mins: [minValue],
    maxs: [maxValue],
  };
};

export const isPreviewLocationVisible = (
  lng: number,
  lat: number,
  georaster: PreviewGeoRaster,
  geojson: unknown,
  mode: ClipToPolygonMode = "inclusive"
): boolean => {
  const x = Math.floor((lng - georaster.xmin) / georaster.pixelWidth);
  const y = Math.floor((georaster.ymax - lat) / georaster.pixelHeight);

  if (x < 0 || x >= georaster.width || y < 0 || y >= georaster.height) {
    return false;
  }

  return isRasterCellIncludedByClip(georaster, x, y, geojson, mode);
};
