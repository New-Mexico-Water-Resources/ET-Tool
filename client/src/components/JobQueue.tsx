import {
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Modal,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import useStore, { JobStatus } from "../utils/store";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LazyLog } from "@melloware/react-logviewer";
import FileDownloadSharpIcon from "@mui/icons-material/FileDownloadSharp";
import FileDownloadOffSharpIcon from "@mui/icons-material/FileDownloadOffSharp";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";

import "../scss/JobQueue.scss";
import JobQueueItem from "./JobQueueItem";
import { useConfirm } from "material-ui-confirm";

import { FixedSizeList as List, ListChildComponentProps } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import dayjs from "dayjs";

const JobQueue = () => {
  const queue = useStore((state) => state.queue);
  const backlog = useStore((state) => state.backlog);
  const isBacklogOpen = useStore((state) => state.isBacklogOpen);
  const isQueueOpen = useStore((state) => state.isQueueOpen);
  const clearPendingJobs = useStore((state) => state.clearPendingJobs);
  const fetchJobLogs = useStore((state) => state.fetchJobLogs);

  const [activeStatusFilters, setActiveStatusFilters] = useState<string[]>([]);
  const [activeAuthorFilters, setActiveAuthorFilters] = useState<string[]>([]);

  const backlogDateFilterOptions = ["Last Day", "Last Week", "Last Month", "Last Year", "All Time"];

  const [backlogDateFilter, setBacklogDateFilter] = useStore((state) => [
    state.backlogDateFilter,
    state.setBacklogDateFilter,
  ]);

  const backlogCutoffDate = useMemo(() => {
    switch (backlogDateFilter) {
      case "Last Day":
        return dayjs().subtract(1, "day").toDate();
      case "Last Week":
        return dayjs().subtract(1, "week").toDate();
      case "Last Month":
        return dayjs().subtract(1, "month").toDate();
      case "Last Year":
        return dayjs().subtract(1, "year").toDate();
      case "All Time":
      default:
        return null;
    }
  }, [backlogDateFilter]);

  const [jobLogs, setJobLogs] = useState<Record<string, { timestamp: number; logs: string }>>({});
  const [activeJobLogKey, setActiveJobLogKey] = useState("");
  const [jobLogsOpen, setJobLogsOpen] = useState(false);

  const [pauseLogs, setPauseLogs] = useState(false);

  const [sortAscending, setSortAscending] = useStore((state) => [state.sortAscending, state.setSortAscending]);

  const [jobStatuses, fetchJobStatus] = useStore((state) => [state.jobStatuses, state.fetchJobStatus]);
  const jobStatus = useMemo(() => {
    let jobStatus: JobStatus = jobStatuses[activeJobLogKey];
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
  }, [activeJobLogKey, jobStatuses]);

  const confirm = useConfirm();

  const canDeleteJobs = useStore((state) => state.userInfo?.permissions.includes("write:jobs"));

  const pendingJobCount = useMemo(() => {
    return queue.reduce((acc, job) => (["Pending", "WaitingApproval", "Paused"].includes(job.status) ? acc + 1 : acc), 0);
  }, [queue]);

  const viewingJob = useMemo(() => {
    if (!activeJobLogKey) {
      return null;
    }
    let job = queue.find((job) => job.key === activeJobLogKey);
    if (!job) {
      job = backlog.find((job) => job.key === activeJobLogKey);
    }

    return job;
  }, [queue, backlog, activeJobLogKey]);

  const [lastFetchedLogs, setLastFetchedLogs] = useState(0);
  useEffect(() => {
    const fetchLogs = async () => {
      if (activeJobLogKey && jobLogsOpen && Date.now() - lastFetchedLogs > 2000) {
        if (viewingJob?.name) {
          const jobStatusRequest = fetchJobStatus(activeJobLogKey, viewingJob.name);
          if (!jobStatusRequest) {
            return;
          }

          jobStatusRequest
            .then(() => {
              setLastFetchedLogs(Date.now());
            })
            .catch((error) => {
              console.error("Error fetching job status", error);
            });
        }

        const jobLogsRequest = fetchJobLogs(activeJobLogKey);
        if (!jobLogsRequest) {
          return;
        }

        jobLogsRequest.then((logs) => {
          const existingLog = jobLogs[activeJobLogKey];
          if (existingLog && existingLog.logs === logs.logs) {
            return;
          }

          const currentLog = { timestamp: 0, logs: "No Logs Available" };
          if (logs?.logs) {
            currentLog.logs = logs.logs;
          }

          currentLog.timestamp = Date.now();

          setJobLogs({ ...jobLogs, [activeJobLogKey]: currentLog });
        });
      }
    };

    fetchLogs();
    const interval = setInterval(() => {
      if (!pauseLogs) {
        fetchLogs();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeJobLogKey, jobLogsOpen, lastFetchedLogs]);

  const [searchField, setSearchField] = useState("");

  useEffect(() => {
    setSearchField("");
    setActiveAuthorFilters([]);
    setActiveStatusFilters([]);
  }, [isQueueOpen]);

  const filteredItemList = useMemo(() => {
    let items = isBacklogOpen ? backlog : queue;
    if (isBacklogOpen && backlogCutoffDate) {
      items = items.filter(
        (item) => new Date(item?.started || 0) > backlogCutoffDate || new Date(item?.finished || 0) > backlogCutoffDate
      );
    }

    const searchTerm = searchField?.toLowerCase() || "";

    if (activeAuthorFilters.length) {
      items = items.filter((item) => activeAuthorFilters.includes(item.user?.name));
    }

    if (activeStatusFilters.length) {
      items = items.filter((item) => activeStatusFilters.includes(item.status));
    }

    const filteredItems = items.filter((item) => {
      const fields = [
        item?.name?.toLowerCase() || "",
        `${item?.start_year}`,
        `${item?.end_year}`,
        item.user?.name?.toLowerCase(),
        item.user?.email?.toLowerCase(),
        item?.status.toLowerCase(),
      ].filter((field) => field);

      // Name, Start Year, End Year, Creator Name, Creator Email
      return !searchField || fields.some((field) => field.includes(searchTerm));
    });

    filteredItems.sort((a, b) => {
      const aStartedDate = new Date(a.started);
      const bStartedDate = new Date(b.started);
      if (sortAscending) {
        return aStartedDate.getTime() - bStartedDate.getTime();
      } else {
        return bStartedDate.getTime() - aStartedDate.getTime();
      }
    });

    return filteredItems;
  }, [
    queue,
    backlog,
    isBacklogOpen,
    searchField,
    sortAscending,
    activeAuthorFilters,
    activeStatusFilters,
    backlogCutoffDate,
  ]);

  const authors = useMemo(() => {
    const authors = new Set<string>();

    const items = isBacklogOpen ? backlog : queue;
    items.forEach((job) => {
      authors.add(job.user?.name);
    });
    return Array.from(authors);
  }, [queue, backlog, isBacklogOpen]);

  const availableStatusFilters = useMemo(() => {
    const statuses = new Set<string>();

    const items = isBacklogOpen ? backlog : queue;
    items.forEach((job) => {
      statuses.add(job.status);
    });
    return Array.from(statuses);
  }, [queue, backlog, isBacklogOpen]);

  const handleOpenLogs = useCallback(
    (key: string) => {
      setActiveJobLogKey(key);
      setJobLogsOpen(true);
    },
    [setActiveJobLogKey, setJobLogsOpen]
  );

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const job = filteredItemList[index];
      return (
        <div style={style}>
          <JobQueueItem job={job} onOpenLogs={() => handleOpenLogs(job.key)} />
        </div>
      );
    },
    [filteredItemList, handleOpenLogs]
  );
  return (
    <div className={`queue-container ${isQueueOpen || isBacklogOpen ? "open" : "closed"}`}>
      <Modal
        open={jobLogsOpen}
        onClose={() => {
          setJobLogsOpen(false);
        }}
      >
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
            {viewingJob?.name || "Job"} Logs
            <IconButton
              onClick={() => {
                setActiveJobLogKey("");
                setJobLogsOpen(false);
              }}
              sx={{ marginLeft: "auto" }}
            >
              <CloseIcon />
            </IconButton>
          </Typography>
          <div style={{ height: "calc(100% - 64px)" }}>
            <LazyLog
              follow={!pauseLogs}
              style={{
                backgroundColor: "var(--st-gray-100)",
                color: "var(--st-gray-10)",
              }}
              text={jobLogs[activeJobLogKey]?.logs || "Loading logs..."}
              enableHotKeys={true}
              enableSearch={true}
              extraLines={1}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: "5px", gap: "8px" }}>
            {!pauseLogs && (
              <FileDownloadSharpIcon
                style={{
                  color: "var(--st-gray-50)",
                  fontSize: "16px",
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setPauseLogs(!pauseLogs);
                }}
              />
            )}
            {pauseLogs && (
              <FileDownloadOffSharpIcon
                style={{
                  color: "var(--st-gray-50)",
                  fontSize: "16px",
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                }}
                onClick={() => {
                  setPauseLogs(!pauseLogs);
                }}
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
              Last Updated:{" "}
              {jobLogs[activeJobLogKey]?.timestamp
                ? new Date(jobLogs[activeJobLogKey].timestamp).toLocaleTimeString()
                : "Never"}
            </div>
          </div>
        </Box>
      </Modal>
      <Typography
        variant="h5"
        style={{ color: "var(--st-gray-30)", padding: "8px 16px", display: "flex", alignItems: "center" }}
      >
        {isBacklogOpen ? "Completed" : "In Progress"}

        {!isBacklogOpen && canDeleteJobs && (
          <Button
            variant="text"
            disabled={!pendingJobCount}
            sx={{ marginLeft: "auto" }}
            onClick={() => {
              confirm({
                title: "Clear Pending Jobs",
                description: `Are you sure you want to clear ${pendingJobCount} jobs from the queue?`,
                confirmationButtonProps: { color: "primary", variant: "contained" },
                cancellationButtonProps: { color: "secondary", variant: "contained" },
                titleProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
                contentProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
                dialogActionsProps: { sx: { backgroundColor: "var(--st-gray-90)" } },
              }).then(() => {
                clearPendingJobs();
              });
            }}
          >
            Clear Pending
          </Button>
        )}

        {isBacklogOpen && (
          <ToggleButtonGroup
            sx={{ marginLeft: "auto" }}
            value={sortAscending ? "asc" : "desc"}
            exclusive
            onChange={(_, sortMode) => setSortAscending(sortMode === "asc")}
          >
            <ToggleButton
              size="small"
              value="asc"
              aria-label="Ascending"
              sx={sortAscending ? { backgroundColor: "#334155 !important" } : {}}
            >
              <ArrowUpwardIcon />
            </ToggleButton>
            <ToggleButton
              size="small"
              value="desc"
              aria-label="Descending"
              sx={!sortAscending ? { backgroundColor: "#334155 !important" } : {}}
            >
              <ArrowDownwardIcon />
            </ToggleButton>
          </ToggleButtonGroup>
        )}
      </Typography>
      <div
        style={{ display: "flex", flexDirection: "column", visibility: isQueueOpen || isBacklogOpen ? "visible" : "hidden" }}
      >
        <div className="search-bar">
          <input
            style={{ height: "36px" }}
            type="text"
            placeholder="Search..."
            className="search-input"
            value={searchField}
            onChange={(e) => setSearchField(e.target.value)}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            justifyContent: "space-between",
            padding: "8px",
            paddingTop: 0,
            paddingBottom: isBacklogOpen ? 0 : "8px",
            borderBottom: isQueueOpen ? "1px solid var(--st-gray-80)" : "",
            gap: "8px",
          }}
        >
          <FormControl size="small" sx={{ flex: 1 }} className="author-filter">
            <InputLabel size="small" id="author-filter-label">
              Author
            </InputLabel>
            <Select
              size="small"
              labelId="author-filter-label"
              label="Author"
              multiple
              value={activeAuthorFilters}
              onChange={(evt) => {
                setActiveAuthorFilters(evt.target.value as string[]);
              }}
            >
              {authors.map((name) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel size="small" id="status-filter-label">
              Status
            </InputLabel>
            <Select
              size="small"
              labelId="status-filter-label"
              label="Status"
              multiple
              value={activeStatusFilters}
              onChange={(evt) => {
                setActiveStatusFilters(evt.target.value as string[]);
              }}
            >
              {availableStatusFilters.map((name) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>
        {isBacklogOpen && (
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-between",
              padding: "8px",
              paddingTop: 0,
              borderBottom: "1px solid var(--st-gray-80)",
              gap: "8px",
              marginTop: "12px",
            }}
          >
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel size="small" id="author-filter-label">
                Date Submitted
              </InputLabel>
              <Select
                size="small"
                labelId="author-filter-label"
                label="Date Submitted"
                value={backlogDateFilter}
                onChange={(evt) => {
                  setBacklogDateFilter(evt.target.value as string);
                }}
              >
                {backlogDateFilterOptions.map((name) => (
                  <MenuItem key={name} value={name}>
                    {name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
        )}
      </div>
      <div className="queue-list">
        <AutoSizer>
          {({ height, width }) => (
            <List height={height} itemCount={filteredItemList.length} itemSize={300} width={width}>
              {Row}
            </List>
          )}
        </AutoSizer>
      </div>
    </div>
  );
};

export default JobQueue;
