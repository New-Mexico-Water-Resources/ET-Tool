import { FC, useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  FormGroup,
  FormLabel,
  IconButton,
  Input,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Typography,
  CircularProgress,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import axios from "axios";
import UpdateIcon from "@mui/icons-material/Update";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";

import useStore, { MapLayer } from "../utils/store";

import "../scss/MapLayersPanel.scss";
import { MAP_LAYER_OPTIONS, REFERENCE_GEOJSONS } from "../utils/constants";
import dayjs from "dayjs";

const MapLayersPanel: FC = () => {
  const isMapLayersPanelOpen = useStore((state) => state.isMapLayersPanelOpen);

  const showARDTiles = useStore((state) => state.showARDTiles);
  const toggleARDTiles = useStore((state) => state.toggleARDTiles);

  const referenceLayerOptions = useMemo(() => Object.keys(REFERENCE_GEOJSONS), []);
  const [visibleReferenceLayers, setVisibleReferenceLayers] = useStore((state) => [
    state.visibleReferenceLayers,
    state.setVisibleReferenceLayers,
  ]);

  const mapLayerOptions = useMemo(() => Object.values(MAP_LAYER_OPTIONS) as MapLayer[], []);
  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const setMapLayerKey = useStore((state) => state.setMapLayerKey);

  const tileDate = useStore((state) => state.tileDate);
  const setTileDate = useStore((state) => state.setTileDate);

  const [refreshType, setRefreshType] = useStore((state) => [state.refreshType, state.setRefreshType]);
  const setMinimumBaseMapColorBound = useStore((state) => state.setMinimumBaseMapColorBound);
  const setMaximumBaseMapColorBound = useStore((state) => state.setMaximumBaseMapColorBound);
  const minimumBaseMapColorBound = useStore((state) => state.minimumBaseMapColorBound);
  const maximumBaseMapColorBound = useStore((state) => state.maximumBaseMapColorBound);

  const [tempTileDate, setTempTileDate] = useState<string | undefined>(undefined);
  const [tempMinimumBaseMapColorBound, setTempMinimumBaseMapColorBound] = useState<number | undefined>(0);
  const [tempMaximumBaseMapColorBound, setTempMaximumBaseMapColorBound] = useState<number | undefined>(200);

  const [comparisonMode, setComparisonMode] = useStore((state) => [state.comparisonMode, state.setComparisonMode]);
  const [tempComparisonMode, setTempComparisonMode] = useState<string | undefined>(comparisonMode || "absolute");

  const fetchingDroughtMonitorData = useStore((state) => state.fetchingDroughtMonitorData);
  const droughtMonitorData = useStore((state) => state.droughtMonitorData);
  const updateSettings = () => {
    if (tempTileDate) {
      setTileDate(tempTileDate);
    }
    if (tempMinimumBaseMapColorBound !== undefined) {
      setMinimumBaseMapColorBound(tempMinimumBaseMapColorBound);
    }
    if (tempMaximumBaseMapColorBound !== undefined) {
      setMaximumBaseMapColorBound(tempMaximumBaseMapColorBound);
    }
    if (tempComparisonMode) {
      setComparisonMode(tempComparisonMode);
    }
  };

  const [availableDates, setAvailableDates] = useState<string[]>([]);
  useEffect(() => {
    if (mapLayerKey && (MAP_LAYER_OPTIONS as any)[mapLayerKey]) {
      const selectedLayer = (MAP_LAYER_OPTIONS as any)[mapLayerKey] as MapLayer;
      if (selectedLayer?.availableDatesURL) {
        axios
          .get(selectedLayer.availableDatesURL)
          .then((response) => {
            const sortedDates = [...response.data].sort((a, b) => dayjs(a).diff(dayjs(b)));
            setAvailableDates(sortedDates);
          })
          .catch((error) => {
            console.error("Error fetching available dates", error);
            setAvailableDates([]);
          });
      } else {
        setAvailableDates([]);
      }
    } else {
      setAvailableDates([]);
    }
  }, [mapLayerOptions, mapLayerKey]);

  const latestAvailableDate = useMemo(() => {
    if (availableDates.length > 0) {
      return availableDates[availableDates.length - 1];
    }

    return undefined;
  }, [availableDates]);

  useEffect(() => {
    if ((!tileDate || !tempTileDate) && latestAvailableDate) {
      setTileDate(latestAvailableDate);
      setTempTileDate(latestAvailableDate);
    }
  }, [latestAvailableDate, setTileDate, tileDate, setTempTileDate, tempTileDate]);

  return (
    <div className={`map-layers-container ${isMapLayersPanelOpen ? "open" : "closed"}`}>
      <Typography
        variant="h5"
        style={{ color: "var(--st-gray-30)", padding: "8px 16px", display: "flex", alignItems: "center" }}
      >
        Layers
      </Typography>
      <Divider />
      <Typography
        variant="body2"
        style={{ color: "var(--st-gray-30)", padding: "8px 16px", display: "flex", alignItems: "center" }}
      >
        Active layers and reference objects showing on the map
      </Typography>
      <div className="map-layers-list">
        <Typography
          variant="h6"
          sx={{
            color: "var(--st-gray-20)",
            padding: 0,
            margin: 0,
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            borderBottom: "1px solid var(--st-gray-70)",
          }}
        >
          References
        </Typography>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 8,
            padding: "8px 16px",
            paddingTop: 0,
            paddingLeft: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", marginRight: "auto" }}>
            <Checkbox
              onClick={() => toggleARDTiles()}
              checked={showARDTiles}
              style={{ padding: 0, marginRight: "4px", marginLeft: "4px" }}
            />
            <Typography variant="body2" style={{ color: "var(--st-gray-30)", fontSize: "12px" }}>
              Available Data Boundary
            </Typography>
          </div>
          {referenceLayerOptions.map((layer) => (
            <div style={{ display: "flex", alignItems: "center", marginRight: "auto" }}>
              <Checkbox
                onClick={() => {
                  if (visibleReferenceLayers.includes(layer)) {
                    setVisibleReferenceLayers(visibleReferenceLayers.filter((l) => l !== layer));
                  } else {
                    setVisibleReferenceLayers([...visibleReferenceLayers, layer]);
                  }
                }}
                checked={visibleReferenceLayers.includes(layer)}
                style={{ padding: 0, marginRight: "4px", marginLeft: "4px" }}
              />
              <Typography
                variant="body2"
                style={{
                  color: "var(--st-gray-30)",
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {layer}
                {(REFERENCE_GEOJSONS as any)?.[layer]?.droughtMonitor &&
                  fetchingDroughtMonitorData &&
                  !Object.keys(droughtMonitorData).length && (
                    <span style={{ color: "var(--st-gray-30)", fontSize: "12px", display: "flex", alignItems: "center" }}>
                      <CircularProgress size={12} sx={{ color: "white" }} />
                    </span>
                  )}
              </Typography>
            </div>
          ))}
        </div>
        <Typography
          variant="h6"
          sx={{
            color: "var(--st-gray-20)",
            padding: 0,
            margin: 0,
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            borderBottom: "1px solid var(--st-gray-70)",
          }}
        >
          Base Map
        </Typography>
        <div style={{ display: "flex", alignItems: "center", marginRight: "auto" }}>
          <RadioGroup
            style={{ padding: 0, marginRight: "4px", marginLeft: "8px" }}
            value={mapLayerKey}
            onChange={(evt) => {
              if (evt.target.value && mapLayerOptions.find((option) => option.name === evt.target.value)) {
                const selectedLayer = mapLayerOptions.find((option) => option.name === evt.target.value) as MapLayer;
                setMapLayerKey(selectedLayer.name);
              }
            }}
          >
            {mapLayerOptions
              .filter((layer) => !layer?.hidden)
              .map((option) => {
                return (
                  <div key={option.name}>
                    <FormControlLabel key={option.name} value={option.name} control={<Radio />} label={option.name} />
                    <div
                      style={{
                        borderLeft: "1px solid var(--st-gray-70)",
                        marginLeft: "9.5px",
                        paddingLeft: "8px",
                        marginTop: mapLayerKey === option.name && option?.time ? "-12px" : "0",
                        paddingTop: mapLayerKey === option.name && option?.time ? "12px" : "0",
                      }}
                    >
                      {option?.units && mapLayerKey === option.name && (
                        <div>
                          <InputLabel
                            id="mode-select-label"
                            style={{ marginLeft: "16px", marginBottom: "4px", fontSize: "12px" }}
                          >
                            Mode
                          </InputLabel>
                          <Select
                            labelId="mode-select-label"
                            value={tempComparisonMode}
                            onChange={(evt) => {
                              if (evt.target.value) {
                                setTempComparisonMode(evt.target.value as any);
                                if (evt.target.value === "absolute") {
                                  setTempMinimumBaseMapColorBound(0);
                                  setTempMaximumBaseMapColorBound(200);
                                } else {
                                  setTempMinimumBaseMapColorBound(-10);
                                  setTempMaximumBaseMapColorBound(10);
                                  setRefreshType("dynamic");
                                }
                              }
                            }}
                            style={{ width: "calc(100% - 16px)", marginBottom: "8px", marginLeft: "16px" }}
                          >
                            {Object.entries(option?.modes || {}).map(([key, value]) => (
                              <MenuItem key={key} value={key}>
                                {value}
                              </MenuItem>
                            ))}
                          </Select>
                          <Typography
                            variant="body2"
                            style={{
                              color: "var(--st-gray-30)",
                              fontSize: "12px",
                              marginBottom: "8px",
                              padding: 0,
                              marginLeft: "16px",
                            }}
                          >
                            Units: {option.units}
                          </Typography>
                        </div>
                      )}
                      {/* {option?.refresh &&
                        (!option?.modes || comparisonMode === "absolute") &&
                        mapLayerKey === option.name && (
                          <RadioGroup
                            style={{
                              padding: 0,
                              marginRight: "4px",
                              marginLeft: "8px",
                              marginTop: "-8px",
                              marginBottom: "8px",
                            }}
                            value={refreshType}
                            onChange={(evt) => {
                              if (evt.target.value) {
                                setRefreshType(evt.target.value as any);
                              }
                            }}
                            row
                          >
                            <FormControlLabel value="static" control={<Radio />} label="Static" />
                            <FormControlLabel value="dynamic" control={<Radio />} label="Dynamic" />
                          </RadioGroup>
                        )} */}
                      {option?.refresh && refreshType === "dynamic" && mapLayerKey === option.name && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            marginRight: "auto",
                            marginLeft: "16px",
                            gap: 8,
                            marginTop:
                              (!option?.modes || comparisonMode === "absolute") && mapLayerKey === option.name
                                ? "0px"
                                : "0px",
                            marginBottom: "16px",
                          }}
                        >
                          <FormGroup>
                            <FormLabel
                              style={{
                                color: "var(--st-gray-30)",
                                fontSize: "12px",
                                marginBottom: 0,
                                padding: 0,
                              }}
                            >
                              Minimum
                            </FormLabel>
                            <Input
                              type="number"
                              value={tempMinimumBaseMapColorBound}
                              onChange={(evt) => {
                                const newValue = evt.target.value;
                                setTempMinimumBaseMapColorBound(Number(newValue));
                              }}
                            />
                          </FormGroup>
                          <FormGroup>
                            <FormLabel
                              style={{
                                color: "var(--st-gray-30)",
                                fontSize: "12px",
                                marginBottom: 0,
                                padding: 0,
                              }}
                            >
                              Maximum
                            </FormLabel>
                            <Input
                              type="number"
                              value={tempMaximumBaseMapColorBound}
                              onChange={(evt) => {
                                const newValue = evt.target.value;
                                setTempMaximumBaseMapColorBound(Number(newValue));
                              }}
                            />
                          </FormGroup>
                        </div>
                      )}
                      {option?.time && mapLayerKey === option.name && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            marginRight: "auto",
                            marginLeft: "16px",
                            marginTop: "-12px",
                            marginBottom: "8px",
                          }}
                        >
                          <LocalizationProvider dateAdapter={AdapterDayjs}>
                            <div>
                              <FormLabel
                                style={{
                                  color: "var(--st-gray-30)",
                                  fontSize: "12px",
                                  marginBottom: 0,
                                  padding: 0,
                                }}
                              >
                                Target Date
                              </FormLabel>
                              {(latestAvailableDate || !option.refresh) && (
                                <DatePicker
                                  sx={{ marginTop: "0", padding: 0 }}
                                  className="date-picker"
                                  defaultValue={dayjs(!option.refresh ? undefined : latestAvailableDate)}
                                  value={dayjs(tempTileDate)}
                                  disableFuture={true}
                                  minDate={availableDates.length === 0 ? undefined : dayjs(availableDates[0])}
                                  maxDate={
                                    availableDates.length === 0
                                      ? undefined
                                      : dayjs(availableDates[availableDates.length - 1])
                                  }
                                  shouldDisableDate={(date) => {
                                    return (
                                      availableDates.length !== 0 && !availableDates.includes(date.format("YYYY-MM-DD"))
                                    );
                                  }}
                                  showDaysOutsideCurrentMonth={true}
                                  onChange={(selectedDate) => {
                                    let selectedDateStr = selectedDate?.format("YYYY-MM-DD");
                                    if (!selectedDateStr) {
                                      return;
                                    }

                                    if (availableDates.length === 0) {
                                      setTempTileDate(selectedDateStr);
                                      return;
                                    }

                                    // If tile date is 1st of month and selectedDate is last of month, change selectedDate to 2nd of month
                                    const lastOfMonth = dayjs(selectedDateStr).endOf("month");
                                    if (
                                      tempTileDate &&
                                      dayjs(tempTileDate).date() === 1 &&
                                      dayjs(selectedDateStr).date() === lastOfMonth.date()
                                    ) {
                                      selectedDateStr = dayjs(tempTileDate).subtract(1, "day").format("YYYY-MM-DD");
                                    } else if (
                                      tempTileDate &&
                                      dayjs(tempTileDate).date() === lastOfMonth.date() &&
                                      dayjs(selectedDateStr).date() === 1
                                    ) {
                                      selectedDateStr = dayjs(tempTileDate).add(1, "day").format("YYYY-MM-DD");
                                    }

                                    if (availableDates.includes(selectedDateStr)) {
                                      setTempTileDate(selectedDateStr);
                                      return;
                                    }

                                    const sortedDates = [...availableDates].sort((a, b) => dayjs(a).diff(dayjs(b)));

                                    const minDate = sortedDates[0];
                                    const maxDate = sortedDates[sortedDates.length - 1];

                                    if (dayjs(selectedDateStr).isBefore(dayjs(minDate))) {
                                      setTempTileDate(minDate);
                                      return;
                                    }
                                    if (dayjs(selectedDateStr).isAfter(dayjs(maxDate))) {
                                      setTempTileDate(maxDate);
                                      return;
                                    }

                                    const nextDate = sortedDates.find((date) => dayjs(date).isAfter(dayjs(selectedDateStr)));
                                    const prevDate = [...sortedDates]
                                      .reverse()
                                      .find((date) => dayjs(date).isBefore(dayjs(selectedDateStr)));

                                    if (dayjs(selectedDateStr).isAfter(dayjs(tempTileDate))) {
                                      setTempTileDate(nextDate || maxDate);
                                    } else {
                                      setTempTileDate(prevDate || minDate);
                                    }
                                  }}
                                />
                              )}
                            </div>
                            {latestAvailableDate && (
                              <div
                                style={{
                                  display: "flex",
                                  alignSelf: "flex-end",
                                  alignItems: "center",
                                  height: "56px",
                                  marginLeft: "4px",
                                }}
                              >
                                <IconButton
                                  onClick={() => {
                                    if (latestAvailableDate) {
                                      setTempTileDate(latestAvailableDate);
                                      updateSettings();
                                    }
                                  }}
                                >
                                  <UpdateIcon
                                    sx={{ color: "var(--st-gray-30)", ":hover": { color: "var(--st-gray-10)" } }}
                                  />
                                </IconButton>
                              </div>
                            )}
                          </LocalizationProvider>
                        </div>
                      )}
                    </div>
                    {option?.time && mapLayerKey === option.name && (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "center",
                          marginLeft: "16px",
                          width: "calc(100% - 16px)",
                          gap: 8,
                        }}
                      >
                        <Button
                          variant="contained"
                          color="primary"
                          style={{
                            marginTop: "8px",
                            width: "100%",
                            marginLeft: "16px",
                          }}
                          disabled={
                            tempTileDate === tileDate &&
                            tempComparisonMode === comparisonMode &&
                            tempMinimumBaseMapColorBound === minimumBaseMapColorBound &&
                            tempMaximumBaseMapColorBound === maximumBaseMapColorBound
                          }
                          onClick={() => {
                            updateSettings();
                          }}
                        >
                          Update
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
          </RadioGroup>
        </div>
      </div>
    </div>
  );
};

export default MapLayersPanel;
