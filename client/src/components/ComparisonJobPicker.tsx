import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowDropUpIcon from "@mui/icons-material/ArrowDropUp";
import {
  Box,
  CircularProgress,
  ClickAwayListener,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import type { SelectProps } from "@mui/material/Select";
import type { AxiosInstance } from "axios";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  getJobAuthorLabel,
  type ComparisonDateFilter,
  type ComparisonJobSort,
  type JobCentroid,
  distanceMiles,
  filterComparisonJobs,
  formatComparisonDistance,
  formatComparisonSubmitted,
  getComparisonJobAuthors,
  resolveJobCentroid,
  sortComparisonJobs,
} from "../utils/comparisonJobPicker";
import type { QueueJob } from "../utils/jobGroups";

type ComparisonJobPickerProps = {
  primaryJob: QueueJob;
  jobs: QueueJob[];
  selectedJobKey: string;
  onSelect: (jobKey: string) => void;
  disabled?: boolean;
  authAxios: () => AxiosInstance | null;
};

const DATE_FILTER_OPTIONS: { value: ComparisonDateFilter; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "week", label: "Last week" },
  { value: "month", label: "Last month" },
  { value: "year", label: "Last year" },
];

const SORT_OPTIONS: { value: ComparisonJobSort; label: string }[] = [
  { value: "name", label: "Name (A-Z)" },
  { value: "submitted", label: "Date submitted (newest)" },
  { value: "proximity", label: "Nearest to target" },
];

type FilterDropdown = "author" | "date" | "sort";

const FILTER_SELECT_MENU_PROPS: SelectProps["MenuProps"] = {
  disableScrollLock: true,
  hideBackdrop: true,
  disableAutoFocus: true,
  slotProps: {
    root: {
      disableEnforceFocus: true,
      sx: {
        pointerEvents: "none",
        zIndex: 1700,
      },
    },
    paper: {
      sx: {
        maxHeight: 280,
        pointerEvents: "auto",
      },
    },
  },
};

const isEventInsidePicker = (event: Event) => {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const node of path) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    if (node.classList.contains("comparison-job-picker") || node.classList.contains("comparison-job-picker__panel")) {
      return true;
    }
    if (node.classList.contains("MuiPopover-root") || node.classList.contains("MuiMenu-root")) {
      return true;
    }
  }
  return false;
};

const isFilterDropdownTarget = (target: EventTarget | null) => {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!element) {
    return false;
  }
  return Boolean(
    element.closest(".comparison-job-picker__filter-select, .MuiPopover-root, .MuiMenu-root"),
  );
};

