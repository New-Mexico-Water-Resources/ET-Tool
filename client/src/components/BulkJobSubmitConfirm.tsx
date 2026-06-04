import { DialogContentText } from "@mui/material";
import { formatSubmitBulkJobsConfirmTitle, submitJobConfirmSx } from "../utils/helpers";

export interface BulkSubmitConfirmParams {
  jobCount: number;
  groupJobsTogether: boolean;
  groupName?: string;
  yearsPerJob: number;
  startYear: number;
  endYear: number;
  totalYearRuns: number;
  acres: number;
  estimatedTime: string;
}

export function createBulkSubmitConfirmOptions(params: BulkSubmitConfirmParams) {
  const {
    jobCount,
    groupJobsTogether,
    groupName,
    yearsPerJob,
    startYear,
    endYear,
    totalYearRuns,
    acres,
    estimatedTime,
  } = params;

  const descriptionLines = [
    `Jobs: ${jobCount}`,
    `Grouped together: ${groupJobsTogether ? "Yes" : "No"}`,
  ];

  if (groupJobsTogether && groupName?.trim()) {
    descriptionLines.push(`Group name: ${groupName.trim()}`);
  }

  descriptionLines.push(
    `Years: ${yearsPerJob} per job (${startYear}-${endYear}), ${totalYearRuns} total year-runs`,
    `Combined area (visible layers): ${acres.toLocaleString(undefined, { maximumFractionDigits: 2 })} acres`,
    `Estimated processing time: ~${estimatedTime}`
  );

  return {
    title: formatSubmitBulkJobsConfirmTitle(jobCount),
    content: (
      <DialogContentText sx={{ color: "var(--st-gray-10)", whiteSpace: "pre-line", mb: 0 }}>
        {descriptionLines.join("\n")}
      </DialogContentText>
    ),
    ...submitJobConfirmSx,
  };
}
