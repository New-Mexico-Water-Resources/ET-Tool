import { Button, FormControl, InputLabel, MenuItem, Select, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import useStore from "../utils/store";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";

import "../scss/JobQueue.scss";
import JobQueueItem from "./JobQueueItem";
import JobQueueGroup from "./JobQueueGroup";
import JobLogViewer from "./JobLogViewer";
import { useConfirm } from "material-ui-confirm";

import { VariableSizeList as List, ListChildComponentProps } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import dayjs from "dayjs";
import {
  QueueDisplayItem,
  QueueJob,
  buildQueueDisplayItems,
  getQueueDisplayItemHeight,
} from "../utils/jobGroups";

const JobQueue = () => {
  const queue = useStore((state) => state.queue);
  const backlog = useStore((state) => state.backlog);
  const isBacklogOpen = useStore((state) => state.isBacklogOpen);
  const isQueueOpen = useStore((state) => state.isQueueOpen);
  const clearPendingJobs = useStore((state) => state.clearPendingJobs);

  const [activeStatusFilters, setActiveStatusFilters] = useState<string[]>([]);
  const [activeAuthorFilters, setActiveAuthorFilters] = useState<string[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

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

  const [activeJobLogKey, setActiveJobLogKey] = useState("");
  const [jobLogsOpen, setJobLogsOpen] = useState(false);

  const [sortAscending, setSortAscending] = useStore((state) => [state.sortAscending, state.setSortAscending]);

  const confirm = useConfirm();
  const listRef = useRef<List>(null);

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

  const [searchField, setSearchField] = useState("");

  useEffect(() => {
    setSearchField("");
    setActiveAuthorFilters([]);
    setActiveStatusFilters([]);
    setExpandedGroupIds(new Set());
  }, [isQueueOpen, isBacklogOpen]);

  const filteredItemList = useMemo(() => {
    let items: QueueJob[] = isBacklogOpen ? backlog : queue;
    if (isBacklogOpen && backlogCutoffDate) {
      items = items.filter(
        (item) => new Date(item?.started || 0) > backlogCutoffDate || new Date(item?.finished || 0) > backlogCutoffDate
      );
    }

    const searchTerm = searchField?.toLowerCase() || "";

    if (activeAuthorFilters.length) {
      items = items.filter((item) => item.user?.name && activeAuthorFilters.includes(item.user.name));
    }

    if (activeStatusFilters.length) {
      items = items.filter((item) => activeStatusFilters.includes(item.status));
    }

    const filteredItems = items.filter((item) => {
      const fields = [
        item?.name?.toLowerCase() || "",
        item?.group_name?.toLowerCase() || "",
        `${item?.start_year}`,
        `${item?.end_year}`,
        item.user?.name?.toLowerCase(),
        item.user?.email?.toLowerCase(),
        item?.status.toLowerCase(),
      ].filter((field): field is string => Boolean(field));

      return !searchField || fields.some((field) => field.includes(searchTerm));
    });

    filteredItems.sort((a, b) => {
      const aStartedDate = new Date(a.started || 0);
      const bStartedDate = new Date(b.started || 0);
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

  const displayItems = useMemo(() => buildQueueDisplayItems(filteredItemList), [filteredItemList]);

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

  const handleOpenLogs = useCallback((key: string) => {
    setActiveJobLogKey(key);
    setJobLogsOpen(true);
  }, []);

  const toggleGroupExpanded = useCallback((groupId: string) => {
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const getItemSize = useCallback(
    (index: number) => getQueueDisplayItemHeight(displayItems[index], expandedGroupIds),
    [displayItems, expandedGroupIds]
  );

  useEffect(() => {
    listRef.current?.resetAfterIndex(0);
  }, [displayItems, expandedGroupIds]);

  const Row = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const item: QueueDisplayItem = displayItems[index];

      if (item.type === "group") {
        return (
          <div style={style}>
            <JobQueueGroup
              jobs={item.jobs}
              groupName={item.groupName}
              expanded={expandedGroupIds.has(item.groupId)}
              onToggle={() => toggleGroupExpanded(item.groupId)}
              onOpenLogs={handleOpenLogs}
            />
          </div>
        );
      }

      return (
        <div style={style}>
          <JobQueueItem job={item.job} onOpenLogs={() => handleOpenLogs(item.job.key)} />
        </div>
      );
    },
    [displayItems, expandedGroupIds, handleOpenLogs, toggleGroupExpanded]
  );

  return (
    <div className={`queue-container ${isQueueOpen || isBacklogOpen ? "open" : "closed"}`}>
      <JobLogViewer
        open={jobLogsOpen}
        jobKey={activeJobLogKey}
        jobName={viewingJob?.name}
        onClose={() => {
          setActiveJobLogKey("");
          setJobLogsOpen(false);
        }}
      />
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
            <List
              ref={listRef}
              height={height}
              itemCount={displayItems.length}
              itemSize={getItemSize}
              width={width}
            >
              {Row}
            </List>
          )}
        </AutoSizer>
      </div>
    </div>
  );
};

export default JobQueue;
