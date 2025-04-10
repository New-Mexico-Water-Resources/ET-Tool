import { FC, useEffect, useState } from "react";
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

// Helper function to get value at lat/lng from georaster
const getValueAtLatLng = (georaster: any, lat: number, lng: number) => {
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
  const [geoTiffLayer, setGeoTiffLayer] = useState<GeoRasterLayer | null>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

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

  useEffect(() => {
    if (activeJob?.id !== previewJobId) {
      setPreviewJobId(activeJob?.id || "");
      setPreviewMonth(1);
      setPreviewYear(activeJob?.start_year || null);
      setPreviewVariable("ET");
      setShowPreview(false);
      setGeoTiffLayer(null);
      setAvailableDays([]);
    }
  }, [activeJob, previewJobId, setPreviewMonth, setPreviewYear, setPreviewVariable, setShowPreview, setAvailableDays]);

  useEffect(() => {
    // Clean up previous layer and tooltip when component unmounts or showPreview changes
    return () => {
      if (geoTiffLayer) {
        map.removeLayer(geoTiffLayer);
        setGeoTiffLayer(null);
      }

      if (tooltip) {
        map.removeLayer(tooltip);
        setTooltip(null);
      }
    };
  }, [map, geoTiffLayer, tooltip]);

  // Add a new useEffect to handle tooltip visibility when showPreview changes
  useEffect(() => {
    if (!showPreview) {
      // Remove tooltip if it exists
      if (tooltip) {
        map.removeLayer(tooltip);
        setTooltip(null);
      }

      // Remove event listeners
      map.off("mousemove");
      map.off("mouseout");
    }
  }, [showPreview, tooltip, map]);

  useEffect(() => {
    const loadGeoTiff = async () => {
      // Remove existing layer if any
      if (geoTiffLayer) {
        map.removeLayer(geoTiffLayer);
        setGeoTiffLayer(null);
      }

      // Remove existing tooltip if any
      if (tooltip) {
        map.removeLayer(tooltip);
        setTooltip(null);
      }

      // Remove any existing event listeners
      map.off("mousemove");
      map.off("mouseout");

      // Only proceed if preview is enabled and we have all required data
      if (!showPreview || !previewMonth || !previewYear || !previewVariable) {
        return;
      }

      try {
        // Fetch the GeoTIFF data
        const arrayBuffer = await fetchMonthlyGeojson();

        if (!arrayBuffer) {
          console.error("Failed to fetch GeoTIFF data");
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

        // Create the GeoRasterLayer
        const layer = new GeoRasterLayer({
          georaster: georaster,
          opacity: 1,
          resolution: 256,
          pixelValuesToColorFn: (value: number) => {
            const normalizedValue = (value - minValue) / (maxValue - minValue);
            return getInterpolatedColor(normalizedValue, colormap);
          },
          debugLevel: 1, // Increase debug level
        }) as unknown as GeoRasterLayer;

        // Create tooltip
        const newTooltip = new Tooltip({
          permanent: false,
          direction: "top",
          offset: [0, -10],
          className: "custom-tooltip",
        });

        // Add the layer to the map first
        layer.addTo(map);
        // Add mouse move handler to update tooltip
        map.on("mousemove", (e: LeafletMouseEvent) => {
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
        });

        // Close tooltip on mouse out
        map.on("mouseout", () => {
          newTooltip.close();
        });

        setGeoTiffLayer(layer);
        setTooltip(newTooltip);

        map.fitBounds(layer.getBounds());
      } catch (error) {
        console.error("Error loading GeoTIFF:", error);
        setGeoTiffLayer(null);
        setTooltip(null);
      }
    };

    loadGeoTiff();
  }, [showPreview, previewMonth, previewYear, previewVariable, map, fetchMonthlyGeojson]);

  // This component doesn't render anything directly
  return null;
};

export default ActiveMonthlyMapLayer;
