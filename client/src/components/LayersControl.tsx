import {
  Button,
  FormControl,
  IconButton,
  Input,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Slider,
  Typography,
} from "@mui/material";
import CheckBoxIcon from "@mui/icons-material/CheckBox";
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import MapIcon from "@mui/icons-material/Map";
import CloseIcon from "@mui/icons-material/Close";
import useStore, { PolygonLocation } from "../utils/store";
import { ChangeEvent, FC, useCallback, useMemo, useState } from "react";
import { FixedSizeList as List } from "react-window";

import "../scss/LayersControl.scss";
import { useDropzone } from "react-dropzone";
import AutoSizer from "react-virtualized-auto-sizer";
import { formatElapsedTime } from "../utils/helpers";
import { useConfirm } from "material-ui-confirm";
import { area as turfArea } from "@turf/turf";

import ErrorIcon from "@mui/icons-material/Error";
import EditIcon from "@mui/icons-material/Edit";

const LayersControl: FC = () => {
  const minimumValidArea = useStore((state) => state.minimumValidArea);
  const maximumValidArea = useStore((state) => state.maximumValidArea);
  const [activeJob, setActiveJob] = useStore((state) => [state.activeJob, state.setActiveJob]);

  const [multipolygons, setMultipolygons] = useStore((state) => [state.multipolygons, state.setMultipolygons]);
  const [loadedGeoJSON, setLoadedGeoJSON] = useStore((state) => [state.loadedGeoJSON, state.setLoadedGeoJSON]);

  const [rows, setRows] = useStore((state) => [state.locations, state.setLocations]);

  const loadedGeoJSONArea = useMemo(() => {
    let area = 0;
    if (!loadedGeoJSON && multipolygons.length === 0) {
      return 0;
    }

    if (loadedGeoJSON) {
      area = turfArea(loadedGeoJSON);
    } else {
      let visiblePolygons: any[] = [];
      rows.forEach((row) => {
        if (row.visible) {
          visiblePolygons.push(multipolygons[row.id]);
        }
      });

      area = visiblePolygons.reduce((acc, geojson) => acc + turfArea(geojson), 0);
    }

    if (area < 0) {
      area = 0;
    }

    return area;
  }, [loadedGeoJSON, multipolygons, rows]);

  const visibleLayerCount = useMemo(() => {
    return rows.reduce((acc, row) => (row.visible ? acc + 1 : acc), 0);
  }, [rows]);

  const roundedLoadedGeoJSONArea = useMemo(() => {
    let convertedArea = loadedGeoJSONArea;
    if (convertedArea > 0) {
      convertedArea = convertedArea / 4046.86;
    }

    return Math.round(convertedArea * 100) / 100;
  }, [loadedGeoJSONArea]);

  const [activeRowId, setActiveRowId] = useState<number | null>(null);

  const [jobName, setJobName] = useStore((state) => [state.jobName, state.setJobName]);
  const [minYear, maxYear] = useStore((state) => [state.minYear, state.maxYear]);
  const [startYear, setStartYear] = useStore((state) => [state.startYear, state.setStartYear]);
  const [endYear, setEndYear] = useStore((state) => [state.endYear, state.setEndYear]);
  const [loadedFile, setLoadedFile] = useStore((state) => [state.loadedFile, state.setLoadedFile]);
  const prepareMultipolygonJob = useStore((state) => state.prepareMultipolygonJob);
  const submitMultipolygonJob = useStore((state) => state.submitMultipolygonJob);
  const closeNewJob = useStore((state) => state.closeNewJob);
  const prepareGeoJSON = useStore((state) => state.prepareGeoJSON);

  const userInfo = useStore((state) => state.userInfo);
  const canWriteJobs = useMemo(() => userInfo?.permissions.includes("write:jobs"), [userInfo?.permissions]);

  const submitJob = useStore((state) => state.submitJob);

  const canSubmitJob = useMemo(() => {
    return jobName && loadedFile && loadedGeoJSON && startYear <= endYear;
  }, [jobName, loadedFile, loadedGeoJSON, startYear, endYear]);

  const canSubmitBulkJob = useMemo(() => {
    return jobName && loadedFile && multipolygons.length > 0 && startYear <= endYear;
  }, [jobName, loadedFile, multipolygons, startYear, endYear]);

  const isBulkJob = useMemo(() => {
    return canSubmitBulkJob && multipolygons.length > 1;
  }, [canSubmitBulkJob, multipolygons]);

  const isValidArea = useMemo(() => {
    // Landsat resolution is 30m, so we want to make sure the area is at least 900m^2
    if (isBulkJob) {
      let allRowsValid = rows.every((row) => {
        if (!row.visible) {
          return true;
        }

        return row.isValidArea;
      });

      return allRowsValid && visibleLayerCount > 0;
    } else {
      return loadedGeoJSONArea >= minimumValidArea && loadedGeoJSONArea <= maximumValidArea;
    }
  }, [isBulkJob, loadedGeoJSONArea, multipolygons, rows, minimumValidArea, maximumValidArea, visibleLayerCount]);

  const validYears = useMemo(() => {
    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  }, [startYear, endYear]);

  const generateRows = useCallback((multipolygons: any[]) => {
    const rows: PolygonLocation[] = multipolygons.map((geojson, index) => {
      let defaultName = `${geojson?.properties?.County || ""} Part ${index + 1}`;
      defaultName = defaultName.trim();

      let name = geojson?.features?.[0]?.properties?.name || defaultName;

      let lat = geojson?.geometry?.coordinates[0][0][0];
      let long = geojson?.geometry?.coordinates[0][0][1];

      if (!lat || !long) {
        // Get from first point in polygon
        lat = geojson?.features?.[0]?.geometry?.coordinates[0][0][0];
        long = geojson?.features?.[0]?.geometry?.coordinates[0][0][1];
      }

      let area = geojson?.properties?.shape_Area;
      if (!area) {
        area = turfArea(geojson);
      }

      let isValidArea = area > minimumValidArea && area < maximumValidArea;

      return {
        visible: isValidArea,
        name: name,
        acres: geojson?.properties?.Acres,
        comments: geojson?.properties?.Comments,
        county: geojson?.properties?.County,
        polygon_So: geojson?.properties?.Polygon_So,
        shapeArea: area,
        shapeLeng: geojson?.properties?.Shape_Leng,
        source: geojson?.properties?.Source,
        wUR_Basin: geojson?.properties?.WUR_Basin,
        id: index,
        lat: lat,
        long: long,
        crop: geojson?.properties?.CDL_Crop || "",
        isValidArea: isValidArea,
      };
    });

    setRows(rows);
  }, []);

  const confirm = useConfirm();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach((file) => {
      const reader = new FileReader();

      reader.onabort = () => console.log("file reading was aborted");
      reader.onerror = () => console.log("file reading has failed");
      reader.onload = () => {
        setLoadedFile(file);
        if (!jobName) {
          let fileName = (file?.name || "").replace(/\.[^/.]+$/, "").trim();
          setJobName(fileName);
        }

        let prepareRequest = prepareGeoJSON(file);
        if (!prepareRequest) {
          // User not authenticated
          console.error("User not authenticated, cannot prepare GeoJSON.");
          return;
        }

        prepareRequest.then((geojson) => {
          if (geojson.data && !geojson?.data?.multipolygon) {
            setLoadedGeoJSON(geojson.data);
            setMultipolygons([]);
            setRows([]);
            setActiveJob(null);
          } else if (geojson?.data?.multipolygon && geojson?.data?.geojsons?.length > 0) {
            setMultipolygons(geojson.data.geojsons);
            generateRows(geojson.data.geojsons);
            setActiveJob(null);
          }
        });
      };
      reader.readAsText(file);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "application/zip": [".zip"],
      "application/json": [".geojson"],
      "application/vnd.google-earth.kml+xml": [".kml"],
    },
  });

  const LayerRow: FC<{ index: number; style: any }> = useCallback(
    ({ index, style }) => {
      let row = rows[index];
      if (!row) {
        console.error("No row found for index", index);
        return null;
      }

      let roundedLat = row?.lat ? Math.round(row.lat * 1000) / 1000 : "NaN";
      let roundedLong = row?.long ? Math.round(row.long * 1000) / 1000 : "NaN";

      let roundedAcres = row?.acres ? Math.round(row.acres * 100) / 100 : "NaN";

      let [editRowName, setEditRowName] = useState(false);
      let [rowName, setRowName] = useState(row.name);

      return (
        <div key={row.id} className={`layer-row ${row.id === activeRowId ? "active" : ""}`} style={style}>
          <div className="left-btns">
            <IconButton
              onClick={() => {
                row.visible = !row.visible;
                setRows([...rows]);
              }}
            >
              {row.visible && (
                <CheckBoxIcon
                  sx={{
                    cursor: "pointer",
                    "&:hover": { color: "var(--st-gray-20)" },
                  }}
                />
              )}
              {!row.visible && (
                <CheckBoxOutlineBlankIcon
                  sx={{
                    cursor: "pointer",
                    "&:hover": { color: "var(--st-gray-20)" },
                  }}
                />
              )}
            </IconButton>
          </div>
          <div
            className="details"
            onClick={(evt) => {
              // If has class ignore-select, don't do anything
              if (evt.target instanceof HTMLElement && evt.target.classList.contains("ignore-select")) {
                return;
              }

              // Also check if parent has ignore-select
              if ((evt.target as any)?.parentElement?.classList.contains("ignore-select")) {
                return;
              }

              if (evt.target instanceof HTMLInputElement) {
                return;
              }

              if (row.id === activeRowId) {
                setActiveRowId(null);
                setLoadedGeoJSON(null);
              } else {
                let geojson = multipolygons[row.id];
                if (geojson) {
                  setLoadedGeoJSON(geojson);
                  setActiveRowId(row.id);

                  if (!row.visible) {
                    row.visible = true;
                    setRows([...rows]);
                  }
                }
              }
            }}
          >
            {!editRowName && (
              <Typography
                variant="body1"
                className="ignore-select"
                sx={{
                  color: row.id === activeRowId ? "var(--st-gray-10)" : "var(--st-gray-30)",
                  fontWeight: "bold",
                  display: "flex",
                  alignItems: "center",
                  cursor: "pointer",
                }}
                onDoubleClick={() => {
                  setEditRowName(true);
                }}
              >
                {row.name}
                <EditIcon
                  onClick={(evt) => {
                    evt.stopPropagation();
                    setEditRowName(true);
                  }}
                  className="ignore-select"
                  sx={{ color: "var(--st-gray-30)", cursor: "pointer", ml: "8px", fontSize: "14px" }}
                />
              </Typography>
            )}
            {editRowName && (
              <>
                <input
                  placeholder={row.name}
                  value={rowName}
                  style={{
                    backgroundColor: "var(--st-gray-90)",
                    border: "1px solid var(--st-gray-40)",
                    borderRadius: "4px",
                    padding: "4px",
                  }}
                  onChange={(evt) => {
                    setRowName(evt.target.value);
                  }}
                  onBlur={() => {
                    row.name = rowName.trim();
                    setRows([...rows]);
                    setEditRowName(false);
                  }}
                />
              </>
            )}
            <Typography
              variant="body2"
              style={{ color: row.id === activeRowId ? "var(--st-gray-20)" : "var(--st-gray-40)" }}
            >
              Coordinates: {roundedLat}, {roundedLong}
            </Typography>
            {row?.acres && (
              <Typography
                variant="body2"
                style={{
                  color: row.isValidArea
                    ? row.id === activeRowId
                      ? "var(--st-gray-20)"
                      : "var(--st-gray-40)"
                    : "var(--st-red)",
                }}
              >
                Acres: {roundedAcres}{" "}
                {row.isValidArea ? "" : row.shapeArea < maximumValidArea ? "(Area too small)" : "(Area too large)"}
              </Typography>
            )}
          </div>
        </div>
      );
    },
    [rows, activeRowId, multipolygons]
  );

  return (
    <div className="layers-control" style={{ top: activeJob ? 125 : 49 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <span
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            fontWeight: 600,
            color: "#bcbcbc",
            padding: "0 8px",
          }}
        >
          {multipolygons.length > 1 ? "Bulk " : ""}
          Job Configuration
        </span>
        <IconButton
          className="close-btn"
          sx={{ color: "var(--st-gray-50)", ":hover": { color: "var(--st-gray-30)" } }}
          onClick={() => {
            closeNewJob();
          }}
        >
          <CloseIcon />
        </IconButton>
      </div>
      {multipolygons.length === 0 && (
        <FormControl style={{ width: "100%", padding: "0 8px", marginTop: "16px" }}>
          <InputLabel htmlFor="name-field">Output Name</InputLabel>
          <Input
            id="name-field"
            style={{ padding: "0 8px", width: "100%" }}
            value={jobName}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setJobName(event.target.value);
            }}
          />
        </FormControl>
      )}
      <div style={{ padding: "8px 16px" }}>
        <Slider
          min={minYear}
          max={maxYear}
          getAriaLabel={() => "Year range slider"}
          value={[startYear, endYear]}
          onChange={(_, newValue: number | number[]) => {
            if (!Array.isArray(newValue)) {
              return;
            }

            setStartYear(newValue[0]);
            setEndYear(newValue[1]);
          }}
          valueLabelDisplay="auto"
          getAriaValueText={(value) => `${value}`}
          marks
        />
        <div className="slider-controls" style={{ display: "flex", justifyContent: "space-between" }}>
          <FormControl size="small">
            <InputLabel id="start-year-label">Start Year</InputLabel>
            <Select
              labelId="start-year-label"
              value={startYear}
              label="Start Year"
              onChange={(event: SelectChangeEvent<number>) => setStartYear(event.target.value as number)}
            >
              {validYears.map((year) => (
                <MenuItem key={year} value={year}>
                  {year}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel id="end-year-label">End Year</InputLabel>
            <Select
              labelId="end-year-label"
              value={endYear}
              label="End Year"
              onChange={(event: SelectChangeEvent<number>) => setEndYear(event.target.value as number)}
            >
              {validYears.map((year) => (
                <MenuItem key={year} value={year}>
                  {year}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>
      </div>
      {rows.length > 1 && (
        <div className="metaline">
          <Typography
            variant="body1"
            style={{ color: "var(--st-gray-30)", fontWeight: "bold", cursor: "pointer" }}
            onClick={() => {
              setActiveRowId(null);
              setLoadedGeoJSON(null);
            }}
          >
            {visibleLayerCount} Visible Layers
          </Typography>
          <IconButton
            sx={{ marginLeft: "auto" }}
            onClick={() => {
              rows.forEach((row) => {
                row.visible = row.isValidArea;
              });
              setRows([...rows]);
            }}
          >
            <SelectAllIcon
              sx={{
                cursor: "pointer",
                color: "var(--st-gray-30)",
                "&:hover": { color: "var(--st-gray-20)" },
              }}
            ></SelectAllIcon>
          </IconButton>
          <IconButton
            onClick={() => {
              rows.forEach((row) => {
                row.visible = false;
              });
              setRows([...rows]);
            }}
          >
            <ClearAllIcon
              sx={{
                cursor: "pointer",
                color: "var(--st-gray-30)",
                "&:hover": { color: "var(--st-gray-20)" },
              }}
            ></ClearAllIcon>
          </IconButton>
        </div>
      )}
      {rows.length > 1 && (
        <div
          className="layer-list"
          style={{
            maxHeight: activeJob ? "calc(100vh - 628px)" : "268px",
            minHeight: "85px",
            height: 85 * rows.length,
          }}
        >
          <AutoSizer>
            {({ height, width }) => (
              <List className="List" height={height} itemCount={rows.length} itemSize={85} width={width}>
                {LayerRow}
              </List>
            )}
          </AutoSizer>
        </div>
      )}
      <div className="dropzone-container" style={{ height: !loadedFile && rows.length === 0 ? 400 : 200, width: "318px" }}>
        {loadedFile && (
          <div className="cancel-job">
            <IconButton
              onClick={(evt) => {
                evt.preventDefault();
                setLoadedFile(null);
                setLoadedGeoJSON(null);
                setMultipolygons([]);
              }}
            >
              <CloseIcon sx={{ color: "var(--st-gray-50)", ":hover": { color: "var(--st-gray-10)" } }} />
            </IconButton>
          </div>
        )}
        <div className={`dropzone-area ${isDragActive ? "drag-active" : ""}`} {...getRootProps()} style={{ padding: "8px" }}>
          <input {...getInputProps()} />
          {loadedFile ? (
            <div
              className="loaded-file"
              style={{ margin: "8px", display: "flex", alignItems: "center", gap: "8px", justifyContent: "center" }}
            >
              <MapIcon style={{ color: "var(--st-gray-20)" }} />
              <p style={{ color: "var(--st-gray-20)", marginBottom: 0, textAlign: "center" }}>{loadedFile.name}</p>
              <p style={{ color: "var(--st-gray-50)", margin: 0, fontSize: "12px" }}>
                Area: {roundedLoadedGeoJSONArea} Acres
              </p>
            </div>
          ) : (
            <p style={{ color: "var(--st-gray-40)", textAlign: "center" }}>
              Drag & drop <br /> or <strong>browse</strong> to upload
              <p style={{ fontSize: "12px" }}>
                Supports:
                <br /> .geojson, .zip (zipped shapefiles), .kml
              </p>
            </p>
          )}
        </div>
      </div>
      <div className="message-container" style={{ display: "flex", maxWidth: "300px" }}>
        {!canWriteJobs && (
          <Typography
            variant="body2"
            className="note"
            style={{ marginRight: "auto", fontSize: "12px", color: "var(--st-gray-40)", marginLeft: "16px" }}
          >
            You only have permission to submit jobs. <br />
            <br />
            An admin must approve these jobs before they are processed.
          </Typography>
        )}
      </div>
      <div
        className="bottom-buttons"
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "flex-end" }}
      >
        <Button
          disabled={!canSubmitJob}
          variant="contained"
          color="secondary"
          style={{ marginRight: "auto", marginLeft: "8px" }}
          onClick={() => {
            let originalGeoJSON = loadedGeoJSON;
            setLoadedGeoJSON(null);
            setTimeout(() => {
              setLoadedGeoJSON(originalGeoJSON);
            }, 1);
          }}
        >
          Locate
        </Button>
        <Button
          disabled={!isValidArea || (!canSubmitJob && !canSubmitBulkJob)}
          variant="contained"
          color={isValidArea ? "primary" : "error"}
          style={{
            margin: "8px",
            border: isValidArea && (canSubmitJob || canSubmitBulkJob) ? "1px solid #1E40AF" : "1px solid transparent",
          }}
          onClick={() => {
            if (canSubmitJob) {
              submitJob();
              closeNewJob();
            } else if (canSubmitBulkJob) {
              let jobs = prepareMultipolygonJob();
              let totalNumberOfYears = jobs.reduce((acc, job) => acc + job.end_year - job.start_year + 1, 0);

              // Rough estimate of 5 minutes per year
              let estimatedTimePerYear = 5;
              let estimatedTimeMS = totalNumberOfYears * estimatedTimePerYear * 60 * 1000;
              let estimatedTime = formatElapsedTime(estimatedTimeMS).trim();

              confirm({
                title: "Submit Bulk Job",
                description: `Are you sure you want to submit ${jobs.length} jobs (ETA: ${estimatedTime})?`,
                confirmationButtonProps: { color: "primary", variant: "contained" },
                cancellationButtonProps: { color: "secondary", variant: "contained" },
                titleProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
                contentProps: { sx: { backgroundColor: "var(--st-gray-90)", color: "var(--st-gray-10)" } },
                dialogActionsProps: { sx: { backgroundColor: "var(--st-gray-90)" } },
              }).then(() => {
                submitMultipolygonJob(jobs);
                closeNewJob();
              });
            }
          }}
        >
          Submit {isBulkJob && "Bulk "}Job
        </Button>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "4px" }}>
        {loadedGeoJSONArea > 0 && !isValidArea && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: "4px" }}>
            <ErrorIcon style={{ color: "var(--st-red)", fontSize: "32px" }} />
            {loadedGeoJSONArea < maximumValidArea ? (
              <Typography variant="body2" className="note" style={{ fontSize: "12px", color: "var(--st-gray-40)" }}>
                Area is too small (min {minimumValidArea} m<sup>2</sup>)<br />
                Please upload a larger area.
              </Typography>
            ) : (
              <Typography variant="body2" className="note" style={{ fontSize: "12px", color: "var(--st-gray-40)" }}>
                Area is too large (max {maximumValidArea} m<sup>2</sup>)<br />
                Please upload a smaller area.
              </Typography>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LayersControl;
