import dayjs, { Dayjs } from "dayjs";
import { QUEUE_STATUSES } from "./constants";
import { QueueJob, isActiveQueueStatus } from "./jobGroups";

export type JobTableSortColumn = "name" | "status" | "years" | "submitted" | "started" | "finished" | "author" | "group";
export type JobTableSortDirection = "asc" | "desc";

export interface JobTableColumnSort {
  column: JobTableSortColumn | null;
  direction: JobTableSortDirection | null;
}

export const BACKLOG_DATE_FILTER_OPTIONS = ["Last Day", "Last Week", "Last Month", "Last Year", "All Time", "Custom Range"] as const;
export type BacklogDateFilter = (typeof BACKLOG_DATE_FILTER_OPTIONS)[number];

export interface JobQueueFilterState {
  searchField: string;
  activeAuthorFilters: string[];
  activeStatusFilters: string[];
  backlogDateFilter: BacklogDateFilter;
  customDateFrom: Dayjs | null;
  customDateTo: Dayjs | null;
  sortAscending: boolean;
}

export function getBacklogCutoffDate(
  backlogDateFilter: BacklogDateFilter,
  customDateFrom: Dayjs | null
): Date | null {
  switch (backlogDateFilter) {
    case "Last Day":
      return dayjs().subtract(1, "day").toDate();
    case "Last Week":
      return dayjs().subtract(1, "week").toDate();
    case "Last Month":
      return dayjs().subtract(1, "month").toDate();
    case "Last Year":
      return dayjs().subtract(1, "year").toDate();
    case "Custom Range":
      return customDateFrom ? customDateFrom.startOf("day").toDate() : null;
    case "All Time":
    default:
      return null;
  }
}

