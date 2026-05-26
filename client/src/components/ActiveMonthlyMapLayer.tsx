import { FC, useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useMap } from "react-leaflet";
// @ts-expect-error - No type definitions available
import GeoRasterLayer from "georaster-layer-for-leaflet";
import useCurrentJobStore from "../utils/currentJobStore";
import { ET_COLORMAP, MAP_LAYER_OPTIONS } from "../utils/constants";
import { getPreviewColormap, getPreviewDisplayName } from "../utils/previewCalculations";
import { isNoData } from "../utils/previewGeoraster";
import { applyPreviewPolygonClip, isPreviewLocationVisible } from "../utils/previewPolygonClip";
import { Tooltip, LeafletMouseEvent } from "leaflet";
import useStore, { MapLayer } from "../utils/store";

import { OPENET_TRANSITION_DATE } from "../utils/constants";
import ColorScale from "./ColorScale";
import { useAtom } from "jotai";
import { tooltipAtom } from "../utils/atoms";

const style = document.createElement("style");
style.textContent = `
  .active-monthly-map-layer .leaflet-tile {
    opacity: 1 !important;
    visibility: visible !important;
    transition: none !important;
  }
`;
document.head.appendChild(style);

const styleCrossfade = document.createElement("style");
styleCrossfade.textContent = `
  .active-monthly-map-layer {
    transition: opacity 0.3s ease-in-out !important;
  }
  .active-monthly-map-layer.fade-out {
    opacity: 0 !important;
  }
`;
document.head.appendChild(styleCrossfade);

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    }
    : null;
};

// Helper function to interpolate between two colors
const interpolateColors = (color1: string, color2: string, factor: number) => {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);

  if (!rgb1 || !rgb2) return color1;

  const r = Math.round(rgb1.r + (rgb2.r - rgb1.r) * factor);
  const g = Math.round(rgb1.g + (rgb2.g - rgb1.g) * factor);
  const b = Math.round(rgb1.b + (rgb2.b - rgb1.b) * factor);

  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
};

