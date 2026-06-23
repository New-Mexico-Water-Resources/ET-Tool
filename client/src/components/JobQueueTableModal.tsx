import {
  Avatar,
  Box,
  Checkbox,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Toolbar,
  Tooltip,
  Typography,
  type TypographyProps,
} from "@mui/material";
import {
  BadgeCheck,
  ChevronRight,
  ChevronUp,
  Download,
  EllipsisIcon,
  FileTextIcon,
  GripVertical,
  Map as MapIcon,
  MapPinIcon,
  Pause,
  PencilLine,
  Play,
  RotateCw,
  Trash2,
  Trash2Icon,
  type LucideIcon,
} from "lucide-react";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs, { Dayjs } from "dayjs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "material-ui-confirm";
import StatusIcon from "./StatusIcon";
import useStore from "../utils/store";
import useCurrentJobStore from "../utils/currentJobStore";
import { ALL_JOB_STATUSES, getJobStatusDisplayName, getJobStatusTooltip } from "../utils/constants";
import DefaultReportMenuItems from "./DefaultReportMenuItems";
import RenameJobDialog from "./RenameJobDialog";
import { getReportDownloadOptions } from "../utils/defaultDownloadOptions";
import { getAvatarColorsFromLetter } from "../utils/avatarColors";
import { QueueJob, isActiveQueueStatus } from "../utils/jobGroups";
import {
  BACKLOG_DATE_FILTER_OPTIONS,
  BacklogDateFilter,
  JobTableColumnSort,
  JobTableSortColumn,
  buildQueueRunOrderMap,
  cycleColumnSort,
  filterQueueJobs,
  getDefaultStatusFiltersForMode,
  isReorderableQueueJob,
  sortJobsByColumn,
  sortJobsForQueueOrder,
} from "../utils/jobQueueFilters";
import "../scss/JobQueueTableModal.scss";

export type JobQueueTableMode = "active" | "completed";

interface JobQueueTableModalProps {
  onClose: () => void;
  mode: JobQueueTableMode;
  onOpenLogs: (key: string) => void;
}

const SORTABLE_COLUMNS: { id: JobTableSortColumn; label: string; align?: "left" | "center" | "right" }[] = [
  { id: "name", label: "Name" },
  { id: "status", label: "Status", align: "center" },
  { id: "years", label: "Years" },
  { id: "submitted", label: "Submitted" },
  { id: "started", label: "Started" },
  { id: "finished", label: "Finished" },
  { id: "author", label: "Author", align: "center" },
  { id: "group", label: "Group" },
];

const TABLE_COLUMN_WIDTHS = {
  checkbox: 48,
  reorder: 32,
  name: 220,
  status: 88,
  years: 80,
  submitted: 148,
  started: 148,
  finished: 148,
  author: 88,
  group: 168,
  actions: 40,
} as const;

function formatJobYearRange(startYear?: number, endYear?: number): string {
  if (startYear == null || endYear == null) {
    return "—";
  }
  if (startYear === endYear) {
    return String(startYear);
  }
  const shortYear = (year: number) => `${String(year).slice(-2)}`;
  return `${shortYear(startYear)} - ${shortYear(endYear)}`;
}

function formatJobDateTime(value?: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    return value;
  }
  return parsed.format("MM/DD/YY hh:mm A");
}