export default function ComparisonJobPicker({
  primaryJob,
  jobs,
  selectedJobKey,
  onSelect,
  disabled = false,
  authAxios,
}: ComparisonJobPickerProps) {
  const [open, setOpen] = useState(false);
  const [openFilter, setOpenFilter] = useState<FilterDropdown | null>(null);
  const [search, setSearch] = useState("");
  const [authorFilters, setAuthorFilters] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<ComparisonDateFilter>("all");
  const [sortBy, setSortBy] = useState<ComparisonJobSort>("proximity");
  const [primaryCentroid, setPrimaryCentroid] = useState<JobCentroid | null>(null);
  const [distancesMiles, setDistancesMiles] = useState<Map<string, number | null>>(new Map());
  const [loadingDistances, setLoadingDistances] = useState(false);
  const centroidCacheRef = useRef(new Map<string, JobCentroid | null>());

  const selectedJob = useMemo(
    () => jobs.find((job) => job.key === selectedJobKey) ?? null,
    [jobs, selectedJobKey],
  );

  const authors = useMemo(() => getComparisonJobAuthors(jobs), [jobs]);

  const filteredJobs = useMemo(
    () =>
      filterComparisonJobs(jobs, {
        search,
        authorFilters,
        dateFilter,
      }),
    [authorFilters, dateFilter, jobs, search],
  );

  const displayedJobs = useMemo(
    () => sortComparisonJobs(filteredJobs, sortBy, distancesMiles),
    [distancesMiles, filteredJobs, sortBy],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const axiosInstance = authAxios();
    if (!axiosInstance) {
      return;
    }

    const loadCentroids = async () => {
      setLoadingDistances(true);
      try {
        const primary = await resolveJobCentroid(axiosInstance, primaryJob, centroidCacheRef.current);
        if (cancelled) {
          return;
        }
        setPrimaryCentroid(primary);

        const nextDistances = new Map<string, number | null>();
        await Promise.all(
          filteredJobs.map(async (job) => {
            if (!primary) {
              nextDistances.set(job.key, null);
              return;
            }
            const jobCentroid = await resolveJobCentroid(axiosInstance, job, centroidCacheRef.current);
            nextDistances.set(job.key, jobCentroid ? distanceMiles(primary, jobCentroid) : null);
          }),
        );

        if (!cancelled) {
          setDistancesMiles(nextDistances);
        }
      } finally {
        if (!cancelled) {
          setLoadingDistances(false);
        }
      }
    };

    void loadCentroids();

    return () => {
      cancelled = true;
    };
  }, [authAxios, filteredJobs, open, primaryJob]);

  useEffect(() => {
    if (!open) {
      setOpenFilter(null);
    }
  }, [open]);

  const handleSelect = (jobKey: string) => {
    onSelect(jobKey);
    setOpenFilter(null);
    setOpen(false);
  };

  const handlePanelMouseDown = (event: MouseEvent) => {
    if (!isFilterDropdownTarget(event.target)) {
      setOpenFilter(null);
    }
  };

  const getFilterSelectProps = (filter: FilterDropdown) => ({
    className: "comparison-job-picker__filter-select",
    open: openFilter === filter,
    onOpen: () => setOpenFilter(filter),
    onClose: () => setOpenFilter((current) => (current === filter ? null : current)),
    onMouseDown: (event: MouseEvent) => {
      event.stopPropagation();
      if (openFilter === filter) {
        event.preventDefault();
        setOpenFilter(null);
      }
    },
    MenuProps: FILTER_SELECT_MENU_PROPS,
  });

  return (
    <ClickAwayListener
      onClickAway={(event) => {
        if (isEventInsidePicker(event)) {
          return;
        }
        setOpenFilter(null);
        setOpen(false);
      }}
    >
      <Box className="comparison-job-picker">
        <button
          type="button"
          className={["comparison-job-picker__trigger", open ? "comparison-job-picker__trigger--open" : ""].join(" ")}
          onClick={() => {
            if (!disabled) {
              setOpenFilter(null);
              setOpen((current) => !current);
            }
          }}
          disabled={disabled || jobs.length === 0}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <Box className="comparison-job-picker__trigger-content">
            <Typography variant="caption" className="comparison-job-picker__trigger-label" sx={{ color: "var(--st-gray-50)" }}>
              Compare with
            </Typography>
            <Typography variant="body2" className="comparison-job-picker__trigger-value" sx={{ color: "var(--st-gray-20)" }}>
              {selectedJob?.name ?? (jobs.length === 0 ? "No completed jobs available" : "Select a job")}
            </Typography>
          </Box>
          {open ? <ArrowDropUpIcon fontSize="medium" sx={{ color: "var(--st-gray-50)" }} /> : <ArrowDropDownIcon fontSize="medium" sx={{ color: "var(--st-gray-50)" }} />}
        </button>

        {open && (
          <Paper
            elevation={8}
            className="comparison-job-picker__panel"
            role="listbox"
            aria-label="Comparison jobs"
            onMouseDown={handlePanelMouseDown}
          >
            <Box className="comparison-job-picker__filters">
              <TextField
                size="small"
                fullWidth
                placeholder="Search jobs..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />

              <Box className="comparison-job-picker__filter-row">
                <FormControl size="small" fullWidth>
                  <InputLabel id="comparison-author-filter-label">Author</InputLabel>
                  <Select
                    labelId="comparison-author-filter-label"
                    label="Author"
                    multiple
                    {...getFilterSelectProps("author")}
                    value={authorFilters}
                    onChange={(event) => setAuthorFilters(event.target.value as string[])}
                    renderValue={(selected) => {
                      if (selected.length === 0) {
                        return "All authors";
                      }
                      if (selected.length === 1) {
                        return authors.find((author) => author.key === selected[0])?.label ?? selected[0];
                      }
                      return `${selected.length} authors`;
                    }}
                  >
                    {authors.map((author) => (
                      <MenuItem key={author.key} value={author.key}>
                        {author.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth>
                  <InputLabel id="comparison-date-filter-label">Date submitted</InputLabel>
                  <Select
                    labelId="comparison-date-filter-label"
                    label="Date submitted"
                    {...getFilterSelectProps("date")}
                    value={dateFilter}
                    onChange={(event) => {
                      setDateFilter(event.target.value as ComparisonDateFilter);
                      setOpenFilter(null);
                    }}
                  >
                    {DATE_FILTER_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <FormControl size="small" fullWidth>
                <InputLabel id="comparison-sort-label">Sort by</InputLabel>
                <Select
                  labelId="comparison-sort-label"
                  label="Sort by"
                  {...getFilterSelectProps("sort")}
                  value={sortBy}
                  onChange={(event) => {
                    setSortBy(event.target.value as ComparisonJobSort);
                    setOpenFilter(null);
                  }}
                >
                  {SORT_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Box className="comparison-job-picker__list" onMouseDown={() => setOpenFilter(null)}>
              {loadingDistances && sortBy === "proximity" && (
                <Box className="comparison-job-picker__loading">
                  <CircularProgress size={18} />
                  <Typography variant="caption">Calculating distances...</Typography>
                </Box>
              )}

              {displayedJobs.length === 0 ? (
                <Typography variant="body2" className="comparison-job-picker__empty">
                  No jobs match the current filters.
                </Typography>
              ) : (
                displayedJobs.map((job) => {
                  const isSelected = job.key === selectedJobKey;
                  const distanceLabel =
                    sortBy === "proximity" || primaryCentroid
                      ? formatComparisonDistance(distancesMiles.get(job.key))
                      : null;

                  return (
                    <button
                      key={job.key}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={[
                        "comparison-job-picker__option",
                        isSelected ? "comparison-job-picker__option--selected" : "",
                      ].join(" ")}
                      onClick={() => handleSelect(job.key)}
                    >
                      <Typography variant="body2" className="comparison-job-picker__option-name" sx={{ color: "var(--st-gray-20)" }}>
                        {job.name}
                      </Typography>
                      <Typography variant="caption" className="comparison-job-picker__option-meta" sx={{ color: "var(--st-gray-50)" }}>
                        {getJobAuthorLabel(job)}
                        {job.start_year != null && job.end_year != null ? ` · ${job.start_year}-${job.end_year}` : ""}
                        {` Submitted ${formatComparisonSubmitted(job)}`}
                        {distanceLabel ? ` · ${distanceLabel}` : ""}
                      </Typography>
                    </button>
                  );
                })
              )}
            </Box>
          </Paper>
        )}
      </Box>
    </ClickAwayListener>
  );
}
