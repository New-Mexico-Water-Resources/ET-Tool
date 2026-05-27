import { DialogContentText } from "@mui/material";
import { submitJobConfirmSx } from "../utils/helpers";

export interface BulkSubmitConfirmParams {
  jobCount: number;
  yearsPerJob: number;
  startYear: number;
  endYear: number;
  totalYearRuns: number;
  acres: number;
  estimatedTime: string;
}

export function createBulkSubmitConfirmOptions(params: BulkSubmitConfirmParams) {
  const { jobCount, yearsPerJob, startYear, endYear, totalYearRuns, acres, estimatedTime } = params;

  const description = [
    `Jobs: ${jobCount}`,
    `Years: ${yearsPerJob} per job (${startYear}-${endYear}), ${totalYearRuns} total year-runs`,
    `Combined area (visible layers): ${acres.toLocaleString(undefined, { maximumFractionDigits: 2 })} acres`,
    `Estimated processing time: ~${estimatedTime}`,
  ].join("\n");

  return {
    title: `Submit ${jobCount} job${jobCount === 1 ? "" : "s"}?`,
    content: (
      <DialogContentText sx={{ color: "var(--st-gray-10)", whiteSpace: "pre-line", mb: 0 }}>
        {description}
      </DialogContentText>
    ),
    ...submitJobConfirmSx,
  };
}