function TruncatedCellText({ children, sx }: Pick<TypographyProps, "children" | "sx">) {
  const textRef = useRef<HTMLElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const text = children == null ? "" : String(children);

  const updateTruncation = useCallback(() => {
    const element = textRef.current;
    if (element) {
      setIsTruncated(element.scrollWidth > element.clientWidth);
    }
  }, []);

  useLayoutEffect(() => {
    updateTruncation();
  }, [text, updateTruncation]);

  useEffect(() => {
    const element = textRef.current;
    if (!element) {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(updateTruncation);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [updateTruncation]);

  return (
    <Tooltip title={isTruncated ? text : ""} disableHoverListener={!isTruncated}>
      <Typography ref={textRef} variant="body2" noWrap sx={{ display: "block", ...sx }}>
        {children}
      </Typography>
    </Tooltip>
  );
}

function getTableMinWidth(showReorderControls: boolean) {
  const widths = TABLE_COLUMN_WIDTHS;
  return (
    widths.checkbox +
    widths.name +
    widths.status +
    widths.years +
    widths.submitted +
    widths.started +
    widths.finished +
    widths.author +
    widths.group +
    widths.actions +
    (showReorderControls ? widths.reorder : 0)
  );
}

const JobQueueTableColGroup = ({ showReorderControls }: { showReorderControls: boolean }) => (
  <colgroup>
    <col style={{ width: TABLE_COLUMN_WIDTHS.checkbox }} />
    {showReorderControls && <col style={{ width: TABLE_COLUMN_WIDTHS.reorder }} />}
    <col style={{ width: TABLE_COLUMN_WIDTHS.name }} />
    <col style={{ width: TABLE_COLUMN_WIDTHS.status }} />
    <col style={{ width: TABLE_COLUMN_WIDTHS.years }} />
    <col style={{ width: TABLE_COLUMN_WIDTHS.submitted }} />
    <col style={{ width: TABLE_COLUMN_WIDTHS.started }} />
    <col style={{ width: TABLE_COLUMN_WIDTHS.finished }} />
    <col style={{ width: TABLE_COLUMN_WIDTHS.author }} />
    <col style={{ width: TABLE_COLUMN_WIDTHS.group }} />
    <col style={{ width: TABLE_COLUMN_WIDTHS.actions }} />
  </colgroup>
);

function getAuthorTooltip(user: QueueJob["user"]) {
  if (!user) {
    return "";
  }

  const { name, email } = user;
  if (name && email && name === email) {
    return email;
  }
  if (name && email) {
    return `Name: ${name}\nEmail: ${email}`;
  }
  return name || email || "";
}

function JobAuthorCell({ user }: { user: QueueJob["user"] }) {
  if (!user?.name && !user?.email && !user?.picture) {
    return (
      <Typography variant="body2" sx={{ color: "var(--st-gray-40)", display: "inline-block" }}>
        —
      </Typography>
    );
  }

  const label = user.name || user.email || "User";
  const tooltip = getAuthorTooltip(user);
  const initial = label.charAt(0).toUpperCase();
  const avatarColors = getAvatarColorsFromLetter(initial);

  return (
    <Tooltip title={tooltip || label} slotProps={{ tooltip: { sx: { whiteSpace: "pre-line" } } }}>
      <Avatar
        src={user.picture}
        alt={label}
        sx={{
          width: 24,
          height: 24,
          fontSize: 12,
          display: "inline-flex",
          ...(avatarColors
            ? { bgcolor: avatarColors.backgroundColor, color: avatarColors.color }
            : { bgcolor: "var(--st-gray-70)" }),
        }}
      >
        {initial}
      </Avatar>
    </Tooltip>
  );
}

function JobStatusCell({
  status,
  statusMessage,
  queueOrder,
}: {
  status: string;
  statusMessage?: string | null;
  queueOrder?: number;
}) {
  return (
    <Tooltip
      title={getJobStatusTooltip(status, statusMessage, queueOrder)}
      slotProps={{ tooltip: { sx: { whiteSpace: "pre-line" } } }}
    >
      <Box sx={{ display: "flex", justifyContent: "center" }}>
        <StatusIcon status={status} />
      </Box>
    </Tooltip>
  );
}

const JOB_ROW_MENU_ITEM_SX = { backgroundColor: "var(--st-gray-80)" } as const;

const JOB_ROW_MENU_HEADER_SX = {
  marginLeft: "8px",
  marginBottom: "4px",
  marginTop: "4px",
  backgroundColor: "var(--st-gray-80)",
  color: "var(--st-gray-40)",
} as const;

function JobRowMenuSectionHeader({ label }: { label: string }) {
  return (
    <>
      <Typography variant="body2" sx={JOB_ROW_MENU_HEADER_SX}>
        {label}
      </Typography>
      <Divider />
    </>
  );
}

function JobRowActionsMenu({
  job,
  canDelete,
  canRename,
  onLocate,
  onLogs,
  onDelete,
}: {
  job: QueueJob;
  canDelete: boolean;
  canRename: boolean;
  onLocate: () => void;
  onLogs: () => void;
  onDelete: () => void;
}) {
  const downloadGeojson = useCurrentJobStore((state) => state.downloadGeojson);
  const downloadAllGeotiffs = useCurrentJobStore((state) => state.downloadAllGeotiffs);
  const bulkGeotiffDownloadJobId = useCurrentJobStore((state) => state.bulkGeotiffDownloadJobId);

  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const open = Boolean(menuAnchor);

  const isDownloadDisabled = ["Pending", "In Progress", "WaitingApproval"].includes(job.status);
  const isBulkGeotiffDownloading = bulkGeotiffDownloadJobId === job.key;

  const closeMenu = () => setMenuAnchor(null);

  const runAction = (action: () => void) => {
    closeMenu();
    action();
  };

  return (
    <>
      <IconButton
        size="small"
        className="job-queue-table-view__icon-btn"
        aria-label="Job actions"
        onClick={(event) => setMenuAnchor(event.currentTarget)}
      >
        <EllipsisIcon size={16} />
      </IconButton>
      <Menu
        anchorEl={menuAnchor}
        open={open}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        sx={{ "& .MuiList-root": { backgroundColor: "var(--st-gray-80)" } }}
      >
        <JobRowMenuSectionHeader label="Actions" />
        <MenuItem sx={JOB_ROW_MENU_ITEM_SX} disableRipple onClick={() => runAction(onLocate)}>
          <MapPinIcon size={16} style={{ marginRight: "16px" }} />
          Locate on Map
        </MenuItem>
        <MenuItem sx={JOB_ROW_MENU_ITEM_SX} disableRipple onClick={() => runAction(onLogs)}>
          <FileTextIcon size={16} style={{ marginRight: "16px" }} />
          View Logs
        </MenuItem>
        {canRename && (
          <MenuItem
            sx={JOB_ROW_MENU_ITEM_SX}
            disableRipple
            onClick={() => {
              closeMenu();
              setRenameDialogOpen(true);
            }}
          >
            <PencilLine size={16} style={{ marginRight: "16px" }} />
            Rename Job
          </MenuItem>
        )}
        {canDelete && (
          <MenuItem sx={JOB_ROW_MENU_ITEM_SX} disableRipple onClick={() => runAction(onDelete)}>
            <Trash2Icon size={16} style={{ marginRight: "16px" }} />
            Delete Job
          </MenuItem>
        )}

        <JobRowMenuSectionHeader label="Download Report" />
        <DefaultReportMenuItems
          jobKey={job.key}
          disabled={isDownloadDisabled}
          onClose={closeMenu}
          menuItemSx={JOB_ROW_MENU_ITEM_SX}
          showSectionHeader={false}
        />

        <JobRowMenuSectionHeader label="Download Map Data" />
        <MenuItem
          sx={JOB_ROW_MENU_ITEM_SX}
          disableRipple
          disabled={isDownloadDisabled}
          onClick={() => runAction(() => downloadGeojson(job.key, job.name))}
        >
          GeoJSON
        </MenuItem>
        <MenuItem
          sx={JOB_ROW_MENU_ITEM_SX}
          disableRipple
          disabled={isDownloadDisabled}
          onClick={() => runAction(() => downloadAllGeotiffs(job.key))}
        >
          All GeoTIFFs
        </MenuItem>
        <MenuItem
          sx={JOB_ROW_MENU_ITEM_SX}
          disableRipple
          disabled={isDownloadDisabled || isBulkGeotiffDownloading}
          onClick={() => runAction(() => downloadAllGeotiffs(job.key, { clipped: true }))}
        >
          {isBulkGeotiffDownloading && <CircularProgress size={16} sx={{ marginRight: "8px" }} />}
          All GeoTIFFs (clipped)
        </MenuItem>
      </Menu>
      <RenameJobDialog job={job} open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)} />
    </>
  );
}

