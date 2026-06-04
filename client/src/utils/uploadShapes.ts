import { area as turfArea } from "@turf/turf";
import type { PolygonLocation } from "./store";

const SYNTHETIC_DRAWN_FILE_PATTERN = /^(drawn-shape|Point_[-\d.]+_[-\d.]+)\.geojson$/;

export function isSyntheticDrawnUploadFile(file: File | null | undefined): boolean {
  return Boolean(file && SYNTHETIC_DRAWN_FILE_PATTERN.test(file.name));
}

export function uploadFileBaseName(file: File): string {
  return file.name.replace(/\.[^/.]+$/, "").trim();
}

export function collectExistingUploadShapes(state: {
  loadedGeoJSON: unknown;
  multipolygons: unknown[];
}): unknown[] {
  if (state.multipolygons.length > 0) {
    return [...state.multipolygons];
  }
  if (state.loadedGeoJSON) {
    return [state.loadedGeoJSON];
  }
  return [];
}

export function applyUploadShapeList(geojsons: unknown[]): {
  loadedGeoJSON: unknown | null;
  multipolygons: unknown[];
} {
  if (geojsons.length === 0) {
    return { loadedGeoJSON: null, multipolygons: [] };
  }
  if (geojsons.length === 1) {
    return { loadedGeoJSON: geojsons[0], multipolygons: [] };
  }
  return { loadedGeoJSON: null, multipolygons: geojsons };
}

export function mergePolygonLocations(
  built: PolygonLocation[],
  previous: PolygonLocation[],
  options?: { inheritFirstName?: string }
): PolygonLocation[] {
  return built.map((location, index) => {
    const prev = previous[index];
    if (prev) {
      return {
        ...location,
        name: prev.name,
        visible: prev.visible,
        comments: prev.comments,
      };
    }

    if (index === 0 && options?.inheritFirstName) {
      return { ...location, name: options.inheritFirstName };
    }

    return location;
  });
}

export function buildPolygonLocationsFromGeojsons(
  multipolygons: unknown[],
  minimumValidArea: number,
  maximumValidArea: number
): PolygonLocation[] {
  return multipolygons.map((geojson, index) => {
    const geo = geojson as Record<string, unknown>;
    const geoAny = geojson as {
      geometry?: { coordinates?: number[][][] };
      features?: { properties?: { name?: string }; geometry?: { coordinates?: number[][][] } }[];
      properties?: Record<string, unknown>;
    };
    let defaultName = `${(geo?.properties as Record<string, unknown>)?.County || ""} Part ${index + 1}`;
    defaultName = defaultName.trim();

    const features = geoAny.features;
    const name = features?.[0]?.properties?.name || defaultName;

    let lat = geoAny.geometry?.coordinates?.[0]?.[0]?.[0];
    let long = geoAny.geometry?.coordinates?.[0]?.[0]?.[1];

    if (lat == null || long == null) {
      lat = features?.[0]?.geometry?.coordinates?.[0]?.[0]?.[0];
      long = features?.[0]?.geometry?.coordinates?.[0]?.[0]?.[1];
    }

    const area = turfArea(geojson as Parameters<typeof turfArea>[0]);
    const areaInAcres = area / 4046.86;
    const isValidArea = area > minimumValidArea && area < maximumValidArea;

    const properties = (geo?.properties || {}) as Record<string, unknown>;

    return {
      visible: isValidArea,
      name,
      acres: areaInAcres,
      comments: (properties.Comments as string) || "",
      county: (properties.County as string) || "",
      polygon_So: (properties.Polygon_So as string) || "",
      shapeArea: area,
      shapeLeng: (properties.Shape_Leng as number) || 0,
      source: (properties.Source as string) || "",
      wUR_Basin: (properties.WUR_Basin as string) || "",
      id: index,
      lat: lat || 0,
      long: long || 0,
      crop: (properties.CDL_Crop as string) || "",
      isValidArea,
    };
  });
}

export function geojsonsFromPrepareResponse(data: unknown): unknown[] {
  if (!data || typeof data !== "object") {
    return [];
  }

  const payload = data as { multipolygon?: boolean; geojsons?: unknown[] };
  if (payload.multipolygon && payload.geojsons?.length) {
    return payload.geojsons;
  }

  return [data];
}
