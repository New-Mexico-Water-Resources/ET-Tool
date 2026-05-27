import { FC, useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useMap } from "react-leaflet";
// @ts-expect-error - No type definitions available
import GeoRasterLayer from "georaster-layer-for-leaflet";
import useCurrentJobStore, { ClipToPolygonMode } from "../utils/currentJobStore";
import { ET_COLORMAP, MAP_LAYER_OPTIONS } from "../utils/constants";
import { getPreviewColormap, getPreviewDisplayName } from "../utils/previewCalculations";
import {
  formatPreviewValue,
  getPreviewValueAtLatLng,
  isNoData,
  getPreviewLayerScale,
  shouldUpdatePreviewScaleStore,
} from "../utils/previewGeoraster";
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

const PREVIEW_LAYER_HOLD_MS = 180;
const PREVIEW_LAYER_SWAP_FALLBACK_MS = 700;

const ActiveMonthlyMapLayer: FC = () => {
  const map = useMap();
  const activeJobGroup = useStore((state) => state.activeJobGroup);
  const [previewJobId, setPreviewJobId] = useState<string>("");
  const [, setIsLoading] = useState<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const loadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const layerRef = useRef<GeoRasterLayer | null>(null);
  const pendingLayerRef = useRef<GeoRasterLayer | null>(null);
  const swapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipRef = useRef<Tooltip | null>(null);
  const mousemoveHandlerRef = useRef<((e: LeafletMouseEvent) => void) | null>(null);
  const mouseoutHandlerRef = useRef<(() => void) | null>(null);
  const loadGenerationRef = useRef(0);
  const rawGeorasterRef = useRef<GeoRaster | null>(null);
  const displayedGeorasterRef = useRef<GeoRaster | null>(null);
  const previewDataFetchKeyRef = useRef("");
  const [tooltip, setTooltip] = useAtom(tooltipAtom);

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
  const activeJobKey = activeJob?.key;

  const [dynamicPreviewColorScale, setDynamicPreviewColorScale] = useCurrentJobStore((state) => [
    state.dynamicPreviewColorScale,
    state.setDynamicPreviewColorScale,
  ]);
  const activePreviewMinValue = useCurrentJobStore((state) => state.previewMin);
  const activePreviewMaxValue = useCurrentJobStore((state) => state.previewMax);
  const previewOpacity = useCurrentJobStore((state) => state.previewOpacity);
  const setPreviewOpacity = useCurrentJobStore((state) => state.setPreviewOpacity);
  const clipToPolygon = useCurrentJobStore((state) => state.clipToPolygon);
  const clipToPolygonMode = useCurrentJobStore((state) => state.clipToPolygonMode);

  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const mapLayerHasColorScale = useMemo(() => {
    const mapLayer = (MAP_LAYER_OPTIONS as any)?.[mapLayerKey] as MapLayer;
    return !!mapLayer?.showColorScale;
  }, [mapLayerKey]);

  const isPreviewReady = useMemo(() => {
    if (!activeJob?.key || activeJob.key !== previewJobId) {
      return false;
    }
    if (activeJob.start_year == null || activeJob.end_year == null) {
      return false;
    }
    if (!previewMonth || !previewYear) {
      return false;
    }
    const year = Number(previewYear);
    const month = Number(previewMonth);
    if (Number.isNaN(year) || Number.isNaN(month)) {
      return false;
    }
    return year >= Number(activeJob.start_year) && year <= Number(activeJob.end_year);
  }, [activeJob, previewJobId, previewMonth, previewYear]);

  const clearSwapTimers = useCallback(() => {
    if (swapTimeoutRef.current) {
      clearTimeout(swapTimeoutRef.current);
      swapTimeoutRef.current = null;
    }
    if (swapHoldTimeoutRef.current) {
      clearTimeout(swapHoldTimeoutRef.current);
      swapHoldTimeoutRef.current = null;
    }
  }, []);

  const cleanupLayers = useCallback(() => {
    clearSwapTimers();

    // Remove existing layer if any
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }

    // Remove pending layer if any (created while swapping, not yet visible)
    if (pendingLayerRef.current) {
      map.removeLayer(pendingLayerRef.current);
      pendingLayerRef.current = null;
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
  }, [map, clearSwapTimers]);

  const applyClipToRawGeoraster = useCallback(
    (georaster: GeoRaster, jobGeoJson: unknown, clipEnabled: boolean, clipMode: ClipToPolygonMode) => {
      if (clipEnabled && jobGeoJson) {
        return applyPreviewPolygonClip(georaster, jobGeoJson, clipMode);
      }
      return georaster;
    },
    []
  );

  const createPreviewLayer = (
    georaster: GeoRaster,
    minValue: number,
    maxValue: number,
    colormap: string[],
    loadGeneration: number,
    deferSwap: boolean
  ) => {
    const pixelValuesToColorFn = (value: number | number[]) => {
      const raw = Array.isArray(value) ? value[0] : value;
      if (isNoData(raw)) {
        return undefined;
      }
      const normalizedValue = (raw - minValue) / (maxValue - minValue);
      return getInterpolatedColor(normalizedValue, colormap);
    };

    clearSwapTimers();

    // If we already have a layer waiting to be swapped in, drop it
    if (pendingLayerRef.current) {
      map.removeLayer(pendingLayerRef.current);
      pendingLayerRef.current = null;
    }

    const layerOpacity = useCurrentJobStore.getState().previewOpacity;
    const newLayer = new GeoRasterLayer({
      georaster,
      opacity: layerOpacity,
      resolution: 256,
      pixelValuesToColorFn,
      transition: false,
      noWrap: true,
      zIndex: 1,
      useCanvas: true,
      updateWhenIdle: false,
      updateWhenZooming: false,
      updateWhenMoving: false,
      className: "active-monthly-map-layer",
    }) as unknown as GeoRasterLayer;

    const oldLayer = layerRef.current;
    newLayer.addTo(map);

    if (!deferSwap || !oldLayer) {
      if (oldLayer && map.hasLayer(oldLayer)) {
        map.removeLayer(oldLayer);
      }
      layerRef.current = newLayer;
      pendingLayerRef.current = null;
      return newLayer;
    }

    pendingLayerRef.current = newLayer;

    // Render the new month underneath while the previous month stays on top
    oldLayer.setZIndex(2);
    oldLayer.bringToFront();

    let swapCommitted = false;

    const discardPendingLayer = () => {
      clearSwapTimers();
      if (map.hasLayer(newLayer)) {
        map.removeLayer(newLayer);
      }
      if (pendingLayerRef.current === newLayer) {
        pendingLayerRef.current = null;
      }
    };

    const commitSwap = () => {
      if (swapCommitted) {
        return;
      }

      if (loadGeneration !== loadGenerationRef.current) {
        discardPendingLayer();
        return;
      }

      swapCommitted = true;
      clearSwapTimers();

      if (oldLayer && map.hasLayer(oldLayer)) {
        map.removeLayer(oldLayer);
      }

      layerRef.current = newLayer;
      if (pendingLayerRef.current === newLayer) {
        pendingLayerRef.current = null;
      }
    };

    const scheduleSwap = () => {
      if (swapCommitted || swapHoldTimeoutRef.current) {
        return;
      }

      swapHoldTimeoutRef.current = setTimeout(() => {
        swapHoldTimeoutRef.current = null;
        commitSwap();
      }, PREVIEW_LAYER_HOLD_MS);
    };

    const onNewLayerReady = () => {
      if (swapCommitted) {
        return;
      }

      if (loadGeneration !== loadGenerationRef.current) {
        discardPendingLayer();
        return;
      }

      scheduleSwap();
    };

    newLayer.once("load", onNewLayerReady);
    swapTimeoutRef.current = setTimeout(onNewLayerReady, PREVIEW_LAYER_SWAP_FALLBACK_MS);

    return newLayer;
  };

  useEffect(() => {
    if (!activeJobKey || activeJobKey === previewJobId) {
      return;
    }

    setPreviewJobId(activeJobKey);
    setPreviewMonth(1);
    setPreviewYear(activeJob?.start_year || null);
    setPreviewVariable("ET");
    setDynamicPreviewColorScale(true);
    setPreviewOpacity(1);
    rawGeorasterRef.current = null;
    displayedGeorasterRef.current = null;
    previewDataFetchKeyRef.current = "";
    cleanupLayers();
    setAvailableDays([]);
  }, [
    activeJobKey,
    activeJob?.start_year,
    previewJobId,
    setPreviewMonth,
    setPreviewYear,
    setPreviewVariable,
    setAvailableDays,
    setDynamicPreviewColorScale,
    setPreviewOpacity,
    cleanupLayers,
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
      return;
    }

    if (useStore.getState().activeJobGroup || !previewVariable || !isPreviewReady) {
      return;
    }

    const loadGeneration = ++loadGenerationRef.current;

    const loadGeoTiff = async () => {
      if (loadGeneration !== loadGenerationRef.current) {
        return;
      }

      const previewState = useCurrentJobStore.getState();
      const { activeJob: currentJob } = useStore.getState();

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

      const dataFetchKey = [
        currentJob?.key,
        previewState.previewMonth,
        previewState.previewYear,
        previewState.previewVariable,
      ].join("|");

      const dataChanged = previewDataFetchKeyRef.current !== dataFetchKey;
      const deferSwap = dataChanged;

      let displayGeoraster = displayedGeorasterRef.current;

      if (dataChanged) {
        setIsLoading(true);
        const requestJobKey = currentJob?.key;

        try {
          const georaster = (await fetchPreviewGeoraster()) as GeoRaster | null;

          if (loadGeneration !== loadGenerationRef.current) {
            return;
          }

          if (!georaster) {
            rawGeorasterRef.current = null;
            displayedGeorasterRef.current = null;
            previewDataFetchKeyRef.current = "";
            const stillCurrent =
              !useStore.getState().activeJobGroup &&
              useStore.getState().activeJob?.key === requestJobKey;
            if (stillCurrent) {
              console.warn("Preview data is not available for this job and date");
            }
            return;
          }

          rawGeorasterRef.current = georaster;
          previewDataFetchKeyRef.current = dataFetchKey;

          const clipState = useCurrentJobStore.getState();
          displayGeoraster = applyClipToRawGeoraster(
            georaster,
            currentJob?.loaded_geo_json,
            clipState.clipToPolygon,
            clipState.clipToPolygonMode
          );
          displayedGeorasterRef.current = displayGeoraster;
        } catch (error: unknown) {
          const err = error as Error;
          if (err.name !== "AbortError") {
            console.error("Error loading GeoTIFF:", err);
          }
          return;
        } finally {
          if (loadGeneration === loadGenerationRef.current) {
            setIsLoading(false);
          }
        }
      } else if (rawGeorasterRef.current) {
        const clipState = useCurrentJobStore.getState();
        displayGeoraster = applyClipToRawGeoraster(
          rawGeorasterRef.current,
          currentJob?.loaded_geo_json,
          clipState.clipToPolygon,
          clipState.clipToPolygonMode
        );
        displayedGeorasterRef.current = displayGeoraster;
      }

      if (!displayGeoraster || loadGeneration !== loadGenerationRef.current) {
        return;
      }

      const scaleState = useCurrentJobStore.getState();
      const scale = getPreviewLayerScale(
        displayGeoraster.mins[0],
        displayGeoraster.maxs[0],
        scaleState.dynamicPreviewColorScale,
        scaleState.previewMin,
        scaleState.previewMax
      );

      if (
        scale.shouldUpdateStore &&
        shouldUpdatePreviewScaleStore(scaleState.previewMin, scaleState.previewMax, scale.min, scale.max)
      ) {
        scaleState.setPreviewMin(scale.min);
        scaleState.setPreviewMax(scale.max);
      }

      const renderState = useCurrentJobStore.getState();
      const colormap = getPreviewColormap(renderState.previewVariable!);
      const layer = createPreviewLayer(
        displayGeoraster,
        scale.min,
        scale.max,
        colormap,
        loadGeneration,
        deferSwap
      );

      if (loadGeneration !== loadGenerationRef.current) {
        map.removeLayer(layer);
        if (pendingLayerRef.current === layer) {
          pendingLayerRef.current = null;
        }
        return;
      }

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
        const hoverState = useCurrentJobStore.getState();
        const hoverJob = useStore.getState().activeJob;
        const value = getPreviewValueAtLatLng(displayGeoraster, e.latlng.lat, e.latlng.lng);
        const insideClip =
          !hoverState.clipToPolygon ||
          !hoverJob?.loaded_geo_json ||
          isPreviewLocationVisible(
            e.latlng.lng,
            e.latlng.lat,
            displayGeoraster,
            hoverJob.loaded_geo_json,
            hoverState.clipToPolygonMode
          );

        let variableName = getPreviewDisplayName(hoverState.previewVariable!);
        if (
          hoverState.previewVariable === "PET" &&
          hoverState.previewYear &&
          Number(hoverState.previewYear) >= OPENET_TRANSITION_DATE
        ) {
          variableName = "ETo (Unadjusted)";
        }

        if (insideClip && value !== null && value !== undefined && !isNoData(value)) {
          const formattedValue = formatPreviewValue(value, hoverState.previewUnits);
          currentTooltip
            ?.setLatLng(e.latlng)
            .setContent(
              `<div style="text-align: center">${hoverJob?.name} (${new Date(
                Number(hoverState.previewYear),
                Number(hoverState.previewMonth) - 1
              ).toLocaleString("default", {
                month: "short",
              })} ${hoverState.previewYear})<br><b>${variableName}: ${formattedValue.value.toFixed(2)} ${formattedValue.units}</b></div>`
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

      mousemoveHandlerRef.current = mousemoveHandler;
      mouseoutHandlerRef.current = mouseoutHandler;
    };

    const timeoutId = setTimeout(() => {
      loadGeoTiff();
    }, 20);

    return () => {
      clearTimeout(timeoutId);
      if (tooltipRef.current) {
        tooltipRef.current.close();
      }
    };
  }, [
    showPreview,
    isPreviewReady,
    previewJobId,
    activeJobKey,
    activeJob?.loaded_geo_json,
    activeJob?.name,
    previewMonth,
    previewYear,
    previewVariable,
    dynamicPreviewColorScale,
    activePreviewMinValue,
    activePreviewMaxValue,
    clipToPolygon,
    clipToPolygonMode,
    activeJobGroup,
    fetchPreviewGeoraster,
    map,
    tooltip,
    setTooltip,
    cleanupLayers,
  ]);

  useEffect(() => {
    layerRef.current?.setOpacity(previewOpacity);
    pendingLayerRef.current?.setOpacity(previewOpacity);
  }, [previewOpacity]);

  if (activeJobGroup) {
    return null;
  }

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
