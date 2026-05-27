import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CloseIcon from "@mui/icons-material/Close";
import MapIcon from "@mui/icons-material/Map";
import DownloadIcon from "@mui/icons-material/Download";
import { useEffect, useMemo, useState } from "react";
import { useConfirm } from "material-ui-confirm";
import StatusIcon from "./StatusIcon";
import JobQueueItem from "./JobQueueItem";
import useStore from "../utils/store";
import {
  QueueJob,
  computeGroupProgress,
  computeGroupStatus,
  getGroupStartedLabel,
  getGroupStatusSummary,
  getGroupSubmitter,
  getGroupYearRangeLabel,
} from "../utils/jobGroups";
import { formatElapsedTime } from "../utils/helpers";

interface JobQueueGroupProps {
  jobs: QueueJob[];
  groupName: string;
  expanded: boolean;
  onToggle: () => void;
  onOpenLogs: (key: string) => void;
}

const JobQueueGroup = ({ jobs, groupName, expanded, onToggle, onOpenLogs }: JobQueueGroupProps) => {
  const confirm = useConfirm();
  const [jobStatuses, fetchJobStatus] = useStore((state) => [state.jobStatuses, state.fetchJobStatus]);
  const loadJobGroup = useStore((state) => state.loadJobGroup);
  const downloadJobGroup = useStore((state) => state.downloadJobGroup);
  const downloadJobGroupGeojson = useStore((state) => state.downloadJobGroupGeojson);
  const downloadingJobGroupId = useStore((state) => state.downloadingJobGroupId);
  const deleteJob = useStore((state) => state.deleteJob);
  const activeJob = useStore((state) => state.activeJob);
  const setActiveJob = useStore((state) => state.setActiveJob);
  const currentUserInfo = useStore((state) => state.userInfo);
  const canDeleteGroup = useMemo(() => {
    const hasPermission = currentUserInfo?.permissions?.includes("write:jobs");
    if (hasPermission) {
      return true;
    }
    return jobs.every((job) => job?.user?.sub === currentUserInfo?.sub);
  }, [currentUserInfo, jobs]);

  const groupHasKilledOnly = useMemo(() => jobs.every((job) => job.status === "Killed"), [jobs]);

  const [downloadAnchorEl, setDownloadAnchorEl] = useState<null | HTMLElement>(null);
  const downloadMenuOpen = Boolean(downloadAnchorEl);

  const groupId = jobs[0]?.group_id || groupName;
  const isDownloading = downloadingJobGroupId === groupId;

  const groupStatus = useMemo(() => computeGroupStatus(jobs), [jobs]);
  const statusSummary = useMemo(() => getGroupStatusSummary(jobs), [jobs]);
  const groupProgress = useMemo(() => computeGroupProgress(jobs, jobStatuses), [jobs, jobStatuses]);
  const percentComplete = Math.max(Math.min(Math.round(groupProgress * 1000) / 10, 100), 0);
  const yearRangeLabel = useMemo(() => getGroupYearRangeLabel(jobs), [jobs]);
  const startedLabel = useMemo(() => getGroupStartedLabel(jobs), [jobs]);
  const submitter = useMemo(() => getGroupSubmitter(jobs), [jobs]);

  const isDownloadDisabled = useMemo(() => {
    return jobs.every((job) => ["Pending", "In Progress", "WaitingApproval"].includes(job.status));
  }, [jobs]);

  useEffect(() => {
    jobs.forEach((job) => {
      fetchJobStatus(job.key, job.name);
    });
    const interval = setInterval(() => {
      jobs.forEach((job) => {
        fetchJobStatus(job.key, job.name);
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [jobs, fetchJobStatus]);

  const progressTooltip = useMemo(() => {
    const completeCount = jobs.filter((j) => j.status === "Complete").length;
    let text = `Group status: ${statusSummary}\nJobs complete: ${completeCount}/${jobs.length}\nOverall progress: ${percentComplete}%`;

    const inProgressJobs = jobs.filter((j) => j.status === "In Progress");
    if (inProgressJobs.length > 0) {
      const remaining = inProgressJobs.reduce((acc, job) => acc + (jobStatuses[job.key]?.timeRemaining ?? 0), 0);
      if (remaining > 0) {
        text += `\nEstimated time remaining (in progress): ${formatElapsedTime(remaining)}`;
      }
    }

    return text;
  }, [jobs, jobStatuses, statusSummary, percentComplete]);

  const handleLocate = () => {
    void loadJobGroup(jobs, groupName);
  };

  return (
    <div className="queue-group">
      <div className="queue-group-header item-header">
        <Box className="queue-group-title-row">
          <StatusIcon status={groupStatus} />
          <Tooltip title={`${groupName}\n${statusSummary}`}>
            <Typography variant="h6" className="queue-group-title">
              {groupName}
            </Typography>
          </Tooltip>
          <Typography variant="caption" className="queue-group-count">
            {jobs.length} jobs
          </Typography>
        </Box>
        {canDeleteGroup && (
          <Tooltip
            title={
              groupHasKilledOnly
                ? "These jobs will be cleaned up automatically and cannot be deleted"
                : `Delete ${groupName}`
            }
          >
            <IconButton
              disabled={groupHasKilledOnly}
              onClick={() => {
                confirm({
                  title: "Delete Job Group",
                  description: `Are you sure you want to delete all ${jobs.length} jobs in "${groupName}"?`,
                  confirmationButtonProps: { color: "primary", variant: "contained" },
                  cancellationButtonProps: { color: "secondary", variant: "contained" },
                  titleProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
                  contentProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
                  dialogActionsProps: { sx: { backgroundColor: "var(--st-gray-90)" } },
                }).then(() => {
                  jobs.forEach((job) => {
                    if (job.status !== "Killed") {
                      deleteJob(job.key, true);
                    }
                  });
                  if (jobs.some((job) => job.key === activeJob?.key)) {
                    setActiveJob(null);
                  }
                });
              }}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
        )}
      </div>
      <div className="queue-group-body">
        <div className="queue-group-meta-row">
          <Box className="queue-group-details">
            <Typography variant="body2">
              Years: <b>{yearRangeLabel}</b>
            </Typography>
            <Typography variant="body2">
              Started: <b>{startedLabel}</b>
            </Typography>
            {submitter?.name ? (
              <Tooltip title={`Name: ${submitter.name}\nEmail: ${submitter.email || ""}`}>
                <Typography variant="body2" className="queue-group-submitter">
                  <img src={submitter.picture} alt="" className="queue-group-submitter-avatar" />
                  <b>{submitter.name}</b>
                </Typography>
              </Tooltip>
            ) : (
              <Typography variant="body2">
                Submitted by: <b>Multiple users</b>
              </Typography>
            )}
          </Box>
          <IconButton
            className="queue-group-expand"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse group" : "Expand group"}
            onClick={onToggle}
          >
            <ExpandMoreIcon
              sx={{
                color: "var(--st-gray-30)",
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.2s",
              }}
            />
          </IconButton>
        </div>
        <Tooltip title={progressTooltip}>
          <Box className="queue-group-progress">
            <Box sx={{ width: "100%", mr: 1 }}>
              <LinearProgress value={percentComplete} variant="determinate" />
            </Box>
            <Box sx={{ minWidth: 35 }}>
              <Typography variant="body2" color="text.secondary">
                {percentComplete}%
              </Typography>
            </Box>
          </Box>
        </Tooltip>
        <Box className="queue-group-actions">
          <Button
            size="small"
            variant="contained"
            color="secondary"
            onClick={handleLocate}
            startIcon={<MapIcon fontSize="inherit" />}
          >
            Locate
          </Button>
          <Button
            size="small"
            variant="contained"
            color="secondary"
            disabled={isDownloadDisabled || isDownloading}
            onClick={(event) => {
              setDownloadAnchorEl(event.currentTarget);
            }}
            startIcon={isDownloading ? <CircularProgress size={14} /> : <DownloadIcon fontSize="inherit" />}
          >
            Download
          </Button>
        </Box>
      </div>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <div className="queue-group-members">
          {jobs.map((job) => (
            <div key={job.key} className="queue-group-job">
              <JobQueueItem job={job} inGroupMember onOpenLogs={() => onOpenLogs(job.key)} />
            </div>
          ))}
        </div>
      </Collapse>
      <Menu
        anchorEl={downloadAnchorEl}
        open={downloadMenuOpen}
        onClose={() => setDownloadAnchorEl(null)}
        sx={{ "& .MuiList-root": { backgroundColor: "var(--st-gray-80)" } }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ marginLeft: "8px", marginBottom: "4px", backgroundColor: "var(--st-gray-80)" }}
        >
          Report
        </Typography>
        <Divider />
        <MenuItem
          sx={{ backgroundColor: "var(--st-gray-80)" }}
          disableRipple
          disabled={isDownloading}
          onClick={() => {
            downloadJobGroup(jobs, groupName, "metric");
            setDownloadAnchorEl(null);
          }}
        >
          {isDownloading && <CircularProgress size={16} sx={{ marginRight: "8px" }} />}
          All Reports (mm/month)
        </MenuItem>
        <MenuItem
          sx={{ backgroundColor: "var(--st-gray-80)" }}
          disableRipple
          disabled={isDownloading}
          onClick={() => {
            downloadJobGroup(jobs, groupName, "imperial");
            setDownloadAnchorEl(null);
          }}
        >
          {isDownloading && <CircularProgress size={16} sx={{ marginRight: "8px" }} />}
          All Reports (in/month)
        </MenuItem>
        <MenuItem
          sx={{ backgroundColor: "var(--st-gray-80)" }}
          disableRipple
          disabled={isDownloading}
          onClick={() => {
            downloadJobGroup(jobs, groupName, "acre-feet");
            setDownloadAnchorEl(null);
          }}
        >
          {isDownloading && <CircularProgress size={16} sx={{ marginRight: "8px" }} />}
          All Reports (acre-feet/month)
        </MenuItem>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ marginLeft: "8px", marginBottom: "4px", backgroundColor: "var(--st-gray-80)" }}
        >
          Map Data
        </Typography>
        <Divider />
        <MenuItem
          sx={{ backgroundColor: "var(--st-gray-80)" }}
          disableRipple
          disabled={isDownloading}
          onClick={() => {
            downloadJobGroupGeojson(jobs, groupName);
            setDownloadAnchorEl(null);
          }}
        >
          {isDownloading && <CircularProgress size={16} sx={{ marginRight: "8px" }} />}
          GeoJSON
        </MenuItem>
      </Menu>
    </div>
  );
};

export default JobQueueGroup;
