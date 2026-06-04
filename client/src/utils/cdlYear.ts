import type { AxiosInstance } from "axios";
import { API_URL } from "./constants";

export const CDL_MAP_LAYER_NAME = "USDA Cropland Data Layer";
export const CDL_BASEMAP_SHORT_NAME = "USDA Cropland";

const CACHE_KEY = "et-tool-cdl-release-year";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CdlYearCache = {
  year: number;
  fetchedAt: string;
};

function readCache(): CdlYearCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CdlYearCache;
    if (typeof parsed?.year !== "number" || !Number.isFinite(parsed.year) || !parsed?.fetchedAt) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    if (Date.now() - new Date(parsed.fetchedAt).getTime() > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(year: number) {
  const entry: CdlYearCache = { year, fetchedAt: new Date().toISOString() };
  localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
}

export function getCachedCdlReleaseYear(): number | null {
  return readCache()?.year ?? null;
}

export function formatCdlBasemapSidebarLabel(releaseYear?: number | null): string {
  if (releaseYear == null) {
    return CDL_MAP_LAYER_NAME;
  }
  return `${releaseYear} ${CDL_BASEMAP_SHORT_NAME}`;
}

export function formatCdlLegendTitle(releaseYear?: number | null): string {
  if (releaseYear == null) {
    return `${CDL_MAP_LAYER_NAME} Legend`;
  }
  return `${releaseYear} ${CDL_MAP_LAYER_NAME} Legend`;
}

export async function fetchCdlReleaseYear(axiosInstance: AxiosInstance | null): Promise<number | null> {
  const cached = readCache();
  if (cached) {
    return cached.year;
  }

  if (!axiosInstance) {
    return null;
  }

  try {
    const { data } = await axiosInstance.get<{ year: number }>(`${API_URL}/auxiliary/cdl-year`);
    if (typeof data?.year === "number" && Number.isFinite(data.year)) {
      writeCache(data.year);
      return data.year;
    }
  } catch {
    // Legend still works without a year in the title.
  }

  return null;
}
