import { Button, FormControl, InputLabel, MenuItem, Select, IconButton, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import useStore, { JobStatus } from "../utils/store";
import { useEffect, useMemo } from "react";

import "../scss/CurrentJobChip.scss";
import useCurrentJobStore, { PreviewVariableType } from "../utils/currentJobStore";
import { API_URL } from "../utils/constants";

const CurrentJobChip = () => {
  const [activeJob, setActiveJob] = useStore((state) => [state.activeJob, state.setActiveJob]);
  const closeNewJob = useStore((state) => state.closeNewJob);
  const [previewMode, setPreviewMode] = useStore((state) => [state.previewMode, state.setPreviewMode]);
  const setShowUploadDialog = useStore((state) => state.setShowUploadDialog);
  const loadJob = useStore((state) => state.loadJob);
  const fetchJobStatus = useStore((state) => state.fetchJobStatus);

  const queue = useStore((state) => state.queue);
  const backlog = useStore((state) => state.backlog);

  const [previewMonth, setPreviewMonth] = useCurrentJobStore((state) => [state.previewMonth, state.setPreviewMonth]);
  const [previewYear, setPreviewYear] = useCurrentJobStore((state) => [state.previewYear, state.setPreviewYear]);
  const [showPreview, setShowPreview] = useCurrentJobStore((state) => [state.showPreview, state.setShowPreview]);
  const setCurrentJob = useCurrentJobStore((state) => state.setCurrentJob);
  const [previewVariable, setPreviewVariable] = useCurrentJobStore((state) => [
    state.previewVariable,
    state.setPreviewVariable,
  ]);

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
  }, [activeJob, liveJob]);

  useEffect(() => {
    if (activeJob?.start_year && activeJob?.end_year) {
      if (!previewMonth) {
        setPreviewMonth(1);
      }
      if (!previewYear) {
        setPreviewYear(activeJob.start_year);
      }
    }
  }, [activeJob, previewMonth, previewYear]);

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

  const activeJobProperties: { property: string; value: any }[] = useMemo(() => {
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

  return (
    <div className="current-job">
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
        <Typography variant="body1" style={{ color: "var(--st-gray-40)", marginTop: "8px" }}>
          Properties:
        </Typography>
      )}
      {activeJob && activeJobProperties.length > 0 && (
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
              {property.property}: <b>{property.value}</b>
            </Typography>
          ))}
        </div>
      )}

      {previewMode && (
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
      {activeJob && (
        <div style={{ display: "flex", gap: "8px", margin: "8px 0" }}>
          <Button
            sx={{ fontSize: "12px" }}
            size="small"
            variant="contained"
            color="secondary"
            onClick={() => {
              loadJob(activeJob);
            }}
          >
            Locate
          </Button>
          <Button
            sx={{ fontSize: "12px" }}
            size="small"
            variant="contained"
            color="secondary"
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
            Download GeoJSON
          </Button>
        </div>
      )}
      {activeJob && activeJob.status === "Complete" && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "8px", margin: "8px 0", width: "100%", marginTop: "16px" }}
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
                <MenuItem value="ET">ET</MenuItem>
                <MenuItem value="PET">PET</MenuItem>
                <MenuItem value="ET_MIN">ET_MIN</MenuItem>
              </Select>
            </FormControl>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <FormControl sx={{ flex: 1 }}>
              <InputLabel size="small">Month</InputLabel>
              <Select label="Month" size="small" value={previewMonth} onChange={(e) => setPreviewMonth(e.target.value)}>
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
            <FormControl sx={{ flex: 1 }}>
              <InputLabel size="small">Year</InputLabel>
              <Select label="Year" size="small" value={previewYear} onChange={(e) => setPreviewYear(e.target.value)}>
                {Array.from(
                  { length: activeJob.end_year - activeJob.start_year + 1 },
                  (_, i) => activeJob.start_year + i
                ).map((year) => (
                  <MenuItem value={year}>{year}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button
              variant="contained"
              color="secondary"
              size="small"
              sx={{ flex: 1 }}
              onClick={() => {
                if (!showPreview) {
                  // Set current job
                  setCurrentJob(activeJob);
                }
                setShowPreview(!showPreview);
              }}
            >
              {showPreview ? "Hide" : "Preview"} TIFF
            </Button>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button
              variant="contained"
              color="secondary"
              size="small"
              sx={{ flex: 1 }}
              onClick={() => {
                const tiffUrl = `${API_URL}/historical/monthly_geojson?key=${activeJob.key}&month=${previewMonth}&year=${previewYear}&variable=${previewVariable}`;
                window.open(tiffUrl, "_blank");
              }}
            >
              Download TIFF
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CurrentJobChip;
