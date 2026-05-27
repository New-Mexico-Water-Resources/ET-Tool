import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  IconButton,
  Tooltip,
  Typography,
  Menu,
  Slider,
  TextField,
  Checkbox,
  FormControlLabel,
  CircularProgress,
} from "@mui/material";
import PaletteIcon from "@mui/icons-material/Palette";
import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import useStore, { JobStatus } from "../utils/store";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";

import MapIcon from "@mui/icons-material/Map";
import DownloadIcon from "@mui/icons-material/Download";
import "../scss/CurrentJobChip.scss";
import useCurrentJobStore, {
  ClipToPolygonMode,
  PreviewUnitsType,
  PreviewVariableType,
} from "../utils/currentJobStore";
import { OPENET_TRANSITION_DATE } from "../utils/constants";
import {
  POST_OPENET_VARIABLE_OPTIONS,
  PRE_OPENET_VARIABLE_OPTIONS,
  VARIABLE_DISPLAY_NAMES,
} from "../utils/previewCalculations";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useAtomValue } from "jotai";
import { tooltipAtom } from "../utils/atoms";

const CurrentJobChip = () => {
  const [activeJob, setActiveJob] = useStore((state) => [state.activeJob, state.setActiveJob]);
  const activeJobGroup = useStore((state) => state.activeJobGroup);
  const clearJobGroup = useStore((state) => state.clearJobGroup);
  const loadJobGroup = useStore((state) => state.loadJobGroup);
  const downloadJobGroup = useStore((state) => state.downloadJobGroup);
  const downloadingJobGroupId = useStore((state) => state.downloadingJobGroupId);
  const [locations, setLocations] = useStore((state) => [state.locations, state.setLocations]);
  const multipolygons = useStore((state) => state.multipolygons);
  const closeNewJob = useStore((state) => state.closeNewJob);
  const isGroupMode = Boolean(activeJobGroup);
  const hasPreviewClipGeometry = isGroupMode ? multipolygons.length > 0 : Boolean(activeJob?.loaded_geo_json);
  const [previewMode, setPreviewMode] = useStore((state) => [state.previewMode, state.setPreviewMode]);
  const setShowUploadDialog = useStore((state) => state.setShowUploadDialog);
  const loadJob = useStore((state) => state.loadJob);
  const fetchJobStatus = useStore((state) => state.fetchJobStatus);
  const downloadJob = useStore((state) => state.downloadJob);
  const downloadGeotiff = useCurrentJobStore((state) => state.downloadGeotiff);
  const downloadAllGeotiffs = useCurrentJobStore((state) => state.downloadAllGeotiffs);
  const previewGeotiffDownloadJobId = useCurrentJobStore((state) => state.previewGeotiffDownloadJobId);
  const bulkGeotiffDownloadJobId = useCurrentJobStore((state) => state.bulkGeotiffDownloadJobId);
  const isPreviewGeotiffDownloading =
    previewGeotiffDownloadJobId !== null && previewGeotiffDownloadJobId === activeJob?.key;
  const isBulkGeotiffDownloading =
    bulkGeotiffDownloadJobId !== null && bulkGeotiffDownloadJobId === activeJob?.key;
  const queue = useStore((state) => state.queue);
  const backlog = useStore((state) => state.backlog);

  const [previewMonth, setPreviewMonth] = useCurrentJobStore((state) => [state.previewMonth, state.setPreviewMonth]);
  const [previewYear, setPreviewYear] = useCurrentJobStore((state) => [state.previewYear, state.setPreviewYear]);
  const [showPreview, setShowPreview] = useCurrentJobStore((state) => [state.showPreview, state.setShowPreview]);
  const [previewVariable, setPreviewVariable] = useCurrentJobStore((state) => [
    state.previewVariable,
    state.setPreviewVariable,
  ]);
  const [previewUnits, setPreviewUnits] = useCurrentJobStore((state) => [state.previewUnits, state.setPreviewUnits]);
  const [previewDay, setPreviewDay] = useCurrentJobStore((state) => [state.previewDay, state.setPreviewDay]);
  const currentJobChipRef = useRef<HTMLDivElement>(null);
  const [downloadAnchorEl, setDownloadAnchorEl] = useState<null | HTMLElement>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const availableDays = useCurrentJobStore((state) => state.availableDays);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(0);

  const [showJobControls, setShowJobControls] = useState(false);
  const [showProperties, setShowProperties] = useState(false);

  useEffect(() => {
    if (activeJob && showPreview) {
      setShowJobControls(true);
    }
  }, [activeJob?.key, showPreview]);

  const [dynamicPreviewColorScale, setDynamicPreviewColorScale] = useCurrentJobStore((state) => [
    state.dynamicPreviewColorScale,
    state.setDynamicPreviewColorScale,
  ]);
  const [previewMinValue, setPreviewMinValue] = useCurrentJobStore((state) => [state.previewMin, state.setPreviewMin]);
  const [previewMaxValue, setPreviewMaxValue] = useCurrentJobStore((state) => [state.previewMax, state.setPreviewMax]);
  const [previewOpacity, setPreviewOpacity] = useCurrentJobStore((state) => [state.previewOpacity, state.setPreviewOpacity]);
  const [clipToPolygon, setClipToPolygon] = useCurrentJobStore((state) => [state.clipToPolygon, state.setClipToPolygon]);
  const [clipToPolygonMode, setClipToPolygonMode] = useCurrentJobStore((state) => [
    state.clipToPolygonMode,
    state.setClipToPolygonMode,
  ]);

  const tooltip = useAtomValue(tooltipAtom);

  const canPreview = useMemo(() => {
    return !!previewYear && Number(previewYear) && !!previewMonth && Number(previewMonth);
  }, [previewYear, previewMonth]);

  const hasPreviewScaleValue = (value: number | string | null) => value !== null && value !== "";

  const displayVariableOptions = useMemo(() => {
    if (activeJob?.start_year && Number(activeJob.start_year) < OPENET_TRANSITION_DATE) {
      return PRE_OPENET_VARIABLE_OPTIONS;
    }

    return POST_OPENET_VARIABLE_OPTIONS;
  }, [activeJob?.start_year]);

  const liveJob = useMemo(() => {
    if (isGroupMode) {
      return null;
    }

    let job = queue.find((job) => job.key === activeJob?.key);
    if (!job) {
      job = backlog.find((job) => job.key === activeJob?.key);
    }

    return job;
  }, [queue, backlog, activeJob?.key, isGroupMode]);

  const isGroupDownloading = Boolean(
    isGroupMode && activeJobGroup && downloadingJobGroupId === activeJobGroup.groupId
  );

  useEffect(() => {
    if (isGroupMode) {
      return;
    }

    const interval = setInterval(() => {
      if (activeJob && activeJob?.status !== "Complete") {
        const jobStatusRequest = fetchJobStatus(activeJob.key, activeJob.name);
        if (!jobStatusRequest) {
          return;
        }

        jobStatusRequest
          .then(() => {
            if (liveJob?.status && activeJob.status !== liveJob?.status) {
              setActiveJob(liveJob);
            }
          })
          .catch((error) => {
            console.error("Error fetching job status", error);
          });
      }
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [activeJob, liveJob, setActiveJob, fetchJobStatus, isGroupMode]);

  useEffect(() => {
    if (activeJob?.start_year && activeJob?.end_year) {
      if (!previewMonth) {
        setPreviewMonth(1);
      }
      if (!previewYear) {
        setPreviewYear(Number(activeJob.start_year));
      }
    }
  }, [activeJob, previewMonth, previewYear, setPreviewYear, setPreviewMonth]);

  const jobStatuses = useStore((state) => state.jobStatuses);
  const jobStatus = useMemo(() => {
    let jobStatus: JobStatus = jobStatuses[activeJob?.key];

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

    if (activeJob?.status === "Complete") {
      jobStatus.status = "Complete";
    }

    return jobStatus;
  }, [activeJob?.key, activeJob?.status, jobStatuses]);

  const activeJobProperties: { property: string; value: unknown }[] = useMemo(() => {
    if (!activeJob?.loaded_geo_json) return [];

    let properties = {};
    const features = activeJob.loaded_geo_json?.features;
    if (features && features.length > 0) {
      properties = activeJob.loaded_geo_json.features[0].properties;
    } else if (!features && activeJob.loaded_geo_json?.properties) {
      properties = activeJob.loaded_geo_json.properties;
    }

    return Object.entries(properties).map(([key, value]) => {
      const propertyName = key
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
      return { property: propertyName, value };
    });
  }, [activeJob?.loaded_geo_json]);

  const totalMonths = useMemo(() => {
    if (!activeJob?.start_year || !activeJob?.end_year) {
      return 0;
    }

    return (activeJob.end_year - activeJob.start_year + 1) * 12;
  }, [activeJob?.start_year, activeJob?.end_year]);

  const monthYearFromSlider = useMemo(() => {
    const yearOffset = Math.floor(sliderValue / 12);
    const monthOffset = sliderValue % 12;
    return {
      year: Number(activeJob?.start_year) + yearOffset,
      month: monthOffset + 1,
    };
  }, [sliderValue, activeJob?.start_year]);

  useEffect(() => {
    if (monthYearFromSlider.year && monthYearFromSlider.month) {
      setPreviewYear(monthYearFromSlider.year);
      setPreviewMonth(monthYearFromSlider.month);
    }
  }, [monthYearFromSlider, setPreviewYear, setPreviewMonth]);

  useEffect(() => {
    if (!activeJob?.start_year || !previewYear || !previewMonth || totalMonths <= 0) {
      return;
    }
    const idx = (Number(previewYear) - Number(activeJob.start_year)) * 12 + (Number(previewMonth) - 1);
    const clamped = Math.max(0, Math.min(totalMonths - 1, idx));
    setSliderValue((prev) => (prev === clamped ? prev : clamped));
  }, [previewMonth, previewYear, activeJob?.start_year, totalMonths]);

  const handleSliderChange = (_: Event, newValue: number | number[]) => {
    if (typeof newValue !== "number") {
      return;
    }
    setSliderValue(newValue);
  };

  const valueLabelFormat = useCallback(
    (value: number) => {
      const yearOffset = Math.floor(value / 12);
      const monthOffset = value % 12;
      const year = Number(activeJob?.start_year) + yearOffset;
      const month = monthOffset + 1;
      return `${new Date(year, month - 1).toLocaleString("default", { month: "short" })} ${year}`;
    },
    [activeJob?.start_year]
  );

  const visibleLayerCount = useMemo(() => {
    return locations.filter((location) => location.visible).length;
  }, [locations]);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    if (isPlaying) {
      intervalId = setInterval(() => {
        setSliderValue((prevValue) => {
          const nextValue = prevValue + 1;
          if (nextValue >= totalMonths) {
            setIsPlaying(false);
            return 0;
          }
          return nextValue;
        });
      }, 300);
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [isPlaying, totalMonths]);

  const stepPreviewMonth = useCallback(
    (delta: number) => {
      if (totalMonths <= 0) {
        return;
      }
      setIsPlaying(false);
      setShowPreview(true);
      setSliderValue((prev) => {
        const next = prev + delta;
        if (next < 0) {
          return 0;
        }
        if (next >= totalMonths) {
          return totalMonths - 1;
        }
        return next;
      });
    },
    [totalMonths, setShowPreview]
  );

  const toggleShowPreview = useCallback(() => {
    tooltip?.close();
    if (isPlaying) {
      setIsPlaying(false);
      setTimeout(() => {
        setShowPreview(false);
        tooltip?.close();
      }, 500);
    } else {
      setShowPreview(!showPreview);
    }
  }, [isPlaying, showPreview, setShowPreview, tooltip]);

  return (
    <>
      <div className="current-job" ref={currentJobChipRef}>
        <Typography
          variant="body1"
          style={{
            color: "var(--st-gray-30)",
            fontWeight: "bold",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            minWidth: activeJob ? "225px" : "auto",
          }}
        >
          {isGroupMode ? activeJobGroup?.groupName : activeJob ? activeJob.name : "No active job"}
          {activeJob && (
            <IconButton
              size="small"
              sx={{ color: "var(--st-gray-30)", padding: 0, marginLeft: "auto" }}
              className="close-btn"
              onClick={() => {
                if (isGroupMode) {
                  clearJobGroup();
                } else {
                  setActiveJob(null);
                }
                closeNewJob();
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </Typography>
        {activeJob && (
          <Typography variant="body2" style={{ color: "var(--st-gray-40)" }}>
            Years:{" "}
            <b>
              {activeJob.start_year} - {activeJob.end_year}
            </b>
          </Typography>
        )}

        {isGroupMode && activeJobGroup && (
          <Typography variant="body2" style={{ color: "var(--st-gray-40)" }}>
            Jobs in group: <b>{activeJobGroup.jobs.length}</b>
          </Typography>
        )}

        {isGroupMode && locations.length > 0 && (
          <div
            className="group-layers-panel"
            style={{
              maxHeight: "140px",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              border: "1px solid var(--st-gray-80)",
              borderRadius: "6px",
              marginTop: "4px",
            }}
          >
            <Accordion
              disableGutters
              elevation={0}
              sx={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minHeight: 0,
                backgroundColor: "transparent",
                color: "var(--st-gray-20)",
                "&:before": { display: "none" },
                "&.Mui-focusVisible": { outline: "none", boxShadow: "none" },
                "&:focus": { outline: "none" },
                "&:focus-visible": { outline: "none", boxShadow: "none" },
                overflow: "hidden",
                "& .MuiCollapse-root.MuiCollapse-entered": {
                  overflow: "auto",
                  minHeight: 0,
                  flex: "1 1 auto",
                },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon sx={{ color: "var(--st-gray-40)" }} />}
                sx={{
                  flexShrink: 0,
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  minHeight: "32px",
                  px: 1,
                  backgroundColor: "var(--st-gray-90)",
                  "& .MuiAccordionSummary-content": { my: 0.5 },
                  "&.Mui-focusVisible": {
                    outline: "none",
                    boxShadow: "none",
                    backgroundColor: "var(--st-gray-90)",
                  },
                  "&:focus": { outline: "none" },
                  "&:focus-visible": { outline: "none", boxShadow: "none" },
                  "& .MuiAccordionSummary-expandIconWrapper": { color: "var(--st-gray-40)" },
                }}
              >
                <Typography variant="caption" sx={{ color: "var(--st-gray-40)" }}>
                  Layers ({visibleLayerCount}/{locations.length})
                </Typography>
              </AccordionSummary>
              <AccordionDetails
                sx={{
                  pt: 0,
                  pb: 0.5,
                  px: 1,
                }}
              >
                {locations.map((location) => (
                  <FormControlLabel
                    key={location.id}
                    sx={{ color: "var(--st-gray-20)", ml: 0, display: "flex" }}
                    control={
                      <Checkbox
                        size="small"
                        checked={location.visible}
                        onChange={(event) => {
                          const nextLocations = locations.map((row) =>
                            row.id === location.id ? { ...row, visible: event.target.checked } : row
                          );
                          setLocations(nextLocations);
                        }}
                      />
                    }
                    label={location.name}
                  />
                ))}
              </AccordionDetails>
            </Accordion>
          </div>
        )}

        {activeJob && !isGroupMode && (
          <Tooltip title={jobStatus?.status || "N/A"}>
            <Typography
              variant="body2"
              style={{ color: "var(--st-gray-40)", display: "flex", alignItems: "center", gap: "4px" }}
            >
              Status:{" "}
              <b
                style={{
                  maxWidth: "178px",
                  display: "inline-block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "pre",
                }}
              >
                {jobStatus?.status || "N/A"}
              </b>
            </Typography>
          </Tooltip>
        )}

        {activeJob && !isGroupMode && activeJobProperties.length > 0 && (
          <div
            onClick={() => setShowProperties(!showProperties)}
            style={{
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              borderBottom: !showProperties ? "1px solid var(--st-gray-70)" : "none",
            }}
          >
            <IconButton sx={{ color: "var(--st-gray-40)" }}>
              {!showProperties ? <ArrowRightIcon /> : <ArrowDropDownIcon />}
            </IconButton>
            <Typography variant="body2" style={{ color: "var(--st-gray-40)" }}>
              Properties
            </Typography>
          </div>
        )}
        {showProperties && activeJob && activeJobProperties.length > 0 && (
          <div
            style={{
              maxHeight: "300px",
              maxWidth: "400px",
              overflow: "auto",
              border: "2px solid #404243",
              borderRadius: "8px",
              padding: "4px",
              textOverflow: "ellipsis",
              whiteSpace: "pre",
              marginBottom: "4px",
            }}
          >
            {activeJobProperties.map((property, index) => (
              <Typography key={index} variant="body2" style={{ color: "var(--st-gray-40)" }}>
                {property.property}: <b>{property.value as string}</b>
              </Typography>
            ))}
          </div>
        )}

        {previewMode && activeJob && (
          <Button
            sx={{ margin: "8px 0" }}
            variant="contained"
            onClick={() => {
              setPreviewMode(false);
              setActiveJob(null);
              setShowUploadDialog(true);
            }}
          >
            Continue Editing
          </Button>
        )}
        <div className="job-controls-container">
          {activeJob && (
            <div
              className="job-controls-header"
              onClick={() => {
                if (!showJobControls) {
                  setShowPreview(true);
                }

                setShowJobControls(!showJobControls)
              }}
              style={{
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
              }}
            >
              <IconButton sx={{ color: "var(--st-gray-40)" }}>
                {!showJobControls ? <ArrowRightIcon /> : <ArrowDropDownIcon />}
              </IconButton>
              <Typography variant="body2" style={{ color: "var(--st-gray-40)" }}>
                Interactive Preview
              </Typography>
            </div>
          )}
          {activeJob && showJobControls && (
            <div className="job-controls">
              {activeJob && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    backgroundColor: "var(--st-gray-90)",
                    zIndex: 1000,
                    borderRadius: "8px",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "8px" }}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <div style={{ display: "flex", gap: "8px", flex: 1, alignItems: "center" }}>
                        <FormControl disabled={dynamicPreviewColorScale}>
                          <TextField
                            disabled={dynamicPreviewColorScale}
                            label="Min"
                            type="number"
                            sx={{ width: "120px", "& .MuiInputLabel-root": { fontSize: "12px" } }}
                            placeholder="Min"
                            size="small"
                            value={previewMinValue ?? ""}
                            InputLabelProps={{ shrink: hasPreviewScaleValue(previewMinValue) }}
                            onChange={(e) => setPreviewMinValue(e.target.value)}
                          />
                        </FormControl>
                        <FormControl
                          disabled={dynamicPreviewColorScale}
                          sx={{ display: "flex", flexDirection: "row", alignItems: "flex-end" }}
                        >
                          <TextField
                            disabled={dynamicPreviewColorScale}
                            label="Max"
                            type="number"
                            sx={{ width: "120px", "& .MuiInputLabel-root": { fontSize: "12px" } }}
                            placeholder="Max"
                            size="small"
                            value={previewMaxValue ?? ""}
                            InputLabelProps={{ shrink: hasPreviewScaleValue(previewMaxValue) }}
                            onChange={(e) => setPreviewMaxValue(e.target.value)}
                          />
                          <Tooltip
                            title={
                              dynamicPreviewColorScale
                                ? "Use custom color scale"
                                : "Use dynamic color scale relative to visible layer"
                            }
                          >
                            <IconButton onClick={() => setDynamicPreviewColorScale(!dynamicPreviewColorScale)}>
                              <PaletteIcon sx={{ color: dynamicPreviewColorScale ? "var(--st-gray-30)" : "white" }} />
                              {dynamicPreviewColorScale && (
                                <svg
                                  style={{
                                    position: "absolute",
                                    width: "50%",
                                    height: "50%",
                                    pointerEvents: "none",
                                  }}
                                >
                                  <line x1="0" y1="100%" x2="100%" y2="0" stroke="var(--st-gray-30)" strokeWidth="2" />
                                </svg>
                              )}
                            </IconButton>
                          </Tooltip>
                        </FormControl>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <FormControl sx={{ flex: 1 }}>
                        <InputLabel size="small">Variable</InputLabel>
                        <Select
                          label="Variable"
                          size="small"
                          value={previewVariable}
                          onChange={(e) => setPreviewVariable(e.target.value as PreviewVariableType)}
                        >
                          {displayVariableOptions.map((variable) => (
                            <MenuItem key={variable} value={variable}>
                              {VARIABLE_DISPLAY_NAMES[variable as keyof typeof VARIABLE_DISPLAY_NAMES] || variable}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <FormControl sx={{ flex: 1 }}>
                        <InputLabel size="small">Units</InputLabel>
                        <Select
                          label="Units"
                          size="small"
                          value={previewUnits}
                          onChange={(e) => setPreviewUnits(e.target.value as PreviewUnitsType)}
                        >
                          <MenuItem value="mm">mm</MenuItem>
                          <MenuItem value="inches">inches</MenuItem>
                        </Select>
                      </FormControl>
                    </div>
                    {hasPreviewClipGeometry && (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <FormControlLabel
                          sx={{ margin: 0, marginLeft: "-4px" }}
                          control={
                            <Checkbox
                              size="small"
                              checked={clipToPolygon}
                              onChange={(e) => setClipToPolygon(e.target.checked)}
                              sx={{ color: "var(--st-gray-40)", "&.Mui-checked": { color: "primary.main" } }}
                            />
                          }
                          label={
                            <Typography variant="caption" sx={{ color: "var(--st-gray-40)" }}>
                              Clip to polygon
                            </Typography>
                          }
                        />
                        <FormControl size="small" disabled={!clipToPolygon} sx={{ minWidth: "110px", flex: 1 }}>
                          <Select
                            size="small"
                            value={clipToPolygonMode}
                            disabled={!clipToPolygon}
                            onChange={(e) => setClipToPolygonMode(e.target.value as ClipToPolygonMode)}
                            sx={{
                              "& .MuiSelect-select": { fontSize: "12px", py: "4px" },
                              color: clipToPolygon ? "var(--st-gray-30)" : "var(--st-gray-60)",
                            }}
                          >
                            <MenuItem value="inclusive">Inclusive</MenuItem>
                            <MenuItem value="exclusive">Exclusive</MenuItem>
                            <MenuItem value="inverse">Inverse</MenuItem>
                          </Select>
                        </FormControl>
                      </div>
                    )}
                  </div>
                  {availableDays &&
                    availableDays.length > 0 &&
                    activeJob?.start_year < OPENET_TRANSITION_DATE &&
                    previewYear &&
                    Number(previewYear) < OPENET_TRANSITION_DATE && (
                      <FormControl sx={{ flex: 1 }}>
                        <InputLabel size="small">Day</InputLabel>
                        <Select label="Day" size="small" value={previewDay} onChange={(e) => setPreviewDay(e.target.value)}>
                          {(availableDays || []).map((day) => (
                            <MenuItem value={day.day}>{day.day}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  <div style={{ display: "flex", gap: "8px" }}>
                    <FormControl sx={{ flex: 1 }}>
                      <InputLabel size="small">Month</InputLabel>
                      <Select
                        label="Month"
                        size="small"
                        value={previewMonth}
                        onChange={(e) => setPreviewMonth(e.target.value)}
                      >
                        <MenuItem value={1}>January</MenuItem>
                        <MenuItem value={2}>February</MenuItem>
                        <MenuItem value={3}>March</MenuItem>
                        <MenuItem value={4}>April</MenuItem>
                        <MenuItem value={5}>May</MenuItem>
                        <MenuItem value={6}>June</MenuItem>
                        <MenuItem value={7}>July</MenuItem>
                        <MenuItem value={8}>August</MenuItem>
                        <MenuItem value={9}>September</MenuItem>
                        <MenuItem value={10}>October</MenuItem>
                        <MenuItem value={11}>November</MenuItem>
                        <MenuItem value={12}>December</MenuItem>
                      </Select>
                    </FormControl>
                    {previewYear && (
                      <FormControl sx={{ flex: 1 }}>
                        <InputLabel size="small">Year</InputLabel>
                        <Select
                          label="Year"
                          size="small"
                          value={previewYear}
                          onChange={(e) => setPreviewYear(e.target.value)}
                        >
                          {Array.from(
                            { length: activeJob.end_year - activeJob.start_year + 1 },
                            (_, i) => activeJob.start_year + i
                          ).map((year) => (
                            <MenuItem value={year}>{year}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </div>
                  {canPreview && (
                    <div style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <Tooltip title="Previous month">
                          <span>
                            <IconButton
                              onClick={() => stepPreviewMonth(-1)}
                              size="small"
                              disabled={totalMonths <= 1 || sliderValue <= 0}
                              sx={{ color: "primary.main", padding: 0 }}
                            >
                              <ChevronLeftIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <IconButton
                          onClick={() => {
                            if (!isPlaying) {
                              setShowPreview(true);
                              setTimeout(() => {
                                setIsPlaying(true);
                              }, 100);
                            } else {
                              setIsPlaying(false);
                            }
                          }}
                          size="small"
                          sx={{ color: "primary.main", padding: 0 }}
                        >
                          {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                        </IconButton>
                        <Tooltip title="Next month">
                          <span>
                            <IconButton
                              onClick={() => stepPreviewMonth(1)}
                              size="small"
                              disabled={totalMonths <= 1 || sliderValue >= totalMonths - 1}
                              sx={{ color: "primary.main", padding: 0 }}
                            >
                              <ChevronRightIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Slider
                          value={sliderValue}
                          min={0}
                          max={Math.max(0, totalMonths - 1)}
                          onChange={handleSliderChange}
                          valueLabelDisplay="auto"
                          valueLabelFormat={valueLabelFormat}
                          marks
                          sx={{
                            flex: 1,
                            color: "primary",
                            "& .MuiSlider-valueLabel": { backgroundColor: "#334155" },
                            marginLeft: "8px",
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", paddingLeft: "4px" }}>
                        <Typography
                          variant="caption"
                          sx={{
                            color: showPreview ? "var(--st-gray-40)" : "var(--st-gray-60)",
                            minWidth: "52px",
                          }}
                        >
                          Opacity
                        </Typography>
                        <Slider
                          size="small"
                          disabled={!showPreview}
                          value={Math.round(previewOpacity * 100)}
                          min={0}
                          max={100}
                          onChange={(_, v) => setPreviewOpacity((typeof v === "number" ? v : v[0]) / 100)}
                          valueLabelDisplay={showPreview ? "auto" : "off"}
                          valueLabelFormat={(v) => `${v}%`}
                          sx={{
                            flex: 1,
                            color: "primary",
                            "& .MuiSlider-valueLabel": { backgroundColor: "#334155" },
                          }}
                        />
                        <Tooltip title={showPreview ? "Hide preview" : "Show preview"}>
                          <span>
                            <IconButton
                              size="small"
                              onClick={toggleShowPreview}
                              sx={{ color: showPreview ? "primary.main" : "var(--st-gray-50)", padding: "4px" }}
                            >
                              {showPreview ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}
                            </IconButton>
                          </span>
                        </Tooltip>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {activeJob && (
          <div style={{ display: "flex", gap: "8px", margin: "8px 0" }}>
            <Button
              sx={{ fontSize: "12px", flex: 1, display: "flex", alignItems: "center", gap: "4px" }}
              size="small"
              variant="contained"
              color="secondary"
              onClick={() => {
                if (isGroupMode && activeJobGroup) {
                  loadJobGroup(activeJobGroup.jobs, activeJobGroup.groupName).then(() => {
                    setShowPreview(true);
                    if (activeJob?.start_year) {
                      setPreviewYear(activeJob.start_year);
                    }
                    setPreviewMonth(1);
                  });
                } else {
                  loadJob(activeJob);
                }
              }}
            >
              <MapIcon fontSize="inherit" />
              Locate
            </Button>
            <Button
              sx={{ fontSize: "12px", flex: 1, display: "flex", alignItems: "center", gap: "4px" }}
              size="small"
              variant="contained"
              color="secondary"
              disabled={isGroupDownloading}
              onClick={(evt) => {
                if (isGroupMode && activeJobGroup) {
                  setDownloadAnchorEl(evt.currentTarget);
                  setDownloadMenuOpen(true);
                  return;
                }
                setDownloadAnchorEl(evt.currentTarget);
                setDownloadMenuOpen(true);
              }}
            >
              {isGroupDownloading ? <CircularProgress size={14} /> : <DownloadIcon fontSize="inherit" />}
              Download
            </Button>
            <Menu
              anchorEl={downloadAnchorEl}
              open={downloadMenuOpen}
              onClose={() => setDownloadMenuOpen(false)}
              sx={{ "& .MuiList-root": { backgroundColor: "var(--st-gray-80)" } }}
            >
              {!isGroupMode && (
                <>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ marginLeft: "8px", marginBottom: "4px", backgroundColor: "var(--st-gray-80)" }}
                  >
                    Map Data
                  </Typography>
                  <MenuItem
                    sx={{ backgroundColor: "var(--st-gray-80)" }}
                    disableRipple
                    onClick={() => {
                      if (!activeJob?.loaded_geo_json) {
                        return;
                      }

                      const blob = new Blob([JSON.stringify(activeJob.loaded_geo_json)], { type: "application/json" });
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;

                      const shortName = activeJob.name.replace(/[(),]/g, "");
                      const escapedName = encodeURIComponent(shortName);
                      a.download = `${escapedName}.geojson`;
                      a.click();
                    }}
                  >
                    GeoJSON
                  </MenuItem>

                  {canPreview && previewMonth && previewYear && previewVariable && (
                    <MenuItem
                      sx={{ backgroundColor: "var(--st-gray-80)" }}
                      disableRipple
                      disabled={isPreviewGeotiffDownloading}
                      onClick={() => {
                        downloadGeotiff(activeJob.key);
                      }}
                    >
                      {isPreviewGeotiffDownloading && <CircularProgress size={16} sx={{ marginRight: "8px" }} />}
                      Interactive Preview GeoTIFF
                    </MenuItem>
                  )}

                  <MenuItem
                    sx={{ backgroundColor: "var(--st-gray-80)" }}
                    disableRipple
                    onClick={() => {
                      if (!previewVariable || !previewMonth || !previewYear) {
                        console.error("Missing preview variable, month, or year");
                        return;
                      }

                      downloadAllGeotiffs(activeJob.key);
                    }}
                  >
                    All GeoTIFFs
                  </MenuItem>

                  <MenuItem
                    sx={{ backgroundColor: "var(--st-gray-80)" }}
                    disableRipple
                    disabled={isBulkGeotiffDownloading}
                    onClick={() => {
                      downloadAllGeotiffs(activeJob.key, { clipped: true });
                    }}
                  >
                    {isBulkGeotiffDownloading && <CircularProgress size={16} sx={{ marginRight: "8px" }} />}
                    All GeoTIFFs (clipped)
                  </MenuItem>

                  <MenuItem sx={{ backgroundColor: "var(--st-gray-80)", borderTop: "1px solid var(--st-gray-70)" }} />
                </>
              )}
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ marginLeft: "8px", marginBottom: "4px", backgroundColor: "var(--st-gray-80)" }}
              >
                {isGroupMode ? "Group download" : "Report"}
              </Typography>
              {totalMonths > 0 && (
                <MenuItem
                  sx={{ backgroundColor: "var(--st-gray-80)" }}
                  disableRipple
                  onClick={() => {
                    if (isGroupMode && activeJobGroup) {
                      downloadJobGroup(activeJobGroup.jobs, activeJobGroup.groupName, "metric");
                    } else {
                      downloadJob(activeJob.key, "metric");
                    }
                    setDownloadMenuOpen(false);
                  }}
                >
                  Report (mm/month)
                </MenuItem>
              )}
              {totalMonths > 0 && (
                <MenuItem
                  sx={{ backgroundColor: "var(--st-gray-80)" }}
                  disableRipple
                  onClick={() => {
                    if (isGroupMode && activeJobGroup) {
                      downloadJobGroup(activeJobGroup.jobs, activeJobGroup.groupName, "imperial");
                    } else {
                      downloadJob(activeJob.key, "imperial");
                    }
                    setDownloadMenuOpen(false);
                  }}
                >
                  Report (in/month)
                </MenuItem>
              )}
              {totalMonths > 0 && (
                <MenuItem
                  sx={{ backgroundColor: "var(--st-gray-80)" }}
                  disableRipple
                  onClick={() => {
                    if (isGroupMode && activeJobGroup) {
                      downloadJobGroup(activeJobGroup.jobs, activeJobGroup.groupName, "acre-feet");
                    } else {
                      downloadJob(activeJob.key, "acre-feet");
                    }
                    setDownloadMenuOpen(false);
                  }}
                >
                  Report (acre-feet/month)
                </MenuItem>
              )}
            </Menu>
          </div>
        )}
      </div>
    </>
  );
};

export default CurrentJobChip;