export function getJobSubmittedTime(job: QueueJob): number | null {
  if (job.submittedAt) {
    return job.submittedAt;
  }
  if (job.submitted) {
    const parsed = new Date(job.submitted).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function getDefaultStatusFiltersForMode(mode: "active" | "completed", jobs: QueueJob[]): string[] {
  if (mode === "active") {
    return [...QUEUE_STATUSES];
  }

  const statuses = new Set<string>();
  jobs.forEach((job) => {
    if (!isActiveQueueStatus(job.status)) {
      statuses.add(job.status);
    }
  });
  return Array.from(statuses);
}

export function sortJobsByColumn(jobs: QueueJob[], sort: JobTableColumnSort): QueueJob[] {
  if (!sort.column || !sort.direction) {
    return jobs;
  }

  const direction = sort.direction === "asc" ? 1 : -1;

  return [...jobs].sort((a, b) => {
    let comparison = 0;

    switch (sort.column) {
      case "name":
        comparison = (a.name || "").localeCompare(b.name || "");
        break;
      case "status":
        comparison = (a.status || "").localeCompare(b.status || "");
        break;
      case "years":
        comparison = (a.start_year ?? 0) - (b.start_year ?? 0);
        break;
      case "submitted":
        comparison = (getJobSubmittedTime(a) ?? 0) - (getJobSubmittedTime(b) ?? 0);
        break;
      case "started":
        comparison = new Date(a.started || 0).getTime() - new Date(b.started || 0).getTime();
        break;
      case "finished":
        comparison = new Date(a.ended || 0).getTime() - new Date(b.ended || 0).getTime();
        break;
      case "author":
        comparison = (a.user?.name || "").localeCompare(b.user?.name || "");
        break;
      case "group":
        comparison = (a.group_name || "").localeCompare(b.group_name || "");
        break;
      default:
        comparison = 0;
    }

    return comparison * direction;
  });
}

export function cycleColumnSort(current: JobTableColumnSort, column: JobTableSortColumn): JobTableColumnSort {
  if (current.column !== column) {
    return { column, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { column, direction: "desc" };
  }
  return { column: null, direction: null };
}

export function filterQueueJobs(
  jobs: QueueJob[],
  filters: JobQueueFilterState,
  options?: { applyDateFilter?: boolean; customDateTo?: Dayjs | null; skipSort?: boolean }
): QueueJob[] {
  let items = [...jobs];
  const applyDateFilter = options?.applyDateFilter ?? false;

  if (applyDateFilter) {
    const cutoffDate = getBacklogCutoffDate(filters.backlogDateFilter, filters.customDateFrom);
    const customDateTo = options?.customDateTo ?? filters.customDateTo;

    if (filters.backlogDateFilter === "Custom Range") {
      const fromMs = filters.customDateFrom?.startOf("day").valueOf() ?? null;
      const toMs = customDateTo?.endOf("day").valueOf() ?? null;

      items = items.filter((item) => {
        const submittedTime = getJobSubmittedTime(item);
        const startedTime = item.started ? new Date(item.started).getTime() : null;
        const finishedTime = item.ended ? new Date(item.ended).getTime() : item.finished
          ? new Date(item.finished).getTime()
          : null;
        const referenceTime = submittedTime ?? startedTime ?? finishedTime;
        if (!referenceTime || Number.isNaN(referenceTime)) {
          return false;
        }
        if (fromMs != null && referenceTime < fromMs) {
          return false;
        }
        if (toMs != null && referenceTime > toMs) {
          return false;
        }
        return true;
      });
    } else if (cutoffDate) {
      items = items.filter(
        (item) =>
          (item.started && new Date(item.started) > cutoffDate) ||
          (item.ended && new Date(item.ended) > cutoffDate) ||
          (item.finished && new Date(item.finished) > cutoffDate) ||
          (() => {
            const submittedTime = getJobSubmittedTime(item);
            return submittedTime != null && submittedTime > cutoffDate.getTime();
          })()
      );
    }
  }

  if (filters.activeAuthorFilters.length) {
    items = items.filter((item) => item.user?.name && filters.activeAuthorFilters.includes(item.user.name));
  }

  if (filters.activeStatusFilters.length) {
    items = items.filter((item) => filters.activeStatusFilters.includes(item.status));
  }

  const searchTerm = filters.searchField?.toLowerCase() || "";
  if (searchTerm) {
    items = items.filter((item) => {
      const fields = [
        item?.name?.toLowerCase() || "",
        item?.group_name?.toLowerCase() || "",
        `${item?.start_year}`,
        `${item?.end_year}`,
        item.user?.name?.toLowerCase(),
        item.user?.email?.toLowerCase(),
        item?.status.toLowerCase(),
      ].filter((field): field is string => Boolean(field));

      return fields.some((field) => field.includes(searchTerm));
    });
  }

  if (!options?.skipSort) {
    items.sort((a, b) => {
      const aTime = new Date(a.started || 0).getTime() || getJobSubmittedTime(a) || 0;
      const bTime = new Date(b.started || 0).getTime() || getJobSubmittedTime(b) || 0;
      if (filters.sortAscending) {
        return aTime - bTime;
      }
      return bTime - aTime;
    });
  }

  return items;
}

export function isReorderableQueueJob(job: QueueJob): boolean {
  return ["Pending", "WaitingApproval", "Paused"].includes(job.status);
}

export function sortJobsForQueueOrder(jobs: QueueJob[]): QueueJob[] {
  return [...jobs]
    .filter(isReorderableQueueJob)
    .sort((a, b) => (getJobSubmittedTime(a) ?? 0) - (getJobSubmittedTime(b) ?? 0));
}

export function buildQueueRunOrderMap(queue: QueueJob[], reorderableKeys?: string[]): Map<string, number> {
  const order = new Map<string, number>();
  let position = 1;

  for (const job of queue) {
    if (job.status === "In Progress") {
      order.set(job.key, position++);
    }
  }

  const keys = reorderableKeys?.length ? reorderableKeys : sortJobsForQueueOrder(queue).map((job) => job.key);

  for (const key of keys) {
    if (!order.has(key)) {
      order.set(key, position++);
    }
  }

  return order;
}
