import { FC, useEffect, useState, useRef, useCallback } from "react";
import { useMap } from "react-leaflet";
// @ts-expect-error - No type definitions available
import parseGeoraster from "georaster";
// @ts-expect-error - No type definitions available
import GeoRasterLayer from "georaster-layer-for-leaflet";
import useCurrentJobStore from "../utils/currentJobStore";
import { ET_COLORMAP } from "../utils/constants";
import { Tooltip, LeafletMouseEvent } from "leaflet";
import useStore from "../utils/store";

import { OPENET_TRANSITION_DATE } from "../utils/constants";

// Add CSS to disable transitions on Leaflet layers
const style = document.createElement("style");
style.textContent = `
  .active-monthly-map-layer .leaflet-tile {
    opacity: 1 !important;
    visibility: visible !important;
    transition: none !important;
  }
`;
document.head.appendChild(style);

// Add CSS for crossfade effect
const styleCrossfade = document.createElement("style");
styleCrossfade.textContent = `
  .active-monthly-map-layer {
    transition: opacity 0.3s ease-in-out !important;
  }
  .active-monthly-map-layer.fade-out {
    opacity: 0 !important;
  }
  .active-monthly-map-layer.fade-in {
    opacity: 1 !important;
  }
`;
document.head.appendChild(styleCrossfade);