const SortIndicator = ({ column, sort }: { column: JobTableSortColumn; sort: JobTableColumnSort }) => {
  const isActive = sort.column === column;
  const isDesc = isActive && sort.direction === "desc";

  return (
    <ChevronUp
      size={14}
      className={[
        "job-queue-table-view__sort-arrow",
        isActive ? "job-queue-table-view__sort-arrow--active" : "",
        isDesc ? "job-queue-table-view__sort-arrow--desc" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
};

function TableIconButton({
  icon: Icon,
  title,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          size="small"
          className="job-queue-table-view__icon-btn"
          disabled={disabled}
          onClick={onClick}
          aria-label={title}
        >
          <Icon size={16} />
        </IconButton>
      </span>
    </Tooltip>
  );
}

function BulkSelectionDownloadButton({ jobs, disabled }: { jobs: QueueJob[]; disabled?: boolean }) {
  const downloadJobsBulk = useStore((state) => state.downloadJobsBulk);
  const defaultDownloadOptions = useStore((state) => state.defaultDownloadOptions);
  const reportOptions = getReportDownloadOptions(defaultDownloadOptions);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const open = Boolean(menuAnchor);

  const downloadName = jobs.length === 1 ? jobs[0].name : `Selected Jobs (${jobs.length})`;

  const closeMenu = () => setMenuAnchor(null);

  const runDownload = async (
    type: "report" | "geojson" | "geotiff",
    units?: "metric" | "imperial" | "acre-feet"
  ) => {
    closeMenu();
    setIsDownloading(true);
    try {
      await downloadJobsBulk(jobs, type, downloadName, units);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <>
      <Tooltip title={disabled ? "No downloadable jobs selected" : "Download selected jobs"}>
        <span>
          <IconButton
            size="small"
            className="job-queue-table-view__icon-btn"
            disabled={disabled || isDownloading}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
            aria-label="Download selected jobs"
          >
            {isDownloading ? <CircularProgress size={14} /> : <Download size={16} />}
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={menuAnchor}
        open={open}
        onClose={closeMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        sx={{ "& .MuiList-root": { backgroundColor: "var(--st-gray-80)" } }}
      >
        <JobRowMenuSectionHeader label="Report" />
        {reportOptions.map((option) => (
          <MenuItem
            key={option.id}
            sx={JOB_ROW_MENU_ITEM_SX}
            disableRipple
            onClick={() => runDownload("report", option.units)}
          >
            {option.label}
          </MenuItem>
        ))}

        <JobRowMenuSectionHeader label="Map Data" />
        <MenuItem sx={JOB_ROW_MENU_ITEM_SX} disableRipple onClick={() => runDownload("geojson")}>
          GeoJSON
        </MenuItem>
        <MenuItem sx={JOB_ROW_MENU_ITEM_SX} disableRipple onClick={() => runDownload("geotiff")}>
          All GeoTIFFs
        </MenuItem>
      </Menu>
    </>
  );
}

const JobQueueTableModal = ({ onClose, mode, onOpenLogs }: JobQueueTableModalProps) => {
  const confirm = useConfirm();
  const queue = useStore((state) => state.queue);
  const backlog = useStore((state) => state.backlog);
  const loadJob = useStore((state) => state.loadJob);
  const loadJobGroup = useStore((state) => state.loadJobGroup);
  const deleteJob = useStore((state) => state.deleteJob);
  const bulkDeleteJobs = useStore((state) => state.bulkDeleteJobs);
  const bulkApproveJobs = useStore((state) => state.bulkApproveJobs);
  const bulkPauseJobs = useStore((state) => state.bulkPauseJobs);
  const bulkRestartJobs = useStore((state) => state.bulkRestartJobs);
  const bulkResumeJobs = useStore((state) => state.bulkResumeJobs);
  const reorderPendingJobs = useStore((state) => state.reorderPendingJobs);
  const setActiveJob = useStore((state) => state.setActiveJob);
  const activeJob = useStore((state) => state.activeJob);
  const currentUserInfo = useStore((state) => state.userInfo);

  const [searchField, setSearchField] = useState("");
  const [activeAuthorFilters, setActiveAuthorFilters] = useState<string[]>([]);
  const [activeStatusFilters, setActiveStatusFilters] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<BacklogDateFilter>("All Time");
  const [customDateFrom, setCustomDateFrom] = useState<Dayjs | null>(null);
  const [customDateTo, setCustomDateTo] = useState<Dayjs | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [columnSort, setColumnSort] = useState<JobTableColumnSort>({ column: null, direction: null });
  const headerOuterRef = useRef<HTMLDivElement>(null);
  const headerInnerRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);

  const syncHeaderScroll = useCallback(() => {
    const body = bodyScrollRef.current;
    const headerInner = headerInnerRef.current;
    if (!body || !headerInner) {
      return;
    }
    headerInner.style.transform = `translate3d(-${body.scrollLeft}px, 0, 0)`;
  }, []);

  const handleBodyScroll = useCallback(() => {
    syncHeaderScroll();
  }, [syncHeaderScroll]);

  const canWriteJobs = useMemo(() => currentUserInfo?.permissions?.includes("write:jobs"), [currentUserInfo]);

  const allJobs = useMemo(() => {
    const byKey = new Map<string, QueueJob>();
    [...queue, ...backlog].forEach((job) => byKey.set(job.key, job));
    return Array.from(byKey.values());
  }, [queue, backlog]);

  useEffect(() => {
    const jobsByKey = new Map<string, QueueJob>();
    [...queue, ...backlog].forEach((job) => jobsByKey.set(job.key, job));
    const jobs = Array.from(jobsByKey.values());

    setSearchField("");
    setActiveAuthorFilters([]);
    setActiveStatusFilters(getDefaultStatusFiltersForMode(mode, jobs));
    setSelectedKeys(new Set());
    setDateFilter("All Time");
    setCustomDateFrom(null);
    setCustomDateTo(null);
    setColumnSort({ column: null, direction: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const filteredJobs = useMemo(
    () =>
      filterQueueJobs(
        allJobs,
        {
          searchField,
          activeAuthorFilters,
          activeStatusFilters,
          backlogDateFilter: dateFilter,
          customDateFrom,
          customDateTo,
          sortAscending: true,
        },
        {
          applyDateFilter: dateFilter !== "All Time",
          customDateTo,
          skipSort: true,
        }
      ),
    [allJobs, searchField, activeAuthorFilters, activeStatusFilters, dateFilter, customDateFrom, customDateTo]
  );

  const allReorderableJobs = useMemo(() => sortJobsForQueueOrder(queue), [queue]);
  const [orderedReorderableKeys, setOrderedReorderableKeys] = useState<string[]>([]);

  useEffect(() => {
    setOrderedReorderableKeys(allReorderableJobs.map((job) => job.key));
  }, [allReorderableJobs]);

  const queueRunOrderByKey = useMemo(
    () => (mode === "active" ? buildQueueRunOrderMap(queue, orderedReorderableKeys) : new Map<string, number>()),
    [mode, queue, orderedReorderableKeys]
  );

  const displayJobs = useMemo(() => {
    if (columnSort.column) {
      return sortJobsByColumn(filteredJobs, columnSort);
    }

    if (!orderedReorderableKeys.length) {
      return filteredJobs;
    }

    const filteredKeySet = new Set(filteredJobs.map((job) => job.key));
    const reorderableByKey = new Map(allReorderableJobs.map((job) => [job.key, job]));
    const orderedReorderable = orderedReorderableKeys
      .map((key) => reorderableByKey.get(key))
      .filter((job): job is QueueJob => Boolean(job))
      .filter((job) => filteredKeySet.has(job.key));
    const nonReorderable = filteredJobs.filter((job) => !isReorderableQueueJob(job));

    return [...nonReorderable, ...orderedReorderable];
  }, [filteredJobs, columnSort, orderedReorderableKeys, allReorderableJobs]);

  const authors = useMemo(() => {
    const names = new Set<string>();
    allJobs.forEach((job) => {
      if (job.user?.name) {
        names.add(job.user.name);
      }
    });
    return Array.from(names);
  }, [allJobs]);

  const presentStatusFilters = useMemo(() => {
    const statuses = new Set<string>();
    allJobs.forEach((job) => statuses.add(job.status));
    return statuses;
  }, [allJobs]);

  const statusFilterOptions = useMemo(() => {
    const options = new Set<string>(ALL_JOB_STATUSES);
    allJobs.forEach((job) => options.add(job.status));
    const ordered = ALL_JOB_STATUSES.filter((status) => options.has(status));
    allJobs.forEach((job) => {
      if (!ALL_JOB_STATUSES.includes(job.status)) {
        ordered.push(job.status);
      }
    });
    return ordered;
  }, [allJobs]);

  const selectedJobs = useMemo(
    () => displayJobs.filter((job) => selectedKeys.has(job.key)),
    [displayJobs, selectedKeys]
  );

  const selectedDownloadableJobs = useMemo(
    () => selectedJobs.filter((job) => !["Pending", "In Progress", "WaitingApproval"].includes(job.status)),
    [selectedJobs]
  );

  const selectedHasWaitingApproval = useMemo(
    () => selectedJobs.some((job) => job.status === "WaitingApproval"),
    [selectedJobs]
  );

  const selectedHasPausableJobs = useMemo(
    () => selectedJobs.some((job) => job.status === "In Progress"),
    [selectedJobs]
  );

  const selectedHasStartableJobs = useMemo(
    () => selectedJobs.some((job) => ["WaitingApproval", "Paused"].includes(job.status)),
    [selectedJobs]
  );

  const selectedHasRestartableJobs = useMemo(
    () => selectedJobs.some((job) => !isActiveQueueStatus(job.status)),
    [selectedJobs]
  );

  const showReorderControls = Boolean(canWriteJobs && allReorderableJobs.length > 0 && !columnSort.column);
  const tableMinWidth = getTableMinWidth(showReorderControls);

  useLayoutEffect(() => {
    syncHeaderScroll();
  }, [syncHeaderScroll, displayJobs.length, showReorderControls, tableMinWidth]);

  useEffect(() => {
    const body = bodyScrollRef.current;
    const header = headerOuterRef.current;
    if (!body || !header) {
      return;
    }

    const updateHeaderPadding = () => {
      const scrollbarWidth = body.offsetWidth - body.clientWidth;
      header.style.paddingRight = `${scrollbarWidth}px`;
    };

    updateHeaderPadding();
    const observer = new ResizeObserver(updateHeaderPadding);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  const canDeleteJob = useCallback(
    (job: QueueJob) => {
      if (job.status === "Killed") {
        return false;
      }
      const hasPermission = currentUserInfo?.permissions?.includes("write:jobs");
      return hasPermission || job?.user?.sub === currentUserInfo?.sub;
    },
    [currentUserInfo]
  );

  const canRenameJob = useCallback(
    (job: QueueJob) => canDeleteJob(job) && !["In Progress", "Pending"].includes(job.status),
    [canDeleteJob]
  );

  const toggleSelectAll = () => {
    if (selectedKeys.size === displayJobs.length) {
      setSelectedKeys(new Set());
      return;
    }
    setSelectedKeys(new Set(displayJobs.map((job) => job.key)));
  };

  const toggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleColumnSort = (column: JobTableSortColumn) => {
    setColumnSort((prev) => cycleColumnSort(prev, column));
  };

  const getDeletableSelectedKeys = () => selectedJobs.filter(canDeleteJob).map((job) => job.key);

  const handleBulkDelete = () => {
    const keys = getDeletableSelectedKeys();
    if (!keys.length) {
      return;
    }

    confirm({
      title: "Delete Jobs",
      description: `Are you sure you want to delete ${keys.length} selected job(s)?`,
      confirmationButtonProps: { color: "primary", variant: "contained" },
      cancellationButtonProps: { color: "secondary", variant: "contained" },
      titleProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
      contentProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
      dialogActionsProps: { sx: { backgroundColor: "var(--st-gray-90)" } },
    }).then(() => {
      bulkDeleteJobs(keys, true);
      if (keys.some((key) => key === activeJob?.key)) {
        setActiveJob(null);
      }
      setSelectedKeys(new Set());
    });
  };

  const handleBulkRestart = () => {
    const keys = selectedJobs
      .filter((job) => !isActiveQueueStatus(job.status))
      .map((job) => job.key);
    if (!keys.length) {
      return;
    }
    confirm({
      title: "Restart Jobs",
      description: `Are you sure you want to restart ${keys.length} selected job(s)?`,
      confirmationButtonProps: { color: "primary", variant: "contained" },
      cancellationButtonProps: { color: "secondary", variant: "contained" },
      titleProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
      contentProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
      dialogActionsProps: { sx: { backgroundColor: "var(--st-gray-90)" } },
    }).then(() => {
      bulkRestartJobs(keys);
      setSelectedKeys(new Set());
    });
  };

  const handleBulkApprove = () => {
    const keys = selectedJobs.filter((job) => job.status === "WaitingApproval").map((job) => job.key);
    if (!keys.length) {
      return;
    }
    bulkApproveJobs(keys);
    setSelectedKeys(new Set());
  };

  const handleBulkPause = () => {
    const keys = selectedJobs.filter((job) => job.status === "In Progress").map((job) => job.key);
    if (!keys.length) {
      return;
    }
    bulkPauseJobs(keys);
    setSelectedKeys(new Set());
  };

  const handleBulkStart = () => {
    const approveKeys = selectedJobs.filter((job) => job.status === "WaitingApproval").map((job) => job.key);
    const resumeKeys = selectedJobs.filter((job) => job.status === "Paused").map((job) => job.key);

    if (approveKeys.length) {
      bulkApproveJobs(approveKeys);
    }
    if (resumeKeys.length) {
      bulkResumeJobs(resumeKeys);
    }
    setSelectedKeys(new Set());
  };

  const handleViewOnMap = () => {
    if (!selectedJobs.length) {
      return;
    }

    const groupName =
      selectedJobs.length === 1
        ? selectedJobs[0].name
        : `Selected Jobs (${selectedJobs.length})`;
    void loadJobGroup(selectedJobs, groupName);
  };

  const handleDeleteJob = (job: QueueJob) => {
    confirm({
      title: "Delete Job",
      description: `Are you sure you want to delete "${job.name}"?`,
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
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(job.key);
        return next;
      });
    });
  };

  const moveReorderableJob = (fromKey: string, toKey: string) => {
    if (!canWriteJobs || fromKey === toKey) {
      return;
    }

    setOrderedReorderableKeys((prev) => {
      const fromIndex = prev.indexOf(fromKey);
      const toIndex = prev.indexOf(toKey);
      if (fromIndex < 0 || toIndex < 0) {
        return prev;
      }
      const next = [...prev];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, fromKey);
      reorderPendingJobs(next);
      return next;
    });
  };

  const tableColumnCount = 1 + (showReorderControls ? 1 : 0) + SORTABLE_COLUMNS.length + 1;

  return (
    <div className="job-queue-table-view">
      <Toolbar className="job-queue-table-view__toolbar" sx={{ gap: 1, flexWrap: "nowrap", minHeight: 40, px: 1 }}>
        <IconButton
          onClick={onClose}
          className="job-queue-table-view__icon-btn job-queue-table-view__collapse-btn"
          aria-label="Collapse queue table view"
          size="small"
          sx={{ mr: 0.5 }}
        >
          <ChevronRight size={18} />
        </IconButton>
        <Typography variant="h6" sx={{ color: "var(--st-gray-30)" }}>
          Jobs
        </Typography>
        <Typography variant="body2" sx={{ color: "var(--st-gray-40)" }}>
          {displayJobs.length} job{displayJobs.length === 1 ? "" : "s"}
        </Typography>
      </Toolbar>

      {showReorderControls && (
        <Typography variant="caption" sx={{ color: "var(--st-gray-40)", px: 2, pb: 0.5 }}>
          Drag pending, paused, or waiting-approval jobs to change run order.
        </Typography>
      )}

      <Box className="job-queue-table-view__filters">
        <input
          type="text"
          placeholder="Search..."
          className="search-input"
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
        />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="table-author-filter-label">Author</InputLabel>
          <Select
            size="small"
            labelId="table-author-filter-label"
            label="Author"
            multiple
            value={activeAuthorFilters}
            onChange={(evt) => setActiveAuthorFilters(evt.target.value as string[])}
          >
            {authors.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" className="job-queue-table-view__status-filter">
          <InputLabel id="table-status-filter-label">Status</InputLabel>
          <Select
            size="small"
            labelId="table-status-filter-label"
            label="Status"
            multiple
            value={activeStatusFilters}
            onChange={(evt) => setActiveStatusFilters(evt.target.value as string[])}
            renderValue={(selected) => (
              <span className="job-queue-table-view__status-filter-value">
                {(selected as string[]).map(getJobStatusDisplayName).join(", ")}
              </span>
            )}
          >
            {statusFilterOptions.map((name) => {
              const isPresent = presentStatusFilters.has(name);
              const isSelected = activeStatusFilters.includes(name);
              return (
                <MenuItem key={name} value={name} disabled={!isPresent && !isSelected}>
                  {getJobStatusDisplayName(name)}
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id="table-date-filter-label">Date Submitted</InputLabel>
          <Select
            size="small"
            labelId="table-date-filter-label"
            label="Date Submitted"
            value={dateFilter}
            onChange={(evt) => setDateFilter(evt.target.value as BacklogDateFilter)}
          >
            {BACKLOG_DATE_FILTER_OPTIONS.map((name) => (
              <MenuItem key={name} value={name}>
                {name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {dateFilter === "Custom Range" && (
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="From"
              value={customDateFrom}
              onChange={(value) => setCustomDateFrom(value)}
              slotProps={{ textField: { size: "small" } }}
            />
            <DatePicker
              label="To"
              value={customDateTo}
              onChange={(value) => setCustomDateTo(value)}
              slotProps={{ textField: { size: "small" } }}
              minDate={customDateFrom ?? undefined}
            />
          </LocalizationProvider>
        )}
      </Box>

      <Box className="job-queue-table-view__selection-bar">
        <Typography variant="body2" sx={{ color: selectedKeys.size > 0 ? "var(--st-gray-50)" : "var(--st-gray-60)", flexShrink: 0 }}>
          {selectedKeys.size} selected
        </Typography>
        <Box className="job-queue-table-view__selection-actions">
          <TableIconButton
            icon={MapIcon}
            title="View on Map"
            disabled={!selectedKeys.size}
            onClick={handleViewOnMap}
          />
          <BulkSelectionDownloadButton
            jobs={selectedDownloadableJobs}
            disabled={!selectedDownloadableJobs.length}
          />
          {canWriteJobs && (
            <>
              <TableIconButton
                icon={BadgeCheck}
                title="Approve"
                disabled={!selectedHasWaitingApproval}
                onClick={handleBulkApprove}
              />
              <TableIconButton
                icon={Play}
                title="Start"
                disabled={!selectedHasStartableJobs}
                onClick={handleBulkStart}
              />
              <TableIconButton
                icon={Pause}
                title="Pause"
                disabled={!selectedHasPausableJobs}
                onClick={handleBulkPause}
              />
              <TableIconButton
                icon={RotateCw}
                title="Restart"
                disabled={!selectedHasRestartableJobs}
                onClick={handleBulkRestart}
              />
            </>
          )}
          <TableIconButton
            icon={Trash2}
            title="Delete"
            disabled={!getDeletableSelectedKeys().length}
            onClick={handleBulkDelete}
          />
        </Box>
      </Box>

      <div className="job-queue-table-view__table-area">
        <div className="job-queue-table-view__table-header" ref={headerOuterRef}>
          <div className="job-queue-table-view__table-header-inner" ref={headerInnerRef}>
            <Table
              size="small"
              className="job-queue-table-view__table"
              sx={{ minWidth: tableMinWidth, tableLayout: "fixed" }}
            >
              <JobQueueTableColGroup showReorderControls={showReorderControls} />
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      indeterminate={selectedKeys.size > 0 && selectedKeys.size < displayJobs.length}
                      checked={displayJobs.length > 0 && selectedKeys.size === displayJobs.length}
                      onChange={toggleSelectAll}
                      sx={{ color: "var(--st-gray-40)", "&.Mui-checked": { color: "var(--st-blue)" } }}
                    />
                  </TableCell>
                  {showReorderControls && <TableCell padding="none" sx={{ width: 32 }} />}
                  {SORTABLE_COLUMNS.map(({ id, label, align }) => (
                    <TableCell
                      key={id}
                      align={align}
                      className="job-queue-table-view__sortable-header"
                      onClick={() => handleColumnSort(id)}
                    >
                      <Box
                        className={[
                          "job-queue-table-view__header-content",
                          align === "center"
                            ? "job-queue-table-view__header-content--center"
                            : align === "right"
                              ? "job-queue-table-view__header-content--right"
                              : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className="job-queue-table-view__header-label">{label}</span>
                        <SortIndicator column={id} sort={columnSort} />
                      </Box>
                    </TableCell>
                  ))}
                  <TableCell align="right" sx={{ width: TABLE_COLUMN_WIDTHS.actions, px: 0.5 }} />
                </TableRow>
              </TableHead>
            </Table>
          </div>
        </div>
        <TableContainer
          ref={bodyScrollRef}
          className="job-queue-table-view__table-container"
          onScroll={handleBodyScroll}
        >
          <Table
            size="small"
            className="job-queue-table-view__table"
            sx={{ minWidth: tableMinWidth, tableLayout: "fixed" }}
          >
            <JobQueueTableColGroup showReorderControls={showReorderControls} />
            <TableBody>
              {displayJobs.map((job) => {
                const reorderable = showReorderControls && isReorderableQueueJob(job);
                const rowClassName = [
                  reorderable ? "job-queue-table-view__row--reorderable" : null,
                  dropTargetKey === job.key ? "job-queue-table-view__row--drop-target" : null,
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <TableRow
                    key={job.key}
                    hover
                    selected={selectedKeys.has(job.key)}
                    className={rowClassName || undefined}
                    draggable={reorderable}
                    onDragStart={() => reorderable && setDragKey(job.key)}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDropTargetKey(null);
                    }}
                    onDragOver={(event) => {
                      if (reorderable && dragKey && dragKey !== job.key) {
                        event.preventDefault();
                        setDropTargetKey(job.key);
                      }
                    }}
                    onDrop={() => {
                      if (dragKey && reorderable) {
                        moveReorderableJob(dragKey, job.key);
                      }
                      setDragKey(null);
                      setDropTargetKey(null);
                    }}
                  >
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selectedKeys.has(job.key)}
                        onChange={() => toggleSelect(job.key)}
                        sx={{ color: "var(--st-gray-40)", "&.Mui-checked": { color: "var(--st-blue)" } }}
                      />
                    </TableCell>
                    {showReorderControls && (
                      <TableCell padding="none">
                        {reorderable ? (
                          <GripVertical size={14} style={{ color: "var(--st-gray-40)", cursor: "grab" }} />
                        ) : null}
                      </TableCell>
                    )}
                    <TableCell>
                      <TruncatedCellText>{job.name}</TruncatedCellText>
                    </TableCell>
                    <TableCell align="center" className="job-queue-table-view__status-cell">
                      <JobStatusCell
                        status={job.status}
                        statusMessage={job.status_msg}
                        queueOrder={queueRunOrderByKey.get(job.key)}
                      />
                    </TableCell>
                    <TableCell>
                      <TruncatedCellText>{formatJobYearRange(job.start_year, job.end_year)}</TruncatedCellText>
                    </TableCell>
                    <TableCell>
                      <TruncatedCellText>{formatJobDateTime(job.submitted)}</TruncatedCellText>
                    </TableCell>
                    <TableCell>
                      <TruncatedCellText>{formatJobDateTime(job.started)}</TruncatedCellText>
                    </TableCell>
                    <TableCell>
                      <TruncatedCellText>{formatJobDateTime(job.ended)}</TruncatedCellText>
                    </TableCell>
                    <TableCell align="center" className="job-queue-table-view__author-cell">
                      <JobAuthorCell user={job.user} />
                    </TableCell>
                    <TableCell>
                      <TruncatedCellText sx={{ color: job.group_name ? "var(--st-gray-10)" : "var(--st-gray-40)" }}>
                        {job.group_name || "—"}
                      </TruncatedCellText>
                    </TableCell>
                    <TableCell align="right" sx={{ px: 0.5 }}>
                      <Box className="job-queue-table-view__row-actions">
                        <JobRowActionsMenu
                          job={job}
                          canDelete={canDeleteJob(job)}
                          canRename={canRenameJob(job)}
                          onLocate={() => loadJob(job)}
                          onLogs={() => onOpenLogs(job.key)}
                          onDelete={() => handleDeleteJob(job)}
                        />
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
              {displayJobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={tableColumnCount} align="center">
                    <Typography variant="body2" sx={{ color: "var(--st-gray-40)", py: 4 }}>
                      No jobs match the current filters.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </div>
    </div>
  );
};

export default JobQueueTableModal;
