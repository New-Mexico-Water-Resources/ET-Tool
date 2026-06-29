import type { Feature, FeatureCollection, Geometry } from "geojson";
import { QUEUE_STATUSES } from "./constants";
import { JobStatus } from "./store";

const GEOMETRY_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

export type GroupGeojsonSource = {
  geojson: unknown;
  name?: string;
  jobKey?: string;
};

export function geojsonToFeatures(geojson: unknown, extraProperties: Record<string, unknown> = {}): Feature[] {
  if (!geojson || typeof geojson !== "object") {
    return [];
  }

  if (!("type" in geojson)) {
    return [];
  }

  const geoType = String((geojson as { type: unknown }).type);

  if (geoType === "FeatureCollection") {
    const collection = geojson as FeatureCollection;
    return (collection.features ?? []).map((feature: Feature) => ({
      ...feature,
      properties: { ...feature.properties, ...extraProperties },
    }));
  }

  if (geoType === "Feature") {
    const feature = geojson as Feature;
    return [
      {
        type: "Feature",
        geometry: feature.geometry,
        properties: { ...feature.properties, ...extraProperties },
      },
    ];
  }

  if (GEOMETRY_TYPES.has(geoType)) {
    return [
      {
        type: "Feature",
        properties: { ...extraProperties },
        geometry: geojson as Geometry,
      },
    ];
  }

  return [];
}

export function combineGeojsonsToFeatureCollection(sources: GroupGeojsonSource[]): FeatureCollection {
  const features: Feature[] = [];

  for (const source of sources) {
    const properties: Record<string, unknown> = {};
    if (source.name) {
      properties.name = source.name;
    }
    if (source.jobKey) {
      properties.jobKey = source.jobKey;
    }

    features.push(...geojsonToFeatures(source.geojson, properties));
  }

  return { type: "FeatureCollection", features };
}

export interface QueueJob {
  key: string;
  name: string;
  status: string;
  group_id?: string | null;
  group_name?: string | null;
  start_year?: number;
  end_year?: number;
  started?: string | null;
  ended?: string | null;
  finished?: string | null;
  submitted?: string | null;
  submittedAt?: number | null;
  startedAt?: number | null;
  endedAt?: number | null;
  timeElapsed?: string | null;
  status_msg?: string | null;
  paused_year?: number | null;
  last_generated_year?: number | null;
  loaded_geo_json?: unknown;
  user?: {
    name?: string;
    email?: string;
    sub?: string;
    picture?: string;
  };
}

export type QueueDisplayItem =
  | { type: "job"; job: QueueJob }
  | { type: "group"; groupId: string; groupName: string; jobs: QueueJob[] };

export function generateGroupId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function isActiveQueueStatus(status: string): boolean {
  return QUEUE_STATUSES.includes(status);
}

export function partitionJobsForQueueView(jobs: QueueJob[]): { queue: QueueJob[]; backlog: QueueJob[] } {
  const byGroup = new Map<string, QueueJob[]>();
  const ungrouped: QueueJob[] = [];

  for (const job of jobs) {
    if (job.group_id) {
      const members = byGroup.get(job.group_id) ?? [];
      members.push(job);
      byGroup.set(job.group_id, members);
    } else {
      ungrouped.push(job);
    }
  }

  const queue: QueueJob[] = [];
  const backlog: QueueJob[] = [];

  for (const job of ungrouped) {
    if (isActiveQueueStatus(job.status)) {
      queue.push(job);
    } else {
      backlog.push(job);
    }
  }

  for (const members of byGroup.values()) {
    const allFinished = members.every((job) => !isActiveQueueStatus(job.status));
    if (allFinished) {
      backlog.push(...members);
    } else {
      queue.push(...members);
    }
  }

  return { queue, backlog };
}

export function buildQueueDisplayItems(jobs: QueueJob[]): QueueDisplayItem[] {
  const groupMembers = new Map<string, QueueJob[]>();

  for (const job of jobs) {
    if (job.group_id) {
      const members = groupMembers.get(job.group_id) ?? [];
      members.push(job);
      groupMembers.set(job.group_id, members);
    }
  }

  const seenGroups = new Set<string>();
  const items: QueueDisplayItem[] = [];

  for (const job of jobs) {
    if (job.group_id) {
      if (seenGroups.has(job.group_id)) {
        continue;
      }
      seenGroups.add(job.group_id);
      const members = groupMembers.get(job.group_id) ?? [job];
      if (members.length === 1) {
        items.push({ type: "job", job: members[0] });
      } else {
        const groupName =
          members.find((m) => m.group_name)?.group_name ||
          members[0].name ||
          `Job group (${members.length})`;
        items.push({ type: "group", groupId: job.group_id, groupName, jobs: members });
      }
      continue;
    }
    items.push({ type: "job", job });
  }

  return items;
}

