import {
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
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import useStore, { JobStatus } from "../utils/store";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";

import MapIcon from "@mui/icons-material/Map";
import DownloadIcon from "@mui/icons-material/Download";
import "../scss/CurrentJobChip.scss";
import useCurrentJobStore, { PreviewVariableType } from "../utils/currentJobStore";
import { OPENET_TRANSITION_DATE, POST_OPENET_VARIABLE_OPTIONS, PRE_OPENET_VARIABLE_OPTIONS } from "../utils/constants";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import ArrowRightIcon from "@mui/icons-material/ArrowRight";

const CurrentJobChip = () => {
  const [activeJob, setActiveJob] = useStore((state) => [state.activeJob, state.setActiveJob]);
  const closeNewJob = useStore((state) => state.closeNewJob);
  const [previewMode, setPreviewMode] = useStore((state) => [state.previewMode, state.setPreviewMode]);
  const setShowUploadDialog = useStore((state) => state.setShowUploadDialog);
  const loadJob = useStore((state) => state.loadJob);
  const fetchJobStatus = useStore((state) => state.fetchJobStatus);
  const downloadJob = useStore((state) => state.downloadJob);
  const downloadGeotiff = useCurrentJobStore((state) => state.downloadGeotiff);
  const downloadAllGeotiffs = useCurrentJobStore((state) => state.downloadAllGeotiffs);
  const queue = useStore((state) => state.queue);
  const backlog = useStore((state) => state.backlog);

  const [previewMonth, setPreviewMonth] = useCurrentJobStore((state) => [state.previewMonth, state.setPreviewMonth]);
  const [previewYear, setPreviewYear] = useCurrentJobStore((state) => [state.previewYear, state.setPreviewYear]);
  const [showPreview, setShowPreview] = useCurrentJobStore((state) => [state.showPreview, state.setShowPreview]);
  const [previewVariable, setPreviewVariable] = useCurrentJobStore((state) => [
    state.previewVariable,
    state.setPreviewVariable,
  ]);
  const [previewDay, setPreviewDay] = useCurrentJobStore((state) => [state.previewDay, state.setPreviewDay]);
  const currentJobChipRef = useRef<HTMLDivElement>(null);
  const [downloadAnchorEl, setDownloadAnchorEl] = useState<null | HTMLElement>(null);
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false);
  const availableDays = useCurrentJobStore((state) => state.availableDays);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(0);

  const [showJobControls, setShowJobControls] = useState(false);
  const [showProperties, setShowProperties] = useState(false);

  const canPreview = useMemo(() => {
    return !!previewYear && Number(previewYear) && !!previewMonth && Number(previewMonth);
  }, [previewYear, previewMonth]);

  const displayVariableOptions = useMemo(() => {
    if (activeJob?.start_year && Number(activeJob.start_year) < OPENET_TRANSITION_DATE) {
      return PRE_OPENET_VARIABLE_OPTIONS;
    }

    return POST_OPENET_VARIABLE_OPTIONS;
  }, [activeJob?.start_year]);

  const formattedPreviewDate = useMemo(() => {
    return `${new Date(Number(previewYear), Number(previewMonth) - 1).toLocaleString("default", {
      month: "short",
    })} ${previewYear}`;
  }, [previewMonth, previewYear]);

  const liveJob = useMemo(() => {
    let job = queue.find((job) => job.key === activeJob?.key);
    if (!job) {
      job = backlog.find((job) => job.key === activeJob?.key);
    }

    return job;
  }, [queue, backlog, activeJob?.key]);

  useEffect(() => {
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
  }, [activeJob, liveJob, setActiveJob, fetchJobStatus]);

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
    if (activeJob?.status === "Complete") {
      jobStatus.status = "Complete";
    }

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

  // Memoize the month/year calculation to avoid recalculation on every render
  const monthYearFromSlider = useMemo(() => {
    const yearOffset = Math.floor(sliderValue / 12);
    const monthOffset = sliderValue % 12;
    return {
      year: Number(activeJob?.start_year) + yearOffset,
      month: monthOffset + 1,
    };
  }, [sliderValue, activeJob?.start_year]);

  // Update preview month/year only when slider value changes
  useEffect(() => {
    if (monthYearFromSlider.year && monthYearFromSlider.month) {
      setPreviewYear(monthYearFromSlider.year);
      setPreviewMonth(monthYearFromSlider.month);
    }
  }, [monthYearFromSlider, setPreviewYear, setPreviewMonth]);

  const handleSliderChange = (_: Event, newValue: number | number[]) => {
    if (typeof newValue !== "number") return;
    setSliderValue(newValue);
  };

  // Memoize the value label formatter to avoid recreation on every render
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
          {activeJob ? activeJob.name : "No active job"}
          {activeJob && (
            <IconButton
              size="small"
              sx={{ color: "var(--st-gray-30)", padding: 0, marginLeft: "auto" }}
              className="close-btn"
              onClick={() => {
                setActiveJob(null);
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

        {activeJob && (
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

        {activeJob && activeJobProperties.length > 0 && (
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
              onClick={() => setShowJobControls(!showJobControls)}
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
                    marginBottom: 16,
                    marginTop: 16,
                  }}
                >
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
                          <MenuItem value={variable}>{variable}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
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
                    <div style={{ padding: "0 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <IconButton onClick={() => setIsPlaying(!isPlaying)} size="small" sx={{ color: "primary.main" }}>
                          {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                        </IconButton>
                        <Slider
                          value={sliderValue}
                          min={0}
                          max={totalMonths - 1}
                          onChange={handleSliderChange}
                          valueLabelDisplay="auto"
                          valueLabelFormat={valueLabelFormat}
                          marks
                          sx={{ color: "primary", "& .MuiSlider-valueLabel": { backgroundColor: "#334155" } }}
                        />
                      </div>
                    </div>
                  )}
                  <Tooltip title={!canPreview ? `Select a variable and month/year to preview` : ""}>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <Button
                        variant="contained"
                        color="secondary"
                        size="small"
                        sx={{ flex: 1 }}
                        onClick={() => {
                          setShowPreview(!showPreview);
                        }}
                        disabled={!canPreview}
                      >
                        {showPreview ? "Hide" : "Show"} Preview
                      </Button>
                    </div>
                  </Tooltip>
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
                loadJob(activeJob);
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
              onClick={(evt) => {
                setDownloadAnchorEl(evt.currentTarget);
                setDownloadMenuOpen(true);
              }}
            >
              <DownloadIcon fontSize="inherit" />
              Download
            </Button>
            <Menu
              anchorEl={downloadAnchorEl}
              open={downloadMenuOpen}
              onClose={() => setDownloadMenuOpen(false)}
              sx={{ "& .MuiList-root": { backgroundColor: "var(--st-gray-80)" } }}
            >
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

              {canPreview && previewMonth && previewYear && (
                <MenuItem
                  sx={{ backgroundColor: "var(--st-gray-80)" }}
                  disableRipple
                  onClick={() => {
                    if (!previewVariable || !previewMonth || !previewYear) {
                      console.error("Missing preview variable, month, or year");
                      return;
                    }

                    downloadGeotiff(activeJob.key, previewVariable, Number(previewMonth), Number(previewYear));
                  }}
                >
                  {formattedPreviewDate} {previewVariable} GeoTIFF
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

              <MenuItem sx={{ backgroundColor: "var(--st-gray-80)", borderTop: "1px solid var(--st-gray-70)" }} />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ marginLeft: "8px", marginBottom: "4px", backgroundColor: "var(--st-gray-80)" }}
              >
                Report
              </Typography>
              {totalMonths > 0 && (
                <MenuItem
                  sx={{ backgroundColor: "var(--st-gray-80)" }}
                  disableRipple
                  onClick={() => {
                    downloadJob(activeJob.key, false);
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
                    downloadJob(activeJob.key, true);
                  }}
                >
                  Report (in/month)
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
