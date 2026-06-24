import {
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import useStore from "../utils/store";
import { TransitionEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";

import "../scss/JobQueue.scss";
import JobQueueItem from "./JobQueueItem";
import JobQueueGroup from "./JobQueueGroup";
import JobLogViewer from "./JobLogViewer";
import JobQueueTableModal from "./JobQueueTableModal";
import { useConfirm } from "material-ui-confirm";

import { VariableSizeList as List, ListChildComponentProps } from "react-window";
import AutoSizer from "react-virtualized-auto-sizer";
import { QueueDisplayItem, buildQueueDisplayItems, getQueueDisplayItemHeight } from "../utils/jobGroups";
import {
  BACKLOG_DATE_FILTER_OPTIONS,
  BacklogDateFilter,
  filterQueueJobs,
  getBacklogCutoffDate,
} from "../utils/jobQueueFilters";

const JobQueue = () => {
  const queue = useStore((state) => state.queue);
  const backlog = useStore((state) => state.backlog);
  const isBacklogOpen = useStore((state) => state.isBacklogOpen);
  const isQueueOpen = useStore((state) => state.isQueueOpen);
  const clearPendingJobs = useStore((state) => state.clearPendingJobs);
  const showUploadDialog = useStore((state) => state.showUploadDialog);
  const activeJob = useStore((state) => state.activeJob);
  const activeJobGroup = useStore((state) => state.activeJobGroup);
  const multipolygons = useStore((state) => state.multipolygons);

  const [activeStatusFilters, setActiveStatusFilters] = useState<string[]>([]);
  const [activeAuthorFilters, setActiveAuthorFilters] = useState<string[]>([]);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());

  const [backlogDateFilter, setBacklogDateFilter] = useStore((state) => [
    state.backlogDateFilter,
    state.setBacklogDateFilter,
  ]);

  const [activeJobLogKey, setActiveJobLogKey] = useState("");
  const [jobLogsOpen, setJobLogsOpen] = useState(false);
  const [tableViewOpen, setTableViewOpen] = useState(false);
  const [tableWidthExpanded, setTableWidthExpanded] = useState(false);

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
    setTableViewOpen(false);
    setTableWidthExpanded(false);
  }, [isQueueOpen, isBacklogOpen]);

  const openTableView = useCallback(() => {
    setTableViewOpen(true);
    requestAnimationFrame(() => setTableWidthExpanded(true));
  }, []);

  const closeTableView = useCallback(() => {
    setTableWidthExpanded(false);
  }, []);

  const handleQueueWidthTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLDivElement>) => {
      if (event.propertyName !== "width" || event.currentTarget !== event.target) {
        return;
      }
      if (!tableWidthExpanded) {
        setTableViewOpen(false);
      }
    },
    [tableWidthExpanded]
  );

  const filteredItemList = useMemo(() => {
    const sourceJobs = isBacklogOpen ? backlog : queue;
    const backlogCutoffDate = isBacklogOpen
      ? getBacklogCutoffDate(backlogDateFilter as BacklogDateFilter, null)
      : null;

    return filterQueueJobs(
      sourceJobs,
      {
        searchField,
        activeAuthorFilters,
        activeStatusFilters,
        backlogDateFilter: backlogDateFilter as BacklogDateFilter,
        customDateFrom: null,
        customDateTo: null,
        sortAscending,
      },
      { applyDateFilter: Boolean(isBacklogOpen && backlogCutoffDate) }
    );
  }, [
    queue,
    backlog,
    isBacklogOpen,
    searchField,
    sortAscending,
    activeAuthorFilters,
    activeStatusFilters,
    backlogDateFilter,
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

  const isSidebarOpen = isQueueOpen || isBacklogOpen;

  const hasLeftPanel =
    showUploadDialog || Boolean(activeJob && (activeJobGroup || multipolygons.length <= 1));

  return (
    <div
      className={`queue-container ${isSidebarOpen ? "open" : "closed"}${tableWidthExpanded ? " table-expanded" : ""}${tableWidthExpanded && hasLeftPanel ? " table-expanded-inset" : ""}`}
      onTransitionEnd={handleQueueWidthTransitionEnd}
    >
      <JobLogViewer
        open={jobLogsOpen}
        jobKey={activeJobLogKey}
        jobName={viewingJob?.name}
        onClose={() => {
          setActiveJobLogKey("");
          setJobLogsOpen(false);
        }}
      />
      {tableViewOpen ? (
        <JobQueueTableModal
          mode={isBacklogOpen ? "completed" : "active"}
          onClose={closeTableView}
          onOpenLogs={(key) => {
            setActiveJobLogKey(key);
            setJobLogsOpen(true);
          }}
        />
      ) : (
        <>
      <div className="queue-sidebar-header">
        <Tooltip title="Expand to table view">
          <IconButton
            className="queue-expand-btn"
            size="small"
            aria-label="Expand queue to table view"
            onClick={openTableView}
            sx={{ color: "var(--st-gray-50)" }}
          >
            <ChevronLeftIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Typography variant="h6" className="queue-sidebar-header__title">
          {isBacklogOpen ? "Completed" : "In Progress"}
        </Typography>

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
      </div>
      <div
        style={{ display: "flex", flexDirection: "column", visibility: isSidebarOpen ? "visible" : "hidden" }}
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
                {BACKLOG_DATE_FILTER_OPTIONS.filter((name) => name !== "Custom Range").map((name) => (
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
        </>
      )}
    </div>
  );
};

export default JobQueue;
