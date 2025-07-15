import {
  Button,
  FormControl,
  IconButton,
  Input,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
} from "@mui/material";
import TableHead from "@mui/material/TableHead";

import MapIcon from "@mui/icons-material/Map";
import CloseIcon from "@mui/icons-material/Close";
import { TableVirtuoso, TableComponents } from "react-virtuoso";

import React, { ChangeEvent, useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import useStore, { PolygonLocation } from "../utils/store";
import { useConfirm } from "material-ui-confirm";
import { formatElapsedTime, formJobForQueue } from "../utils/helpers";
import { area as turfArea } from "@turf/turf";

const UploadDialog = () => {
  const [jobName, setJobName] = useStore((state) => [state.jobName, state.setJobName]);
  const [minYear, maxYear] = useStore((state) => [state.minYear, state.maxYear]);
  const [startYear, setStartYear] = useStore((state) => [state.startYear, state.setStartYear]);
  const [endYear, setEndYear] = useStore((state) => [state.endYear, state.setEndYear]);
  const [loadedFile, setLoadedFile] = useStore((state) => [state.loadedFile, state.setLoadedFile]);
  const [loadedGeoJSON, setLoadedGeoJSON] = useStore((state) => [state.loadedGeoJSON, state.setLoadedGeoJSON]);
  const [multipolygons, setMultipolygons] = useStore((state) => [state.multipolygons, state.setMultipolygons]);
  const setActiveJob = useStore((state) => state.setActiveJob);
  const submitJob = useStore((state) => state.submitJob);
  const prepareMultipolygonJob = useStore((state) => state.prepareMultipolygonJob);
  const submitMultipolygonJob = useStore((state) => state.submitMultipolygonJob);
  const closeNewJob = useStore((state) => state.closeNewJob);
  const prepareGeoJSON = useStore((state) => state.prepareGeoJSON);
  const previewJob = useStore((state) => state.previewJob);
  const previewMultipolygonJob = useStore((state) => state.previewMultipolygonJob);

  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);

  const confirm = useConfirm();

  const canSubmitJob = useMemo(() => {
    return jobName && loadedFile && loadedGeoJSON && startYear <= endYear;
  }, [jobName, loadedFile, loadedGeoJSON, startYear, endYear]);

  const canSubmitBulkJob = useMemo(() => {
    return jobName && loadedFile && multipolygons && startYear <= endYear;
  }, [jobName, loadedFile, multipolygons, startYear, endYear]);

  const validYears = useMemo(() => {
    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  }, [startYear, endYear]);

  const userInfo = useStore((state) => state.userInfo);
  const canWriteJobs = useMemo(() => userInfo?.permissions.includes("write:jobs"), [userInfo?.permissions]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach((file) => {
      const reader = new FileReader();

      reader.onabort = () => console.log("file reading was aborted");
      reader.onerror = () => console.log("file reading has failed");
      reader.onload = () => {
        setLoadedFile(file);
        if (!jobName) {
          const fileName = file.name.replace(/\.[^/.]+$/, "");
          setJobName(fileName);
        }

        const prepareRequest = prepareGeoJSON(file);
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
    },
  });

  interface ColumnData {
    dataKey: keyof PolygonLocation;
    label: string;
    numeric?: boolean;
    width: number;
  }

  const columns: ColumnData[] = [
    { width: 200, label: "Acres", dataKey: "acres" },
    { width: 200, label: "Lat", dataKey: "lat" },
    { width: 200, label: "Long", dataKey: "long" },
    { width: 200, label: "County", dataKey: "county" },
    { width: 200, label: "Polygon Source", dataKey: "polygon_So" },
    { width: 200, label: "Shape Area", dataKey: "shapeArea" },
    { width: 200, label: "Shape Length", dataKey: "shapeLeng" },
    { width: 200, label: "Source", dataKey: "source" },
    { width: 200, label: "WUR Basin", dataKey: "wUR_Basin" },
    { width: 200, label: "Comments", dataKey: "comments" },
  ];

  const [rows, setRows] = useStore((state) => [state.locations, state.setLocations]);
  const visibleRows = useMemo(() => rows.filter((row) => row.visible), [rows]);

  const generateRows = useCallback((multipolygons: any[]) => {
    const rows: PolygonLocation[] = multipolygons.map((geojson, index) => {
      const defaultName = `${geojson?.county || ""} ${index + 1}`;
      const name = geojson?.features[0]?.properties?.name || defaultName;

      let lat = geojson?.geometry?.coordinates[0][0][0];
      let long = geojson?.geometry?.coordinates[0][0][1];

      if (!lat || !long) {
        // Get from first point in polygon
        lat = geojson?.features[0]?.geometry?.coordinates[0][0][0];
        long = geojson?.features[0]?.geometry?.coordinates[0][0][1];
      }

      const area = turfArea(geojson);

      return {
        visible: true,
        name: name,
        acres: area,
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
        isValidArea: area > 900,
      };
    });

    setRows(rows);
  }, []);

  const VirtuosoTableComponents: TableComponents<PolygonLocation> = useMemo(
    () => ({
      Scroller: React.forwardRef<HTMLDivElement>((props, ref) => <TableContainer component={Paper} {...props} ref={ref} />),
      Table: (props) => <Table {...props} sx={{ borderCollapse: "separate", tableLayout: "fixed" }} />,
      TableHead: TableHead as any,
      TableRow: ({ item: _item, ...props }) => <TableRow {...props} />,
      TableBody: React.forwardRef<HTMLTableSectionElement>((props, ref) => <TableBody {...props} ref={ref} />),
    }),
    []
  );

  function fixedHeaderContent() {
    return (
      <TableRow>
        {columns.map((column) => (
          <TableCell
            key={column.dataKey}
            variant="head"
            align={column.numeric || false ? "right" : "left"}
            style={{ width: column.width }}
            sx={{
              backgroundColor: "background.paper",
            }}
          >
            {column.label}
          </TableCell>
        ))}
      </TableRow>
    );
  }

  function rowContent(_index: number, row: PolygonLocation) {
    return (
      <React.Fragment>
        {columns.map((column) => (
          <TableCell
            sx={{
              backgroundColor: selectedRowId === row.id ? "var(--st-gray-80)" : "var(--st-gray-100)",
              cursor: "pointer",
            }}
            key={column.dataKey}
            align={column.numeric || false ? "right" : "left"}
            onClick={() => {
              setLoadedGeoJSON(multipolygons[row.id]);
              setSelectedRowId(row.id);
            }}
          >
            {row[column.dataKey]}
          </TableCell>
        ))}
      </React.Fragment>
    );
  }

  return (
    <div className="upload-dialog-container" style={{ background: "rgb(0 0 0 / 50%)", zIndex: 1000 }}>
      <div className="upload-zone" style={{ height: multipolygons.length > 0 && loadedFile ? "fit-content" : "50vh" }}>
        <div className="upload-options" style={{ width: "100%", color: "white" }}>
          <div className="dialog-header">
            <Typography variant="h5" className="dialog-title">
              Start New Job
            </Typography>
            <IconButton
              className="close-btn"
              onClick={() => {
                closeNewJob();
              }}
            >
              <CloseIcon />
            </IconButton>
          </div>
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
          <div style={{ padding: "16px 32px" }}>
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
            <div className="slider-controls">
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
        </div>
        <div className="dropzone-container">
          {loadedFile && (
            <div className="cancel-job">
              <IconButton
                onClick={(evt) => {
                  evt.preventDefault();
                  setLoadedFile(null);
                  setLoadedGeoJSON(null);
                }}
              >
                <CloseIcon sx={{ color: "var(--st-gray-50)", ":hover": { color: "var(--st-gray-10)" } }} />
              </IconButton>
            </div>
          )}
          <div className={`dropzone-area ${isDragActive ? "drag-active" : ""}`} {...getRootProps()}>
            <input {...getInputProps()} />
            {loadedFile ? (
              <div className="loaded-file" style={{ margin: "8px" }}>
                <MapIcon style={{ color: "var(--st-gray-20)" }} />
                <p style={{ color: "var(--st-gray-20)", marginBottom: 0 }}>{loadedFile.name}</p>
              </div>
            ) : (
              <p style={{ color: "var(--st-gray-40)" }}>Drag and drop a GeoJSON or zipped shapefile</p>
            )}
          </div>
        </div>
        {multipolygons && multipolygons.length > 0 && loadedFile && (
          <div className="multipolygon-table" style={{ width: "100%" }}>
            <Typography variant="h6" style={{ color: "var(--st-gray-30)", padding: "8px 16px" }}>
              Multipolygon Detected ({visibleRows.length} visible layers)
            </Typography>
            <div style={{ padding: "0 16px" }}>
              <Paper style={{ height: 400, width: "100%" }}>
                <TableVirtuoso
                  data={visibleRows}
                  components={VirtuosoTableComponents}
                  fixedHeaderContent={fixedHeaderContent}
                  itemContent={rowContent}
                />
              </Paper>
            </div>
          </div>
        )}
        <div
          className="bottom-buttons"
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "flex-end" }}
        >
          {!canWriteJobs && (
            <Typography
              variant="body2"
              className="note"
              style={{ marginRight: "auto", fontSize: "12px", color: "var(--st-gray-40)", marginLeft: "16px" }}
            >
              You only have permission to submit jobs. <br />
              An admin must approve these jobs before they are processed.
            </Typography>
          )}
          <Button
            disabled={!canSubmitJob && !canSubmitBulkJob}
            variant="contained"
            color="primary"
            style={{ margin: "8px", border: canSubmitJob ? "1px solid #1E40AF" : "1px solid transparent" }}
            onClick={() => {
              if (multipolygons.length > 0 && loadedFile) {
                previewMultipolygonJob();
              } else {
                const job = formJobForQueue(jobName, startYear, endYear, loadedGeoJSON);
                previewJob(job);
              }
            }}
          >
            {multipolygons && multipolygons.length > 0 && loadedFile ? "Configure Layers" : "Preview"}
          </Button>
          <Button
            disabled={!canSubmitJob && !canSubmitBulkJob}
            variant="contained"
            color="primary"
            style={{
              margin: "8px",
              border: canSubmitJob || canSubmitBulkJob ? "1px solid #1E40AF" : "1px solid transparent",
            }}
            onClick={() => {
              if (canSubmitJob) {
                submitJob();
              } else if (canSubmitBulkJob) {
                const jobs = prepareMultipolygonJob();
                const totalNumberOfYears = jobs.reduce((acc, job) => acc + job.end_year - job.start_year + 1, 0);

                // Rough estimate of 5 minutes per year
                const estimatedTimePerYear = 5;
                const estimatedTimeMS = totalNumberOfYears * estimatedTimePerYear * 60 * 1000;
                const estimatedTime = formatElapsedTime(estimatedTimeMS).trim();

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
                });
              }
            }}
          >
            Submit {canSubmitBulkJob && multipolygons.length > 1 && "Bulk "}Job
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UploadDialog;
