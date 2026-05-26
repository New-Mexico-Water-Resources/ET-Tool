const { bboxPolygon, booleanIntersects, booleanPointInPolygon } = require("@turf/turf");

const NODATA_THRESHOLD = 32700;

const toPreviewClipMask = (geojson) => {
  if (!geojson || typeof geojson !== "object") {
    return null;
  }

  if (
    geojson.type === "Feature" ||
    geojson.type === "FeatureCollection" ||
    geojson.type === "Polygon" ||
    geojson.type === "MultiPolygon"
  ) {
    return geojson;
  }

  if (geojson.geometry) {
    return {
      type: "Feature",
      properties: {},
      geometry: geojson.geometry,
    };
  }

  return null;
};

const isPointInPreviewClip = (lng, lat, mask) => {
  if (!mask) {
    return true;
  }

  const point = [lng, lat];

  if (mask.type === "FeatureCollection") {
    return mask.features.some((feature) => booleanPointInPolygon(point, feature));
  }

  return booleanPointInPolygon(point, mask);
};

const isNoData = (value) => value == null || Number.isNaN(value) || value >= NODATA_THRESHOLD;

const getRasterCellBounds = (georaster, x, y) => {
  const west = georaster.xmin + x * georaster.pixelWidth;
  const east = west + georaster.pixelWidth;
  const north = georaster.ymax - y * georaster.pixelHeight;
  const south = north - georaster.pixelHeight;
  return { west, south, east, north };
};

const getRasterCellPolygon = (georaster, x, y) => {
  const { west, south, east, north } = getRasterCellBounds(georaster, x, y);
  return bboxPolygon([west, south, east, north]);
};

const isRasterCellTouchedByClip = (georaster, x, y, geojson) => {
  const mask = toPreviewClipMask(geojson);
  if (!mask) {
    return true;
  }

  const cell = getRasterCellPolygon(georaster, x, y);

  if (booleanIntersects(cell, mask)) {
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

const isRasterCellFullyInsideClip = (georaster, x, y, geojson) => {
  const mask = toPreviewClipMask(geojson);
  if (!mask) {
    return true;
  }

  const { west, south, east, north } = getRasterCellBounds(georaster, x, y);
  const samplePoints = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
    [(west + east) / 2, (south + north) / 2],
  ];

  return samplePoints.every(([lng, lat]) => isPointInPreviewClip(lng, lat, mask));
};

const isRasterCellIncludedByClip = (georaster, x, y, geojson, mode = "inclusive") => {
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

const applyPreviewPolygonClip = (georaster, geojson, mode = "inclusive") => {
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

module.exports = {
  NODATA_THRESHOLD,
  isNoData,
  applyPreviewPolygonClip,
};
