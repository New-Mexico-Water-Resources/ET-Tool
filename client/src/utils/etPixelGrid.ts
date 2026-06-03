import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { PreviewGeoRaster } from "./previewGeoraster";


export const SUBSET_PIXEL_SIZE_DEGREES = 0.0003;
export const SUBSET_PIXEL_GRID_XMIN = 0.000140518888;
export const SUBSET_PIXEL_GRID_YMAX = 90.000203867895;

export const ET_PIXEL_GRID_MIN_ZOOM = 14;

export const ET_PIXEL_GRID_MAX_CELLS = 2500;

export type PixelGridSpec = {
  xmin: number;
  ymax: number;
  pixelWidth: number;
  pixelHeight: number;
};

export type EtPixelIndex = {
  col: number;
  row: number;
};

export type EtPixelBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type EtPixelGridBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export const defaultPixelGridSpec = (): PixelGridSpec => ({
  xmin: SUBSET_PIXEL_GRID_XMIN,
  ymax: SUBSET_PIXEL_GRID_YMAX,
  pixelWidth: SUBSET_PIXEL_SIZE_DEGREES,
  pixelHeight: SUBSET_PIXEL_SIZE_DEGREES,
});

export const pixelGridSpecFromGeoraster = (georaster: PreviewGeoRaster): PixelGridSpec => ({
  xmin: georaster.xmin,
  ymax: georaster.ymax,
  pixelWidth: georaster.pixelWidth,
  pixelHeight: georaster.pixelHeight,
});

const pixelIndex = (lon: number, lat: number, spec: PixelGridSpec): EtPixelIndex => {
  const col = Math.floor((lon - spec.xmin) / spec.pixelWidth);
  const row = Math.floor((spec.ymax - lat) / spec.pixelHeight);
  return { col, row };
};

export const pixelBoundsFromIndex = (index: EtPixelIndex, spec: PixelGridSpec): EtPixelBounds => {
  const west = spec.xmin + index.col * spec.pixelWidth;
  const north = spec.ymax - index.row * spec.pixelHeight;
  return {
    west,
    south: north - spec.pixelHeight,
    east: west + spec.pixelWidth,
    north,
  };
};

export const pixelBoundsFromLonLat = (lon: number, lat: number, spec: PixelGridSpec): EtPixelBounds => {
  return pixelBoundsFromIndex(pixelIndex(lon, lat, spec), spec);
};

export const pixelPolygonCoordinates = (bounds: EtPixelBounds): Polygon["coordinates"] => {
  const { west, south, east, north } = bounds;
  return [
    [
      [west, north],
      [east, north],
      [east, south],
      [west, south],
      [west, north],
    ],
  ];
};

export const pixelFeatureFromLonLat = (
  lon: number,
  lat: number,
  spec: PixelGridSpec,
  properties: Record<string, unknown> = {}
): Feature<Polygon> => {
  const index = pixelIndex(lon, lat, spec);
  const bounds = pixelBoundsFromIndex(index, spec);
  return {
    type: "Feature",
    properties: {
      ...properties,
      pixelCol: index.col,
      pixelRow: index.row,
    },
    geometry: {
      type: "Polygon",
      coordinates: pixelPolygonCoordinates(bounds),
    },
  };
};

export const viewportPixelGrid = (bounds: EtPixelGridBounds, spec: PixelGridSpec): FeatureCollection<Polygon> => {
  const minCol = Math.floor((bounds.west - spec.xmin) / spec.pixelWidth);
  const maxCol = Math.floor((bounds.east - spec.xmin) / spec.pixelWidth);
  const minRow = Math.floor((spec.ymax - bounds.north) / spec.pixelHeight);
  const maxRow = Math.floor((spec.ymax - bounds.south) / spec.pixelHeight);

  const colCount = maxCol - minCol + 1;
  const rowCount = maxRow - minRow + 1;

  if (colCount * rowCount > ET_PIXEL_GRID_MAX_CELLS) {
    return { type: "FeatureCollection", features: [] };
  }

  const features: Feature<Polygon>[] = [];

  for (let col = minCol; col <= maxCol; col++) {
    for (let row = minRow; row <= maxRow; row++) {
      const pixelBounds = pixelBoundsFromIndex({ col, row }, spec);
      features.push({
        type: "Feature",
        properties: {
          pixelCol: col,
          pixelRow: row,
        },
        geometry: {
          type: "Polygon",
          coordinates: pixelPolygonCoordinates(pixelBounds),
        },
      });
    }
  }

  return {
    type: "FeatureCollection",
    features,
  };
};

export const pixelIndexKey = (index: EtPixelIndex): string => `${index.col},${index.row}`;
