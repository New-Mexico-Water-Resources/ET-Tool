import { bboxPolygon, booleanIntersects } from "@turf/turf";
import {
  isNoData,
  isPointInPreviewClip,
  NODATA_THRESHOLD,
  PreviewGeoRaster,
  toPreviewClipMask,
} from "./previewGeoraster";

const getRasterCellBounds = (georaster: PreviewGeoRaster, x: number, y: number) => {
  const west = georaster.xmin + x * georaster.pixelWidth;
  const east = west + georaster.pixelWidth;
  const north = georaster.ymax - y * georaster.pixelHeight;
  const south = north - georaster.pixelHeight;
  return { west, south, east, north };
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

  const { west, south, east, north } = getRasterCellBounds(georaster, x, y);
  const cell = bboxPolygon([west, south, east, north]);

  if (booleanIntersects(cell, mask as Parameters<typeof booleanIntersects>[1])) {
    return true;
  }

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

export const applyPreviewPolygonClip = (
  georaster: PreviewGeoRaster,
  geojson: unknown
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
      if (!isRasterCellTouchedByClip(georaster, x, y, geojson)) {
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
  geojson: unknown
): boolean => {
  if (isPointInPreviewClip(lng, lat, geojson)) {
    return true;
  }

  const x = Math.floor((lng - georaster.xmin) / georaster.pixelWidth);
  const y = Math.floor((georaster.ymax - lat) / georaster.pixelHeight);

  if (x < 0 || x >= georaster.width || y < 0 || y >= georaster.height) {
    return false;
  }

  return isRasterCellTouchedByClip(georaster, x, y, geojson);
};