export function computeGroupStatus(jobs: Pick<QueueJob, "status">[]): string {
  const statuses = jobs.map(job => job.status);
  const terminalStatuses = ["Complete", "Killed"];
  for (const termStatus of terminalStatuses) {
    if (statuses.every(status => status === termStatus)) {
      return termStatus;
    }
  }

  const statusPriority = [
    "In Progress",
    "Pending",
    "WaitingApproval",
    "Paused",
    "Failed"
  ];

  // If not all complete or killed, return the highest priority status of existing jobs
  for (const status of statusPriority) {
    if (statuses.includes(status)) {
      return status;
    }
  }


  if (statuses.some((s) => s === "Complete")) {
    return "In Progress";
  }
  return statuses[0] || "Pending";
}

export function getGroupStatusSummary(jobs: Pick<QueueJob, "status">[]): string {
  const statuses = jobs.map((j) => j.status);
  const completeCount = statuses.filter((s) => s === "Complete").length;
  const total = jobs.length;
  if (completeCount === total) {
    return "Complete";
  }
  if (completeCount > 0) {
    return `${completeCount}/${total} complete`;
  }
  return computeGroupStatus(jobs);
}

export function computeGroupProgress(jobs: QueueJob[], jobStatuses: Record<string, JobStatus>): number {
  if (jobs.length === 0) {
    return 0;
  }

  let total = 0;
  for (const job of jobs) {
    if (job.status === "Complete") {
      total += 1;
      continue;
    }
    const status = jobStatuses[job.key];
    total += status?.estimatedPercentComplete ?? 0;
  }

  return total / jobs.length;
}

export function getGroupYearRangeLabel(jobs: QueueJob[]): string {
  const starts = jobs.map((j) => j.start_year).filter((y): y is number => y != null);
  const ends = jobs.map((j) => j.end_year).filter((y): y is number => y != null);
  if (!starts.length || !ends.length) {
    return "N/A";
  }
  const minStart = Math.min(...starts);
  const maxEnd = Math.max(...ends);
  return `${minStart} - ${maxEnd}`;
}

export function getGroupStartedLabel(jobs: QueueJob[]): string {
  const startedJobs = jobs.filter((j) => j.started);
  if (!startedJobs.length) {
    return "Not started yet";
  }

  const withTimes = startedJobs
    .map((job) => ({
      label: job.started!,
      time: new Date(job.started!).getTime(),
    }))
    .filter((entry) => !Number.isNaN(entry.time));

  if (!withTimes.length) {
    return startedJobs[0].started!;
  }

  withTimes.sort((a, b) => a.time - b.time);
  return withTimes[0].label;
}

export function getGroupSubmitter(jobs: QueueJob[]) {
  const names = new Set(jobs.map((j) => j.user?.name).filter(Boolean));
  if (names.size > 1) {
    return null;
  }
  return jobs.find((j) => j.user?.name)?.user ?? null;
}

export const QUEUE_JOB_ITEM_HEIGHT = 308;
export const QUEUE_JOB_ITEM_COMPACT_HEIGHT = 244;
export const QUEUE_GROUP_HEADER_HEIGHT = 196;

export function isCompactQueueJob(job: Pick<QueueJob, "status">): boolean {
  return job.status === "Complete";
}

export function getQueueJobItemHeight(job: QueueJob): number {
  return isCompactQueueJob(job) ? QUEUE_JOB_ITEM_COMPACT_HEIGHT : QUEUE_JOB_ITEM_HEIGHT;
}

export function getQueueDisplayItemHeight(
  item: QueueDisplayItem,
  expandedGroupIds: Set<string>
): number {
  if (item.type === "job") {
    return getQueueJobItemHeight(item.job);
  }
  if (!expandedGroupIds.has(item.groupId)) {
    return QUEUE_GROUP_HEADER_HEIGHT;
  }
  return QUEUE_GROUP_HEADER_HEIGHT + item.jobs.reduce((sum, job) => sum + getQueueJobItemHeight(job), 0);
}
