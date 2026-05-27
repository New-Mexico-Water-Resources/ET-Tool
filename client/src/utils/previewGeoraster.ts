import { booleanPointInPolygon } from "@turf/turf";
import type { Feature, FeatureCollection, GeoJsonObject, Geometry, MultiPolygon, Polygon } from "geojson";

export const NODATA_THRESHOLD = 32700;

export type PreviewClipMask = Feature | FeatureCollection | Polygon | MultiPolygon;

export const toPreviewClipMask = (geojson: unknown): PreviewClipMask | null => {
  if (!geojson || typeof geojson !== "object") {
    return null;
  }

  const typed = geojson as GeoJsonObject;

  if (
    typed.type === "Feature" ||
    typed.type === "FeatureCollection" ||
    typed.type === "Polygon" ||
    typed.type === "MultiPolygon"
  ) {
    return typed as PreviewClipMask;
  }

  if ("geometry" in typed && typed.geometry) {
    return {
      type: "Feature",
      properties: {},
      geometry: typed.geometry as Geometry,
    };
  }

  return null;
};

export const isPointInPreviewClip = (lng: number, lat: number, geojson: unknown): boolean => {
  const mask = toPreviewClipMask(geojson);
  if (!mask) {
    return true;
  }

  const point: [number, number] = [lng, lat];

  if (mask.type === "FeatureCollection") {
    return mask.features.some((feature) =>
      booleanPointInPolygon(point, feature as Feature<Polygon | MultiPolygon>)
    );
  }

  return booleanPointInPolygon(
    point,
    mask as Feature<Polygon | MultiPolygon> | Polygon | MultiPolygon
  );
};

export interface PreviewGeoRaster {
  xmin: number;
  ymax: number;
  pixelWidth: number;
  pixelHeight: number;
  width: number;
  height: number;
  values: number[][][];
  mins: number[];
  maxs: number[];
}

export const isNoData = (value: number) =>
  value == null || Number.isNaN(value) || value >= NODATA_THRESHOLD;

export const getPreviewValueAtLatLng = (georaster: PreviewGeoRaster, lat: number, lng: number) => {
  const x = Math.floor((lng - georaster.xmin) / georaster.pixelWidth);
  const y = Math.floor((georaster.ymax - lat) / georaster.pixelHeight);

  if (x < 0 || x >= georaster.width || y < 0 || y >= georaster.height) {
    return null;
  }

  return georaster.values[0][y][x];
};

export type PreviewScaleRange = {
  min: number;
  max: number;
  shouldPersist: boolean;
};

export const normalizePreviewDataRange = (dataMin: number, dataMax: number) => {
  let min = dataMin;
  let max = dataMax;
  if (min === max) {
    min = 0;
    max = Math.max(max, 300);
  }
  return { min, max };
};

export const resolvePreviewScaleRange = (
  dynamicPreviewColorScale: boolean,
  previewMin: number | string | null,
  previewMax: number | string | null,
  dataMin: number,
  dataMax: number
): PreviewScaleRange => {
  const { min: normalizedMin, max: normalizedMax } = normalizePreviewDataRange(dataMin, dataMax);

  if (dynamicPreviewColorScale) {
    return { min: normalizedMin, max: normalizedMax, shouldPersist: true };
  }

  const customMin = Number(previewMin);
  const customMax = Number(previewMax);
  if (Number.isFinite(customMin) && Number.isFinite(customMax) && customMin !== customMax) {
    return { min: customMin, max: customMax, shouldPersist: false };
  }

  return { min: normalizedMin, max: normalizedMax, shouldPersist: true };
};

export const shouldUpdatePreviewScaleStore = (
  previewMin: number | string | null,
  previewMax: number | string | null,
  nextMin: number,
  nextMax: number
) => Number(previewMin) !== nextMin || Number(previewMax) !== nextMax;

export const hasValidCustomPreviewScale = (
  previewMin: number | string | null,
  previewMax: number | string | null
) => {
  const min = Number(previewMin);
  const max = Number(previewMax);
  return Number.isFinite(min) && Number.isFinite(max) && min !== max;
};

export type PreviewLayerScale = {
  min: number;
  max: number;
  shouldUpdateStore: boolean;
};

export const getPreviewLayerScale = (
  dataMin: number,
  dataMax: number,
  dynamicPreviewColorScale: boolean,
  previewMin: number | string | null,
  previewMax: number | string | null
): PreviewLayerScale => {
  let minValue = dataMin;
  let maxValue = dataMax;

  if (dynamicPreviewColorScale) {
    if (minValue === maxValue) {
      minValue = 0;
      maxValue = Math.max(maxValue, 300);
    }
    return { min: minValue, max: maxValue, shouldUpdateStore: true };
  }

  if (hasValidCustomPreviewScale(previewMin, previewMax)) {
    return {
      min: Number(previewMin),
      max: Number(previewMax),
      shouldUpdateStore: false,
    };
  }

  if (minValue === maxValue) {
    minValue = 0;
    maxValue = Math.max(maxValue, 300);
  }

  return { min: minValue, max: maxValue, shouldUpdateStore: false };
};

export const formatPreviewValue = (value: number, units: "mm" | "inches") => {
  if (units === "inches") {
    return {
      value: value / 25.4,
      units: "in/month",
    };
  }

  return {
    value,
    units: "mm/month",
  };
};

const assertMatchingDimensions = (rasters: PreviewGeoRaster[]) => {
  const [first, ...rest] = rasters;
  for (const raster of rest) {
    if (raster.width !== first.width || raster.height !== first.height) {
      throw new Error("Preview rasters have mismatched dimensions");
    }
  }
};

export const computeRasterOperation = (
  template: PreviewGeoRaster,
  rasters: PreviewGeoRaster[],
  operation: (values: number[]) => number | null
): PreviewGeoRaster => {
  assertMatchingDimensions(rasters);

  const sourceValues = rasters.map((raster) => raster.values[0]);
  const resultValues: number[][] = [];
  let minValue = Infinity;
  let maxValue = -Infinity;

  for (let y = 0; y < template.height; y++) {
    const row: number[] = [];
    for (let x = 0; x < template.width; x++) {
      const pixelValues = sourceValues.map((grid) => grid[y][x]);

      if (pixelValues.some(isNoData)) {
        row.push(NODATA_THRESHOLD);
        continue;
      }

      const result = operation(pixelValues);
      if (result === null || isNoData(result)) {
        row.push(NODATA_THRESHOLD);
        continue;
      }

      row.push(result);
      minValue = Math.min(minValue, result);
      maxValue = Math.max(maxValue, result);
    }
    resultValues.push(row);
  }

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    minValue = 0;
    maxValue = 0;
  }

  return {
    ...template,
    values: [resultValues],
    mins: [minValue],
    maxs: [maxValue],
  };
};

export const computeBinaryRasterOperation = (
  a: PreviewGeoRaster,
  b: PreviewGeoRaster,
  operation: (a: number, b: number) => number
): PreviewGeoRaster =>
  computeRasterOperation(a, [a, b], ([left, right]) => operation(left, right));
