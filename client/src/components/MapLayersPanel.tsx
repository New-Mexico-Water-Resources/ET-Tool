import { FC, useEffect, useMemo, useState } from "react";
import {
  Checkbox,
  Divider,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Input,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Typography,
} from "@mui/material";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import axios from "axios";

import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";

import useStore, { MapLayer } from "../utils/store";

import "../scss/MapLayersPanel.scss";
import { MAP_LAYER_OPTIONS, REFERENCE_GEOJSONS } from "../utils/constants";
import dayjs from "dayjs";

const MapLayersPanel: FC = () => {
  const isMapLayersPanelOpen = useStore((state) => state.isMapLayersPanelOpen);

  const showARDTiles = useStore((state) => state.showARDTiles);
  const toggleARDTiles = useStore((state) => state.toggleARDTiles);

  const referenceLayerOptions = Object.keys(REFERENCE_GEOJSONS);
  const [visibleReferenceLayers, setVisibleReferenceLayers] = useStore((state) => [
    state.visibleReferenceLayers,
    state.setVisibleReferenceLayers,
  ]);

  const mapLayerOptions = useMemo(() => Object.values(MAP_LAYER_OPTIONS) as MapLayer[], [MAP_LAYER_OPTIONS]);
  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const setMapLayerKey = useStore((state) => state.setMapLayerKey);

  const tileDate = useStore((state) => state.tileDate);
  const setTileDate = useStore((state) => state.setTileDate);

  const [refreshType, setRefreshType] = useStore((state) => [state.refreshType, state.setRefreshType]);
  const [minimumBaseMapColorBound, setMinimumBaseMapColorBound] = useStore((state) => [
    state.minimumBaseMapColorBound,
    state.setMinimumBaseMapColorBound,
  ]);

  const [maximumBaseMapColorBound, setMaximumBaseMapColorBound] = useStore((state) => [
    state.maximumBaseMapColorBound,
    state.setMaximumBaseMapColorBound,
  ]);

  const [comparisonMode, setComparisonMode] = useStore((state) => [state.comparisonMode, state.setComparisonMode]);

  const [availableDates, setAvailableDates] = useState<string[]>([]);
  useEffect(() => {
    if (mapLayerKey && (MAP_LAYER_OPTIONS as any)[mapLayerKey]) {
      let selectedLayer = (MAP_LAYER_OPTIONS as any)[mapLayerKey] as MapLayer;
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

  const today = useMemo(() => dayjs().format("YYYY-MM-DD"), []);

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
              <Typography variant="body2" style={{ color: "var(--st-gray-30)", fontSize: "12px" }}>
                {layer}
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
                let selectedLayer = mapLayerOptions.find((option) => option.name === evt.target.value) as MapLayer;
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
                            value={comparisonMode}
                            onChange={(evt) => {
                              if (evt.target.value) {
                                setComparisonMode(evt.target.value as any);
                                if (evt.target.value === "absolute") {
                                  setMinimumBaseMapColorBound(0);
                                  setMaximumBaseMapColorBound(200);
                                } else {
                                  setMinimumBaseMapColorBound(-10);
                                  setMaximumBaseMapColorBound(10);
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
                      {option?.refresh &&
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
                        )}
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
                                ? "-12px"
                                : "0",
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
                              value={minimumBaseMapColorBound}
                              onChange={(evt) => {
                                const newValue = evt.target.value;
                                setMinimumBaseMapColorBound(Number(newValue));
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
                              value={maximumBaseMapColorBound}
                              onChange={(evt) => {
                                const newValue = evt.target.value;
                                setMaximumBaseMapColorBound(Number(newValue));
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
                              <DatePicker
                                sx={{ marginTop: "0", padding: 0 }}
                                className="date-picker"
                                defaultValue={dayjs(today)}
                                value={dayjs(tileDate)}
                                disableFuture={true}
                                minDate={availableDates.length === 0 ? undefined : dayjs(availableDates[0])}
                                maxDate={
                                  availableDates.length === 0 ? undefined : dayjs(availableDates[availableDates.length - 1])
                                }
                                shouldDisableDate={(date) => {
                                  return availableDates.length !== 0 && !availableDates.includes(date.format("YYYY-MM-DD"));
                                }}
                                showDaysOutsideCurrentMonth={true}
                                onChange={(selectedDate) => {
                                  let selectedDateStr = selectedDate?.format("YYYY-MM-DD");
                                  if (!selectedDateStr) {
                                    return;
                                  }

                                  if (availableDates.length === 0) {
                                    setTileDate(selectedDateStr);
                                    return;
                                  }

                                  // If tile date is 1st of month and selectedDate is last of month, change selectedDate to 2nd of month
                                  let lastOfMonth = dayjs(selectedDateStr).endOf("month");
                                  if (
                                    tileDate &&
                                    dayjs(tileDate).date() === 1 &&
                                    dayjs(selectedDateStr).date() === lastOfMonth.date()
                                  ) {
                                    selectedDateStr = dayjs(tileDate).subtract(1, "day").format("YYYY-MM-DD");
                                  } else if (
                                    tileDate &&
                                    dayjs(tileDate).date() === lastOfMonth.date() &&
                                    dayjs(selectedDateStr).date() === 1
                                  ) {
                                    selectedDateStr = dayjs(tileDate).add(1, "day").format("YYYY-MM-DD");
                                  }

                                  if (availableDates.includes(selectedDateStr)) {
                                    setTileDate(selectedDateStr);
                                    return;
                                  }

                                  const sortedDates = [...availableDates].sort((a, b) => dayjs(a).diff(dayjs(b)));

                                  const minDate = sortedDates[0];
                                  const maxDate = sortedDates[sortedDates.length - 1];

                                  if (dayjs(selectedDateStr).isBefore(dayjs(minDate))) {
                                    setTileDate(minDate);
                                    return;
                                  }
                                  if (dayjs(selectedDateStr).isAfter(dayjs(maxDate))) {
                                    setTileDate(maxDate);
                                    return;
                                  }

                                  const nextDate = sortedDates.find((date) => dayjs(date).isAfter(dayjs(selectedDateStr)));
                                  const prevDate = [...sortedDates]
                                    .reverse()
                                    .find((date) => dayjs(date).isBefore(dayjs(selectedDateStr)));

                                  if (dayjs(selectedDateStr).isAfter(dayjs(tileDate))) {
                                    setTileDate(nextDate || maxDate);
                                  } else {
                                    setTileDate(prevDate || minDate);
                                  }
                                }}
                              />
                            </div>
                          </LocalizationProvider>
                        </div>
                      )}
                    </div>
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