// Helper function to get interpolated color from colormap
const getInterpolatedColor = (value: number, colormap: string[]) => {
  // Normalize value to [0, 1] range
  const normalizedValue = Math.max(0, Math.min(1, value));

  // Calculate the index in the colormap
  const index = normalizedValue * (colormap.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.min(lowerIndex + 1, colormap.length - 1);

  // Calculate interpolation factor
  const factor = index - lowerIndex;

  return interpolateColors(colormap[lowerIndex], colormap[upperIndex], factor);
};

interface GeoRaster {
  xmin: number;
  ymax: number;
  pixelWidth: number;
  pixelHeight: number;
  width: number;
  height: number;
  values: number[][][];
  mins: number[];
  maxs: number[];
}

// Helper function to get value at lat/lng from georaster
const getValueAtLatLng = (georaster: GeoRaster, lat: number, lng: number) => {
  // Calculate pixel coordinates
  const x = Math.floor((lng - georaster.xmin) / georaster.pixelWidth);
  const y = Math.floor((georaster.ymax - lat) / georaster.pixelHeight);

  // Check if coordinates are within bounds
  if (x < 0 || x >= georaster.width || y < 0 || y >= georaster.height) {
    return null;
  }

  // Get value from the 2D array
  return georaster.values[0][y][x];
};

const formatPreviewValue = (value: number) => {
  const previewUnits = useCurrentJobStore.getState().previewUnits;

  if (previewUnits === "inches") {
    return {
      value: value / 25.4,
      units: "in/month",
    };
  }

  return {
    value,
    units: "mm/month",
  };
};

const ActiveMonthlyMapLayer: FC = () => {
  const map = useMap();
  const [previewJobId, setPreviewJobId] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const layerRef = useRef<GeoRasterLayer | null>(null);
  const tooltipRef = useRef<Tooltip | null>(null);
  const mousemoveHandlerRef = useRef<((e: LeafletMouseEvent) => void) | null>(null);
  const mouseoutHandlerRef = useRef<(() => void) | null>(null);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [tooltip, setTooltip] = useAtom(tooltipAtom);

  // Get preview state from currentJobStore
  const showPreview = useCurrentJobStore((state) => state.showPreview);
  const previewMonth = useCurrentJobStore((state) => state.previewMonth);
  const setPreviewMonth = useCurrentJobStore((state) => state.setPreviewMonth);
  const previewYear = useCurrentJobStore((state) => state.previewYear);
  const setPreviewYear = useCurrentJobStore((state) => state.setPreviewYear);
  const previewVariable = useCurrentJobStore((state) => state.previewVariable);
  const setPreviewVariable = useCurrentJobStore((state) => state.setPreviewVariable);
  const fetchPreviewGeoraster = useCurrentJobStore((state) => state.fetchPreviewGeoraster);
  const setAvailableDays = useCurrentJobStore((state) => state.setAvailableDays);

  const isSidebarOpen = useStore((state) => state.isRightPanelOpen);

  const activeJob = useStore((state) => state.activeJob);

  const [dynamicPreviewColorScale, setDynamicPreviewColorScale] = useCurrentJobStore((state) => [
    state.dynamicPreviewColorScale,
    state.setDynamicPreviewColorScale,
  ]);
  const [activePreviewMinValue, setActivePreviewMinValue] = useCurrentJobStore((state) => [
    state.previewMin,
    state.setPreviewMin,
  ]);
  const [activePreviewMaxValue, setActivePreviewMaxValue] = useCurrentJobStore((state) => [
    state.previewMax,
    state.setPreviewMax,
  ]);
  const previewOpacity = useCurrentJobStore((state) => state.previewOpacity);
  const setPreviewOpacity = useCurrentJobStore((state) => state.setPreviewOpacity);
  const clipToPolygon = useCurrentJobStore((state) => state.clipToPolygon);
  const clipToPolygonMode = useCurrentJobStore((state) => state.clipToPolygonMode);

  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const mapLayerHasColorScale = useMemo(() => {
    const mapLayer = (MAP_LAYER_OPTIONS as any)?.[mapLayerKey] as MapLayer;
    return !!mapLayer?.showColorScale;
  }, [mapLayerKey]);

  const cleanupLayers = useCallback(() => {
    if (fadeTimeoutRef.current) {
      clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = null;
    }

    // Remove existing layer if any
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    // Remove existing tooltip if any
    if (tooltipRef.current) {
      tooltipRef.current.close();
      map.removeLayer(tooltipRef.current);
      tooltipRef.current = null;
    }

    // Remove event listeners
    if (mousemoveHandlerRef.current) {
      map.off("mousemove", mousemoveHandlerRef.current);
      mousemoveHandlerRef.current = null;
    }

    if (mouseoutHandlerRef.current) {
      map.off("mouseout", mouseoutHandlerRef.current);
      mouseoutHandlerRef.current = null;
    }
  }, [map]);

  const createLayerWithCrossfade = async (
    georaster: GeoRaster,
    minValue: number,
    maxValue: number,
    colormap: string[],
    layerOpacity: number
  ) => {
    const pixelValuesToColorFn = (value: number | number[]) => {
      const raw = Array.isArray(value) ? value[0] : value;
      if (isNoData(raw)) {
        return undefined;
      }
      const normalizedValue = (raw - minValue) / (maxValue - minValue);
      return getInterpolatedColor(normalizedValue, colormap);
    };

    const layerOptions: Record<string, unknown> = {
      georaster: georaster,
      opacity: 0,
      resolution: 256,
      pixelValuesToColorFn,
      debugLevel: 1,
      transition: false,
      noWrap: true,
      zIndex: 1,
      useCanvas: true,
      updateWhenIdle: false,
      updateWhenZooming: false,
      updateWhenMoving: false,
      className: "active-monthly-map-layer",
    };

    const newLayer = new GeoRasterLayer(layerOptions) as unknown as GeoRasterLayer;

    newLayer.addTo(map);

    if (layerRef.current) {
      const oldLayer = layerRef.current;
      const oldLayerElement = oldLayer.getContainer();

      if (oldLayerElement) {
        oldLayerElement.classList.add("fade-out");

        fadeTimeoutRef.current = setTimeout(() => {
          map.removeLayer(oldLayer);
        }, 300);
      } else {
        map.removeLayer(oldLayer);
      }
    }

    setTimeout(() => {
      newLayer.setOpacity(layerOpacity);
    }, 10);

    return newLayer;
  };

  useEffect(() => {
    if (activeJob?.id !== previewJobId) {
      setPreviewJobId(activeJob?.id || "");
      setPreviewMonth(1);
      setPreviewYear(activeJob?.start_year || null);
      setPreviewVariable("ET");
      setActivePreviewMinValue(0);
      setActivePreviewMaxValue(0);
      setDynamicPreviewColorScale(true);
      setPreviewOpacity(1);
      cleanupLayers();
      setAvailableDays([]);
    }
  }, [
    activeJob,
    previewJobId,
    setPreviewMonth,
    setPreviewYear,
    setPreviewVariable,
    setAvailableDays,
    setDynamicPreviewColorScale,
    setActivePreviewMinValue,
    setActivePreviewMaxValue,
    setPreviewOpacity,
  ]);

  useEffect(() => {
    return () => {
      cleanupLayers();

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [map, cleanupLayers]);

  useEffect(() => {
    if (!showPreview) {
      cleanupLayers();
      setActivePreviewMaxValue(0);
      setActivePreviewMinValue(0);
    }
  }, [showPreview, cleanupLayers, setActivePreviewMaxValue, setActivePreviewMinValue]);

  useEffect(() => {
    const loadGeoTiff = async () => {
      if (isLoading) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current);
        }
      }

      abortControllerRef.current = new AbortController();

      setIsLoading(true);

      if (tooltipRef.current) {
        map.removeLayer(tooltipRef.current);
        tooltipRef.current = null;
      }

      if (mousemoveHandlerRef.current) {
        map.off("mousemove", mousemoveHandlerRef.current);
        mousemoveHandlerRef.current = null;
      }

      if (mouseoutHandlerRef.current) {
        map.off("mouseout", mouseoutHandlerRef.current);
        mouseoutHandlerRef.current = null;
      }

      if (!showPreview || !previewMonth || !previewYear || !previewVariable) {
        setIsLoading(false);
        return;
      }

      try {
        const georaster = (await fetchPreviewGeoraster()) as GeoRaster | null;

        if (!georaster) {
          console.error("Failed to load preview data");
          setIsLoading(false);
          return;
        }

        const colormap = getPreviewColormap(previewVariable);

        const displayGeoraster =
          clipToPolygon && activeJob?.loaded_geo_json
            ? applyPreviewPolygonClip(georaster, activeJob.loaded_geo_json, clipToPolygonMode)
            : georaster;

        let minValue = displayGeoraster.mins[0];
        let maxValue = displayGeoraster.maxs[0];

        if (
          dynamicPreviewColorScale ||
          activePreviewMinValue === null ||
          activePreviewMaxValue === null ||
          activePreviewMinValue === activePreviewMaxValue
        ) {
          if (minValue === maxValue) {
            minValue = 0;
            maxValue = Math.max(maxValue, 300);
          }

          setActivePreviewMinValue(minValue);
          setActivePreviewMaxValue(maxValue);
        } else {
          minValue = Number(activePreviewMinValue);
          maxValue = Number(activePreviewMaxValue);
        }

        const layer = await createLayerWithCrossfade(
          displayGeoraster,
          minValue,
          maxValue,
          colormap,
          previewOpacity
        );

        let currentTooltip = tooltip;

        if (!currentTooltip) {
          currentTooltip = new Tooltip({
            permanent: false,
            direction: "top",
            offset: [0, -10],
            className: "custom-tooltip",
          });

          setTooltip(currentTooltip);
        }

        const mousemoveHandler = (e: LeafletMouseEvent) => {
          if (tooltipRef.current) {
            map.removeLayer(tooltipRef.current);
            tooltipRef.current = null;
          }

          const value = getValueAtLatLng(displayGeoraster, e.latlng.lat, e.latlng.lng);
          const insideClip =
            !clipToPolygon ||
            !activeJob?.loaded_geo_json ||
            isPreviewLocationVisible(
              e.latlng.lng,
              e.latlng.lat,
              displayGeoraster,
              activeJob.loaded_geo_json,
              clipToPolygonMode
            );

          let variableName = getPreviewDisplayName(previewVariable);
          if (previewVariable === "PET" && previewYear && Number(previewYear) >= OPENET_TRANSITION_DATE) {
            variableName = "ETo (Unadjusted)";
          }

          if (insideClip && value !== null && value !== undefined && !isNoData(value)) {
            const formattedValue = formatPreviewValue(value);
            currentTooltip
              ?.setLatLng(e.latlng)
              .setContent(
                `<div style="text-align: center">${activeJob?.name} (${new Date(
                  Number(previewYear),
                  Number(previewMonth) - 1
                ).toLocaleString("default", {
                  month: "short",
                })} ${previewYear})<br><b>${variableName}: ${formattedValue.value.toFixed(2)} ${formattedValue.units}</b></div>`
              )
              .openOn(map);
          } else {
            currentTooltip?.close();
          }
        };

        map.on("mousemove", mousemoveHandler);

        const mouseoutHandler = () => {
          currentTooltip?.close();
        };

        map.on("mouseout", mouseoutHandler);

        layerRef.current = layer;
        tooltipRef.current = tooltip;
        mousemoveHandlerRef.current = mousemoveHandler;
        mouseoutHandlerRef.current = mouseoutHandler;
      } catch (error: unknown) {
        const err = error as Error;
        if (err.name === "AbortError") {
          console.log("Fetch aborted");
        } else {
          console.error("Error loading GeoTIFF:", err);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadTimeoutRef.current = setTimeout(() => {
      loadGeoTiff();
    }, 20);

    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        if (tooltipRef.current) {
          tooltipRef.current.close();
        }
      }
    };
  }, [
    showPreview,
    previewMonth,
    previewYear,
    previewVariable,
    map,
    fetchPreviewGeoraster,
    activePreviewMinValue,
    activePreviewMaxValue,
    dynamicPreviewColorScale,
    clipToPolygon,
    clipToPolygonMode,
    activeJob?.loaded_geo_json,
    activeJob?.key,
  ]);

  useEffect(() => {
    if (layerRef.current) {
      layerRef.current.setOpacity(previewOpacity);
    }
  }, [previewOpacity]);

  return (
    activePreviewMinValue !== null &&
    activePreviewMinValue !== undefined &&
    activePreviewMinValue !== activePreviewMaxValue && (
      <ColorScale
        label={`${activeJob?.name} (${new Date(Number(previewYear), Number(previewMonth) - 1).toLocaleString("default", {
          month: "short",
        })} ${previewYear})`}
        minValue={Number(activePreviewMinValue)}
        maxValue={Number(activePreviewMaxValue)}
        colorScale={previewVariable ? getPreviewColormap(previewVariable) : ET_COLORMAP}
        style={{
          right: isSidebarOpen ? (mapLayerHasColorScale ? "400px" : "350px") : mapLayerHasColorScale ? "100px" : "50px",
          transition: "right 0.1s ease",
        }}
      />
    )
  );
};

export default ActiveMonthlyMapLayer;
