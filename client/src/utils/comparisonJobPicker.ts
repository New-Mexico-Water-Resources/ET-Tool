import { centroid, distance } from "@turf/turf";
import type { AxiosInstance } from "axios";
import dayjs from "dayjs";
import { API_URL } from "./constants";
import { getJobSubmittedTime } from "./jobQueueFilters";
import type { QueueJob } from "./jobGroups";

export type ComparisonJobSort = "name" | "submitted" | "proximity";
export type ComparisonDateFilter = "all" | "week" | "month" | "year";

export type JobCentroid = {
  lng: number;
  lat: number;
};

export type ComparisonJobAuthor = {
  key: string;
  label: string;
};

const DATE_FILTER_CUTOFF_MS: Record<Exclude<ComparisonDateFilter, "all">, number> = {
  week: dayjs().subtract(1, "week").valueOf(),
  month: dayjs().subtract(1, "month").valueOf(),
  year: dayjs().subtract(1, "year").valueOf(),
};

export function getJobAuthorKey(job: QueueJob): string | null {
  const email = job.user?.email?.trim().toLowerCase();
  if (email) {
    return email;
  }
  const sub = job.user?.sub?.trim();
  if (sub) {
    return sub;
  }
  const name = job.user?.name?.trim();
  if (name) {
    return name.toLowerCase();
  }
  return null;
}

export function getJobAuthorLabel(job: QueueJob): string {
  return job.user?.name?.trim() || job.user?.email?.trim() || "Unknown author";
}

export function getComparisonJobAuthors(jobs: QueueJob[]): ComparisonJobAuthor[] {
  const authorsByKey = new Map<string, ComparisonJobAuthor>();

  for (const job of jobs) {
    const key = getJobAuthorKey(job);
    if (!key) {
      continue;
    }

    const preferredLabel = getJobAuthorLabel(job);
    const existing = authorsByKey.get(key);
    if (!existing) {
      authorsByKey.set(key, { key, label: preferredLabel });
      continue;
    }

    if (!job.user?.name?.trim() && existing.label) {
      continue;
    }
    if (job.user?.name?.trim()) {
      authorsByKey.set(key, { key, label: job.user.name.trim() });
    }
  }

  return Array.from(authorsByKey.values()).sort((a, b) => a.label.localeCompare(b.label));
}

export function getCentroidFromGeojson(geojson: unknown): JobCentroid | null {
  if (!geojson || typeof geojson !== "object") {
    return null;
  }

  try {
    const point = centroid(geojson as Parameters<typeof centroid>[0]);
    const [lng, lat] = point.geometry.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      return null;
    }
    return { lng, lat };
  } catch {
    return null;
  }
}

export async function fetchJobGeojson(axiosInstance: AxiosInstance, job: QueueJob): Promise<unknown | null> {
  if (job.loaded_geo_json) {
    return job.loaded_geo_json;
  }

  try {
    const response = await axiosInstance.get(
      `${API_URL}/geojson?name=${encodeURIComponent(job.name)}&key=${encodeURIComponent(job.key)}`,
    );
    if (response?.data?.geojsons?.length) {
      return response.data.geojsons[0];
    }
    return response.data ?? null;
  } catch {
    return null;
  }
}

export async function resolveJobCentroid(
  axiosInstance: AxiosInstance,
  job: QueueJob,
  cache: Map<string, JobCentroid | null>,
): Promise<JobCentroid | null> {
  if (cache.has(job.key)) {
    return cache.get(job.key) ?? null;
  }

  const fromLoaded = getCentroidFromGeojson(job.loaded_geo_json);
  if (fromLoaded) {
    cache.set(job.key, fromLoaded);
    return fromLoaded;
  }

  const geojson = await fetchJobGeojson(axiosInstance, job);
  const resolved = getCentroidFromGeojson(geojson);
  cache.set(job.key, resolved);
  if (geojson) {
    job.loaded_geo_json = geojson;
  }
  return resolved;
}

export function distanceMiles(from: JobCentroid, to: JobCentroid): number {
  return distance([from.lng, from.lat], [to.lng, to.lat], { units: "miles" });
}

export function formatComparisonDistance(miles: number | null | undefined): string {
  if (miles == null || !Number.isFinite(miles)) {
    return "Distance unknown";
  }
  if (miles < 0.1) {
    return `${Math.round(miles * 5280)} ft away`;
  }
  if (miles < 10) {
    return `${miles.toFixed(1)} mi away`;
  }
  return `${Math.round(miles)} mi away`;
}

export function formatComparisonSubmitted(job: QueueJob): string {
  const submittedTime = getJobSubmittedTime(job);
  if (!submittedTime) {
    return "Unknown";
  }
  return new Date(submittedTime).toLocaleDateString();
}

export function filterComparisonJobs(
  jobs: QueueJob[],
  {
    search,
    authorFilters,
    dateFilter,
  }: {
    search: string;
    authorFilters: string[];
    dateFilter: ComparisonDateFilter;
  },
): QueueJob[] {
  const normalizedSearch = search.trim().toLowerCase();

  return jobs.filter((job) => {
    if (authorFilters.length > 0) {
      const authorKey = getJobAuthorKey(job);
      if (!authorKey || !authorFilters.includes(authorKey)) {
        return false;
      }
    }

    if (dateFilter !== "all") {
      const submittedTime = getJobSubmittedTime(job);
      if (!submittedTime || submittedTime < DATE_FILTER_CUTOFF_MS[dateFilter]) {
        return false;
      }
    }

    if (!normalizedSearch) {
      return true;
    }

    const fields = [
      job.name,
      job.user?.name,
      job.user?.email,
      job.start_year != null ? String(job.start_year) : "",
      job.end_year != null ? String(job.end_year) : "",
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase());

    return fields.some((field) => field.includes(normalizedSearch));
  });
}

export function sortComparisonJobs(
  jobs: QueueJob[],
  sortBy: ComparisonJobSort,
  distancesMiles: Map<string, number | null>,
): QueueJob[] {
  const sorted = [...jobs];

  if (sortBy === "submitted") {
    sorted.sort((a, b) => (getJobSubmittedTime(b) ?? 0) - (getJobSubmittedTime(a) ?? 0));
    return sorted;
  }

  if (sortBy === "proximity") {
    sorted.sort((a, b) => {
      const distanceA = distancesMiles.get(a.key);
      const distanceB = distancesMiles.get(b.key);
      if (distanceA == null && distanceB == null) {
        return a.name.localeCompare(b.name);
      }
      if (distanceA == null) {
        return 1;
      }
      if (distanceB == null) {
        return -1;
      }
      if (distanceA === distanceB) {
        return a.name.localeCompare(b.name);
      }
      return distanceA - distanceB;
    });
    return sorted;
  }

  sorted.sort((a, b) => a.name.localeCompare(b.name));
  return sorted;
}
