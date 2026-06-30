export interface JobLogWarning {
  message: string;
  original: string;
}

const ERROR_ALIASES: { pattern: RegExp; message: string }[] = [
  {
    pattern: /Error getting items:.*(?:exceeded the maximum allowed time|planetarycomputer)/i,
    message: "Microsoft Planetary Computer experienced some issues and did not return valid cloud coverage data",
  },
  {
    pattern: /Error accessing QA data for item/i,
    message: "Cloud quality data could not be retrieved for one or more satellite scenes",
  },
  {
    pattern: /Failed to calculate cloud coverage percentage/i,
    message: "Cloud coverage could not be calculated for one or more months",
  },
  {
    pattern: /Failed to retrieve file from S3/i,
    message: "One or more source files could not be retrieved from storage",
  },
  {
    pattern: /Failed to calculate ET (?:min|max) average/i,
    message: "ET statistics could not be calculated for one or more months",
  },
  {
    pattern: /Failed to calculate PPT average/i,
    message: "Precipitation statistics could not be calculated for one or more months",
  },
];

const LOG_ERROR_MARKER = "ERROR]";

export function extractLogErrors(logs: string): string[] {
  const errors = new Set<string>();

  for (const line of logs.split("\n")) {
    const markerIndex = line.indexOf(LOG_ERROR_MARKER);
    if (markerIndex === -1) {
      continue;
    }

    const message = line.slice(markerIndex + LOG_ERROR_MARKER.length).trim();
    if (message) {
      errors.add(message);
    }
  }

  return [...errors];
}

export function translateLogError(rawError: string): JobLogWarning {
  for (const alias of ERROR_ALIASES) {
    if (alias.pattern.test(rawError)) {
      return { message: alias.message, original: rawError };
    }
  }

  return { message: rawError, original: rawError };
}

export function getJobLogWarnings(logs: string): JobLogWarning[] {
  const seenMessages = new Set<string>();
  const warnings: JobLogWarning[] = [];

  for (const rawError of extractLogErrors(logs)) {
    const warning = translateLogError(rawError);
    if (seenMessages.has(warning.message)) {
      continue;
    }

    seenMessages.add(warning.message);
    warnings.push(warning);
  }

  return warnings;
}

const warningsCache = new Map<string, JobLogWarning[]>();
const warningsFetchCache = new Map<string, Promise<JobLogWarning[]>>();

export function getCachedJobLogWarnings(jobKey: string): JobLogWarning[] | undefined {
  return warningsCache.get(jobKey);
}

export function clearJobLogWarningsCache(jobKey?: string): void {
  if (jobKey) {
    warningsCache.delete(jobKey);
    warningsFetchCache.delete(jobKey);
    return;
  }

  warningsCache.clear();
  warningsFetchCache.clear();
}

export async function fetchJobLogWarnings(
  jobKey: string,
  fetchJobLogs: (jobKey: string) => Promise<{ logs: string }> | null,
): Promise<JobLogWarning[]> {
  const cached = warningsCache.get(jobKey);
  if (cached) {
    return cached;
  }

  const inFlight = warningsFetchCache.get(jobKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const response = await fetchJobLogs(jobKey);
    const warnings = getJobLogWarnings(response?.logs || "");
    warningsCache.set(jobKey, warnings);
    warningsFetchCache.delete(jobKey);
    return warnings;
  })();

  warningsFetchCache.set(jobKey, request);
  return request;
}