// Helper function to convert hex to RGB
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

  // Get preview state from currentJobStore
  const showPreview = useCurrentJobStore((state) => state.showPreview);
  const setShowPreview = useCurrentJobStore((state) => state.setShowPreview);
  const previewMonth = useCurrentJobStore((state) => state.previewMonth);
  const setPreviewMonth = useCurrentJobStore((state) => state.setPreviewMonth);
  const previewYear = useCurrentJobStore((state) => state.previewYear);
  const setPreviewYear = useCurrentJobStore((state) => state.setPreviewYear);
  const previewVariable = useCurrentJobStore((state) => state.previewVariable);
  const setPreviewVariable = useCurrentJobStore((state) => state.setPreviewVariable);
  const fetchMonthlyGeojson = useCurrentJobStore((state) => state.fetchMonthlyGeojson);
  const setAvailableDays = useCurrentJobStore((state) => state.setAvailableDays);
  const activeJob = useStore((state) => state.activeJob);

  // Clean up function to remove all layers and event listeners
  const cleanupLayers = useCallback(() => {
    // Clear any pending fade timeouts
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

  // Function to create a new layer with crossfade
  const createLayerWithCrossfade = async (georaster: GeoRaster, minValue: number, maxValue: number, colormap: string[]) => {
    // Create the new layer
    const newLayer = new GeoRasterLayer({
      georaster: georaster,
      opacity: 0,
      resolution: 256,
      pixelValuesToColorFn: (value: number) => {
        const normalizedValue = (value - minValue) / (maxValue - minValue);
        return getInterpolatedColor(normalizedValue, colormap);
      },
      debugLevel: 1,
      transition: false,
      noWrap: true,
      zIndex: 1,
      useCanvas: true,
      updateWhenIdle: false,
      updateWhenZooming: false,
      updateWhenMoving: false,
      className: "active-monthly-map-layer fade-in",
    }) as unknown as GeoRasterLayer;

    // Add the new layer to the map
    newLayer.addTo(map);

    // If there's an existing layer, fade it out
    if (layerRef.current) {
      const oldLayer = layerRef.current;
      const oldLayerElement = oldLayer.getContainer();

      if (oldLayerElement) {
        // Add fade-out class to old layer
        oldLayerElement.classList.add("fade-out");

        // After fade-out completes, remove the old layer
        fadeTimeoutRef.current = setTimeout(() => {
          map.removeLayer(oldLayer);
        }, 300);
      } else {
        // If no element found, just remove the layer
        map.removeLayer(oldLayer);
      }
    }

    // Fade in the new layer
    setTimeout(() => {
      newLayer.setOpacity(1);
    }, 10);

    return newLayer;
  };

  useEffect(() => {
    if (activeJob?.id !== previewJobId) {
      setPreviewJobId(activeJob?.id || "");
      setPreviewMonth(1);
      setPreviewYear(activeJob?.start_year || null);
      setPreviewVariable("ET");
      setShowPreview(false);
      cleanupLayers();
      setAvailableDays([]);
    }
  }, [activeJob, previewJobId, setPreviewMonth, setPreviewYear, setPreviewVariable, setShowPreview, setAvailableDays]);

  useEffect(() => {
    // Clean up when component unmounts
    return () => {
      cleanupLayers();

      // Clean up any pending operations
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [map]);

  // Add a new useEffect to handle tooltip visibility when showPreview changes
  useEffect(() => {
    if (!showPreview) {
      cleanupLayers();
    }
  }, [showPreview, cleanupLayers]);

  useEffect(() => {
    const loadGeoTiff = async () => {
      // If already loading, cancel the previous request
      if (isLoading) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        if (loadTimeoutRef.current) {
          clearTimeout(loadTimeoutRef.current);
        }
      }

      // Create a new abort controller for this request
      abortControllerRef.current = new AbortController();

      // Set loading state
      setIsLoading(true);

      // Clean up existing tooltips and event listeners before loading new data
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

      // Only proceed if preview is enabled and we have all required data
      if (!showPreview || !previewMonth || !previewYear || !previewVariable) {
        setIsLoading(false);
        return;
      }

      try {
        // Fetch the GeoTIFF data
        const arrayBuffer = await fetchMonthlyGeojson();

        if (!arrayBuffer) {
          console.error("Failed to fetch GeoTIFF data");
          setIsLoading(false);
          return;
        }

        // Parse the GeoTIFF data
        const georaster = await parseGeoraster(arrayBuffer);

        // Determine colormap based on variable type
        const colormap = ET_COLORMAP;

        let minValue = georaster.mins[0];
        let maxValue = georaster.maxs[0];

        if (minValue === maxValue) {
          minValue = 0;
          maxValue = Math.max(maxValue, 300);
        }

        // Create the new layer with crossfade
        const layer = await createLayerWithCrossfade(georaster, minValue, maxValue, colormap);

        // Create tooltip
        const newTooltip = new Tooltip({
          permanent: false,
          direction: "top",
          offset: [0, -10],
          className: "custom-tooltip",
        });

        // Add mouse move handler to update tooltip
        const mousemoveHandler = (e: LeafletMouseEvent) => {
          // Close any existing tooltips first
          if (tooltipRef.current) {
            tooltipRef.current.close();
          }

          const value = getValueAtLatLng(georaster, e.latlng.lat, e.latlng.lng);

          let variableName: string = previewVariable;
          if (previewVariable === "PET" && previewYear && Number(previewYear) >= OPENET_TRANSITION_DATE) {
            variableName = "ETo (Unadjusted)";
          }

          if (value !== null && value !== undefined) {
            const units = "mm/month";
            newTooltip
              .setLatLng(e.latlng)
              .setContent(`${variableName}: ${value.toFixed(2)} ${units}`)
              .openOn(map);
          } else {
            newTooltip.close();
          }
        };

        // Add mouse move handler
        map.on("mousemove", mousemoveHandler);

        // Close tooltip on mouse out
        const mouseoutHandler = () => {
          newTooltip.close();
        };

        map.on("mouseout", mouseoutHandler);

        // Store references to the current layer and handlers
        layerRef.current = layer;
        tooltipRef.current = newTooltip;
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

    // Debounce the loadGeoTiff function to prevent rapid consecutive calls
    loadTimeoutRef.current = setTimeout(() => {
      loadGeoTiff();
    }, 20);

    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, [showPreview, previewMonth, previewYear, previewVariable, map, fetchMonthlyGeojson]);

  return null;
};

export default ActiveMonthlyMapLayer;
