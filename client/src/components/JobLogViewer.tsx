import { Box, IconButton, Modal, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import FileDownloadSharpIcon from "@mui/icons-material/FileDownloadSharp";
import FileDownloadOffSharpIcon from "@mui/icons-material/FileDownloadOffSharp";
import { LazyLog, ScrollFollow } from "@melloware/react-logviewer";
import { useEffect, useMemo, useState } from "react";
import useStore, { JobStatus } from "../utils/store";

interface JobLogViewerProps {
  open: boolean;
  jobKey: string;
  jobName?: string;
  onClose: () => void;
}

const JobLogViewer = ({ open, jobKey, jobName, onClose }: JobLogViewerProps) => {
  const fetchJobLogs = useStore((state) => state.fetchJobLogs);
  const fetchJobStatus = useStore((state) => state.fetchJobStatus);
  const jobStatuses = useStore((state) => state.jobStatuses);

  const [jobLogs, setJobLogs] = useState<Record<string, { timestamp: number; logs: string }>>({});
  const [pauseLogs, setPauseLogs] = useState(false);
  const [lastFetchedLogs, setLastFetchedLogs] = useState(0);

  const jobStatus = useMemo((): JobStatus => {
    const status = jobStatuses[jobKey];
    if (status) {
      return status;
    }
    return {
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
  }, [jobKey, jobStatuses]);

  const activeLog = jobLogs[jobKey];

  useEffect(() => {
    setLastFetchedLogs(0);
    setPauseLogs(false);
  }, [jobKey]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const fetchLogs = async () => {
      if (!jobKey || Date.now() - lastFetchedLogs <= 2000) {
        return;
      }

      if (jobName) {
        const jobStatusRequest = fetchJobStatus(jobKey, jobName);
        if (jobStatusRequest) {
          jobStatusRequest
            .then(() => {
              setLastFetchedLogs(Date.now());
            })
            .catch((error) => {
              console.error("Error fetching job status", error);
            });
        }
      }

      const jobLogsRequest = fetchJobLogs(jobKey);
      if (!jobLogsRequest) {
        return;
      }

      jobLogsRequest.then((logs) => {
        setJobLogs((prev) => {
          const existingLog = prev[jobKey];
          if (existingLog && existingLog.logs === logs.logs) {
            return prev;
          }

          const currentLog = { timestamp: Date.now(), logs: "No Logs Available" };
          if (logs?.logs) {
            currentLog.logs = logs.logs;
          }

          return { ...prev, [jobKey]: currentLog };
        });
      });
    };

    fetchLogs();
    const interval = setInterval(() => {
      if (!pauseLogs) {
        fetchLogs();
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [open, jobKey, jobName, lastFetchedLogs, pauseLogs, fetchJobStatus, fetchJobLogs]);

  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "50vw",
          maxWidth: "1000px",
          height: "50vh",
          maxHeight: "500px",
          bgcolor: "var(--st-gray-90)",
          boxShadow: 24,
          padding: "8px 16px",
          borderRadius: "4px",
        }}
      >
        <Typography variant="h6" component="h2" sx={{ display: "flex", alignItems: "center" }}>
          {jobName || "Job"} Logs
          <IconButton onClick={onClose} sx={{ marginLeft: "auto" }}>
            <CloseIcon />
          </IconButton>
        </Typography>
        <div style={{ height: "calc(100% - 64px)" }}>
          <ScrollFollow key={jobKey} startFollowing render={({ follow, onScroll }) => (
            <LazyLog
              follow={follow}
              onScroll={onScroll}
              style={{
                backgroundColor: "var(--st-gray-100)",
                color: "var(--st-gray-10)",
              }}
              text={activeLog?.logs || "Loading logs..."}
              enableHotKeys={true}
              enableSearch={true}
              selectableLines={true}
              extraLines={1}
            />
          )} />
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: "5px", gap: "8px" }}>
          {!pauseLogs ? (
            <FileDownloadSharpIcon
              style={{
                color: "var(--st-gray-50)",
                fontSize: "16px",
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
              }}
              onClick={() => setPauseLogs(true)}
            />
          ) : (
            <FileDownloadOffSharpIcon
              style={{
                color: "var(--st-gray-50)",
                fontSize: "16px",
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
              }}
              onClick={() => setPauseLogs(false)}
            />
          )}

          <div style={{ color: "var(--st-gray-50)", fontSize: "14px" }}>Files Generated: {jobStatus.fileCount}</div>
          <div
            style={{
              display: "flex",
              marginLeft: "auto",
              color: "var(--st-gray-50)",
              fontSize: "14px",
            }}
          >
            Last Updated: {activeLog?.timestamp ? new Date(activeLog.timestamp).toLocaleTimeString() : "Never"}
          </div>
        </div>
      </Box>
    </Modal>
  );
};

export default JobLogViewer;
