import { Box, Button, CircularProgress, IconButton, LinearProgress, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PauseIcon from "@mui/icons-material/Pause";
import PlayIcon from "@mui/icons-material/PlayArrow";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import FileTextIcon from "@mui/icons-material/Description";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import StatusIcon from "./StatusIcon";
import { JobLogWarningIcon, JobLogWarningsModal, useJobLogWarnings } from "./JobLogWarnings";

import { useConfirm } from "material-ui-confirm";
import useStore, { JobStatus } from "../utils/store";
import { useEffect, useMemo, useState } from "react";
import Divider from "@mui/material/Divider";

import { formatElapsedTime } from "../utils/helpers";
import useCurrentJobStore from "../utils/currentJobStore";
import DefaultReportMenuItems from "./DefaultReportMenuItems";
import RenameJobDialog from "./RenameJobDialog";
import { QueueJob, isCompactQueueJob } from "../utils/jobGroups";

const JobProgressBar = ({ status }: { status: JobStatus }) => {
  const estimatedPercentComplete = Math.max(Math.min(Math.round(status.estimatedPercentComplete * 1000) / 10, 100), 0);

  let tooltipText = `Status: ${status.status || "N/A"}\nYears Processed: ${status.currentYear}/${status.totalYears
    }\nEstimated Percent Complete: ${estimatedPercentComplete}%`;

  if (status.timeRemaining > 0) {
    tooltipText += `\nEstimated Time Remaining: ${formatElapsedTime(status.timeRemaining)}`;
  }

  return (
    <Tooltip title={tooltipText}>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <Box sx={{ width: "100%", mr: 1 }}>
          <LinearProgress value={estimatedPercentComplete} variant="determinate" />
        </Box>
        <Box sx={{ minWidth: 35 }}>
          <Typography variant="body2" color="text.secondary">{`${estimatedPercentComplete}%`}</Typography>
        </Box>
      </Box>
    </Tooltip>
  );
};

const MENU_ITEM_SX = { backgroundColor: "var(--st-gray-80)" } as const;

const JobQueueItem = ({
  job,
  onOpenLogs,
  inGroupMember = false,
}: {
  job: QueueJob;
  onOpenLogs: () => void;
  inGroupMember?: boolean;
}) => {
  const confirm = useConfirm();

  const activeJob = useStore((state) => state.activeJob);
  const setActiveJob = useStore((state) => state.setActiveJob);

  const deleteJob = useStore((state) => state.deleteJob);
  const loadJob = useStore((state) => state.loadJob);
  const downloadAllGeotiffs = useCurrentJobStore((state) => state.downloadAllGeotiffs);
  const bulkGeotiffDownloadJobId = useCurrentJobStore((state) => state.bulkGeotiffDownloadJobId);
  const isBulkGeotiffDownloading = bulkGeotiffDownloadJobId === job.key;
  const downloadGeojson = useCurrentJobStore((state) => state.downloadGeojson);
  const restartJob = useStore((state) => state.restartJob);
  const pauseJob = useStore((state) => state.pauseJob);
  const resumeJob = useStore((state) => state.resumeJob);
  const [jobStatuses, fetchJobStatus] = useStore((state) => [state.jobStatuses, state.fetchJobStatus]);

  const currentUserInfo = useStore((state) => state.userInfo);
  const canApproveJobs = useMemo(() => currentUserInfo?.permissions?.includes("write:jobs"), [currentUserInfo]);
  const canDeleteJobs = useMemo(() => {
    const hasPermission = currentUserInfo?.permissions?.includes("write:jobs");
    const isCurrentUserJobOwner = job?.user?.sub === currentUserInfo?.sub;
    return hasPermission || isCurrentUserJobOwner;
  }, [currentUserInfo, job]);
  const canRestartJobs = useMemo(() => currentUserInfo?.permissions?.includes("write:jobs"), [currentUserInfo]);
  const canPauseJobs = useMemo(() => currentUserInfo?.permissions?.includes("write:jobs"), [currentUserInfo]);
  const isAdmin = useMemo(() => currentUserInfo?.permissions?.includes("write:admin"), [currentUserInfo]);
  const canRenameJob = useMemo(() => canDeleteJobs && !["In Progress", "Pending"].includes(job.status), [canDeleteJobs, job.status]);

  const isDownloadDisabled = useMemo(() => {
    return ["Pending", "In Progress", "WaitingApproval"].includes(job.status);
  }, [job.status]);

  const showInlineLogsButton = job.status === "Failed" || job.status === "In Progress";
  const showProgressBar = job.status !== "Complete";
  const isCompact = isCompactQueueJob(job);

  const approveJob = useStore((state) => state.approveJob);

  const [downloadAnchorEl, setDownloadAnchorEl] = useState<null | HTMLElement>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const [actionsAnchorEl, setActionsAnchorEl] = useState<null | HTMLElement>(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);

  const jobStatus = useMemo(() => {
    let jobStatus: JobStatus = jobStatuses[job.key];
    if (!jobStatus) {
      jobStatus = {
        status: "",
        found: true,
        paused: false,
        currentYear: 0,
        latestDate: "",
        totalYears: 0,
        fileCount: 0,
        estimatedPercentComplete: 0,
        timeRemaining: 0,
      };
    }

    return jobStatus;
  }, [job.key, jobStatuses]);

  const jobStatusColor = useMemo(() => {
    switch (job.status) {
      case "In Progress":
        return "#50AC34";
      case "Pending":
        return "#ffeb3b";
      default:
        return "var(--st-gray-10)";
    }
  }, [job.status]);

  useEffect(() => {
    fetchJobStatus(job.key, job.name);
    const interval = setInterval(() => {
      fetchJobStatus(job.key, job.name);
    }, 5000);

    return () => clearInterval(interval);
  }, [job.key, job.name, fetchJobStatus]);

  const closeActionsMenu = () => {
    setActionsAnchorEl(null);
    setActionsMenuOpen(false);
  };

  const runAction = (action: () => void) => {
    closeActionsMenu();
    action();
  };

  const handleDelete = () => {
    confirm({
      title: "Delete Job",
      description: `Are you sure you want to delete the job "${job.name}"?`,
      confirmationButtonProps: { color: "primary", variant: "contained" },
      cancellationButtonProps: { color: "secondary", variant: "contained" },
      titleProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
      contentProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
      dialogActionsProps: { sx: { backgroundColor: "var(--st-gray-90)" } },
    }).then(() => {
      deleteJob(job.key, true);
      if (job.key === activeJob?.key) {
        setActiveJob(null);
      }
    });
  };

  const handleRerun = () => {
    confirm({
      title: "Rerun Job",
      description: `Are you sure you want to rerun the job "${job.name}"?`,
      confirmationButtonProps: { color: "primary", variant: "contained" },
      cancellationButtonProps: { color: "secondary", variant: "contained" },
      titleProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
      contentProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
      dialogActionsProps: { sx: { backgroundColor: "var(--st-gray-90)" } },
    }).then(() => {
      restartJob(job.key);
    });
  };

  const logWarnings = useJobLogWarnings(job.key, job.status);
  const [warningsModalOpen, setWarningsModalOpen] = useState(false);
  const openWarningsModal = () => setWarningsModalOpen(true);

  return (
    <div
      className={`queue-item${inGroupMember ? " queue-item--group-member" : ""}${isCompact ? " queue-item--compact" : ""}`}
      style={isCompact ? undefined : { height: "100%", justifyContent: "space-between" }}
    >
      <div className="item-header">
        <Typography
          variant="h6"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            minWidth: 0,
          }}
        >
          <StatusIcon status={job.status} />
          <JobLogWarningIcon warnings={logWarnings} jobName={job.name} onOpenModal={openWarningsModal} />
          <Tooltip title={`${job.name}\nStatus: ${job.status}`}>
            <span style={{ maxWidth: "215px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "pre" }}>
              {job.name}
            </span>
          </Tooltip>
        </Typography>
        <IconButton
          size="small"
          aria-label="Job actions"
          onClick={(event) => {
            setActionsAnchorEl(event.currentTarget);
            setActionsMenuOpen(true);
          }}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </div>
      <div className="item-body" style={isCompact ? undefined : { flex: 1, justifyContent: "space-around" }}>
        {job.status === "WaitingApproval" && (
          <Button
            disabled={!canApproveJobs}
            variant="contained"
            size="small"
            style={{ marginBottom: "8px" }}
            onClick={() => {
              approveJob(job.key);
            }}
          >
            {canApproveJobs ? "Approve Job" : "Waiting Approval..."}
          </Button>
        )}
        {["In Progress", "Pending"].includes(job.status) && (
          <Tooltip title="Pause the job at the current month">
            <Button
              disabled={job.status !== "In Progress" || !canPauseJobs}
              variant="contained"
              color="secondary"
              size="small"
              style={{ marginBottom: "8px" }}
              onClick={() => {
                pauseJob(job.key);
              }}
            >
              <IconButton sx={{ padding: 0 }}>
                <PauseIcon color={job.status !== "In Progress" || !canPauseJobs ? "disabled" : undefined} />
              </IconButton>
              Pause
            </Button>
          </Tooltip>
        )}
        {job.status === "Paused" && canPauseJobs && (
          <Tooltip
            title={
              jobStatus.paused || job.paused_year
                ? "Resume" + (job?.paused_year ? ` from ${job.paused_year}` : "")
                : "Job will pause after the current year is processed"
            }
          >
            <Button
              variant="contained"
              size="small"
              color={jobStatus.paused ? "primary" : "secondary"}
              style={{ marginBottom: "8px" }}
              onClick={() => {
                resumeJob(job.key);
              }}
            >
              <IconButton sx={{ padding: 0 }}>
                <PlayIcon />
              </IconButton>
              {jobStatus.paused || job.paused_year
                ? "Resume" + (job?.paused_year ? ` from ${job.paused_year}` : "")
                : "Resume (Pausing...)"}
            </Button>
          </Tooltip>
        )}
        <Typography variant="body2">
          Years:{" "}
          <b>
            {job.start_year} - {job.end_year}
          </b>
        </Typography>
        {!job.started && (
          <Typography variant="body2">
            Submitted: <b>{job.submitted || "Not started yet"}</b>
          </Typography>
        )}
        <Typography variant="body2">
          Started: <b>{job.started || "Not started yet"}</b>
        </Typography>
        {["In Progress", "Paused", "Pending", "WaitingApproval"].includes(job.status) && (
          <Typography variant="body2" sx={{ display: "flex", alignItems: "center" }}>
            Processing Date:{" "}
            <b style={{ display: "flex", marginLeft: "4px" }}>
              {jobStatus?.latestDate || job?.last_generated_year || <MoreHorizIcon />}
            </b>
          </Typography>
        )}
        {job.started && job.ended && (
          <Typography variant="body2" sx={{ display: "flex", alignItems: "center" }}>
            Finished: {job.ended ? <b style={{ display: "flex", marginLeft: "4px" }}>{job.ended}</b> : <MoreHorizIcon />}
          </Typography>
        )}
        {job.ended && job.started && (
          <Typography variant="body2">
            Time Elapsed: <b>{job.timeElapsed}</b>
          </Typography>
        )}
        <Tooltip title={job.status_msg}>
          <Typography
            variant="body2"
            sx={{
              whiteSpace: "pre",
              overflow: "hidden",
              textOverflow: "ellipsis",
              width: "275px",
            }}
          >
            Status: <b style={{ color: jobStatusColor }}>{job.status_msg || job.status}</b>
          </Typography>
        </Tooltip>
        <JobLogWarningsModal
          open={warningsModalOpen}
          onClose={() => setWarningsModalOpen(false)}
          warnings={logWarnings}
          jobName={job.name}
        />
        {job?.user?.name && (
          <Tooltip title={`Name: ${job.user.name}\nEmail: ${job.user.email}`}>
            <Typography variant="body2" style={{ marginTop: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <img src={job?.user?.picture} alt="user" style={{ width: "20px", height: "20px", borderRadius: "50%" }} />
                <b style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "pre" }}>{job?.user?.name}</b>
              </div>
            </Typography>
          </Tooltip>
        )}
        {showProgressBar && (
          <div>
            <JobProgressBar status={jobStatus} />
          </div>
        )}
      </div>
      <div className="action-buttons">
        <Button
          variant="contained"
          color="secondary"
          size="small"
          onClick={() => {
            loadJob(job);
          }}
        >
          Locate
        </Button>
        {showInlineLogsButton && (
          <Button
            variant="contained"
            color="secondary"
            size="small"
            onClick={() => {
              onOpenLogs();
            }}
          >
            Logs
          </Button>
        )}
        <span>
          <div style={{ display: "flex", alignItems: "center", padding: 0 }}>
            <Tooltip title={job.status === "Complete" ? "Download Completed Job" : "Download partial job"}>
              <Button
                disabled={isDownloadDisabled}
                variant="contained"
                color="secondary"
                size="small"
                onClick={(evt) => {
                  if (isDownloadDisabled) {
                    return;
                  }

                  setDownloadAnchorEl(evt.currentTarget);
                  setDownloadMenuOpen(true);
                }}
                sx={{
                  padding: "4px 8px",
                }}
              >
                Download
              </Button>
            </Tooltip>
          </div>
          <Menu
            anchorEl={downloadAnchorEl}
            open={downloadMenuOpen}
            onClose={() => setDownloadMenuOpen(false)}
            sx={{
              "& .MuiList-root": {
                backgroundColor: "var(--st-gray-80)",
              },
            }}
          >
            <DefaultReportMenuItems
              jobKey={job.key}
              disabled={isDownloadDisabled}
              onClose={() => setDownloadMenuOpen(false)}
              menuItemSx={MENU_ITEM_SX}
            />
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ marginLeft: "8px", marginBottom: "4px", backgroundColor: "var(--st-gray-80)" }}
            >
              Map Data
            </Typography>
            <Divider />
            <MenuItem
              sx={MENU_ITEM_SX}
              onClick={() => {
                downloadGeojson(job.key, job.name);
                setDownloadMenuOpen(false);
              }}
              disableRipple
            >
              GeoJSON
            </MenuItem>
            <MenuItem
              sx={MENU_ITEM_SX}
              onClick={() => {
                downloadAllGeotiffs(job.key);
                setDownloadMenuOpen(false);
              }}
              disableRipple
            >
              All GeoTIFFs
            </MenuItem>
            <MenuItem
              sx={MENU_ITEM_SX}
              onClick={() => {
                downloadAllGeotiffs(job.key, { clipped: true });
                setDownloadMenuOpen(false);
              }}
              disabled={isBulkGeotiffDownloading}
              disableRipple
            >
              {isBulkGeotiffDownloading && <CircularProgress size={16} sx={{ marginRight: "8px" }} />}
              All GeoTIFFs (clipped)
            </MenuItem>
          </Menu>
        </span>
        {job.status === "Failed" && canRestartJobs && (
          <Tooltip title="Restart job from where it failed">
            <IconButton
              size="small"
              aria-label="Restart job"
              onClick={() => {
                restartJob(job.key);
              }}
              sx={{ padding: "4px", marginLeft: "2px" }}
            >
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </div>

      <Menu
        anchorEl={actionsAnchorEl}
        open={actionsMenuOpen}
        onClose={closeActionsMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        sx={{ "& .MuiList-root": { backgroundColor: "var(--st-gray-80)" } }}
      >
        <MenuItem sx={MENU_ITEM_SX} disableRipple onClick={() => runAction(onOpenLogs)}>
          <FileTextIcon fontSize="small" sx={{ marginRight: "12px" }} />
          Logs
        </MenuItem>
        {canRenameJob && (
          <MenuItem
            sx={MENU_ITEM_SX}
            disableRipple
            onClick={() => {
              closeActionsMenu();
              setRenameDialogOpen(true);
            }}
          >
            <DriveFileRenameOutlineIcon fontSize="small" sx={{ marginRight: "12px" }} />
            Rename Job
          </MenuItem>
        )}
        {isAdmin && job.status !== "In Progress" && (
          <MenuItem sx={MENU_ITEM_SX} disableRipple onClick={() => runAction(handleRerun)}>
            <RestartAltIcon fontSize="small" sx={{ marginRight: "12px" }} />
            Rerun Job
          </MenuItem>
        )}
        {canDeleteJobs && (
          <MenuItem
            sx={MENU_ITEM_SX}
            disableRipple
            disabled={job.status === "Killed"}
            onClick={() => runAction(handleDelete)}
          >
            <DeleteOutlineIcon fontSize="small" sx={{ marginRight: "12px" }} />
            Delete Job
          </MenuItem>
        )}
      </Menu>

      <RenameJobDialog job={job} open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)} />
    </div>
  );
};

export default JobQueueItem;
