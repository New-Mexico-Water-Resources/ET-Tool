import { Divider, MenuItem, Typography } from "@mui/material";
import useStore from "../utils/store";
import { getReportMenuOptions } from "../utils/defaultDownloadOptions";
import { QueueJob } from "../utils/jobGroups";

type DefaultReportMenuItemsProps = {
  jobKey?: string;
  groupJobs?: QueueJob[];
  groupName?: string;
  disabled?: boolean;
  onClose: () => void;
  menuItemSx?: Record<string, unknown>;
  labelPrefix?: string;
  showSectionHeader?: boolean;
};

const DefaultReportMenuItems = ({
  jobKey,
  groupJobs,
  groupName,
  disabled = false,
  onClose,
  menuItemSx = { backgroundColor: "var(--st-gray-80)" },
  labelPrefix = "",
  showSectionHeader = true,
}: DefaultReportMenuItemsProps) => {
  const defaultDownloadOptions = useStore((state) => state.defaultDownloadOptions);
  const downloadJob = useStore((state) => state.downloadJob);
  const downloadJobGroup = useStore((state) => state.downloadJobGroup);
  const openCustomDownload = useStore((state) => state.openCustomDownload);
  const options = getReportMenuOptions(defaultDownloadOptions);
  const isGroupMode = Boolean(groupJobs?.length && groupName);

  const handleReportDownload = (units: "metric" | "imperial" | "acre-feet") => {
    if (isGroupMode && groupJobs && groupName) {
      downloadJobGroup(groupJobs, groupName, units);
      return;
    }
    if (jobKey) {
      downloadJob(jobKey, units);
    }
  };

  const handleCustomDownload = () => {
    if (jobKey) {
      openCustomDownload(jobKey);
    }
  };

  return (
    <>
      {showSectionHeader && (
        <>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ marginLeft: "8px", marginBottom: "4px", backgroundColor: "var(--st-gray-80)" }}
          >
            Report
          </Typography>
          <Divider />
        </>
      )}
      {options
        .filter((option) => !(isGroupMode && option.type === "custom"))
        .map((option) => (
        <MenuItem
          key={option.id}
          sx={menuItemSx}
          disableRipple
          disabled={disabled}
          onClick={() => {
            if (option.type === "custom") {
              handleCustomDownload();
            } else {
              handleReportDownload(option.units);
            }
            onClose();
          }}
        >
          {labelPrefix}
          {isGroupMode && option.type === "report" ? option.label.replace(/^Report /, "All Reports ") : option.label}
        </MenuItem>
      ))}
    </>
  );
};

export default DefaultReportMenuItems;
