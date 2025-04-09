import { FC, useEffect, useState } from "react";
import { useMap } from "react-leaflet";
// @ts-expect-error - No type definitions available
import parseGeoraster from "georaster";
// @ts-expect-error - No type definitions available
import GeoRasterLayer from "georaster-layer-for-leaflet";
import useCurrentJobStore from "../utils/currentJobStore";
import { ET_COLORMAP, DIFF_COLORMAP } from "../utils/constants";
import { Layer } from "leaflet";

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

const ActiveMonthlyMapLayer: FC = () => {
  const map = useMap();
  const [geoTiffLayer, setGeoTiffLayer] = useState<Layer | null>(null);

  // Get preview state from currentJobStore
  const showPreview = useCurrentJobStore((state) => state.showPreview);
  const previewMonth = useCurrentJobStore((state) => state.previewMonth);
  const previewYear = useCurrentJobStore((state) => state.previewYear);
  const previewVariable = useCurrentJobStore((state) => state.previewVariable);
  const fetchMonthlyGeojson = useCurrentJobStore((state) => state.fetchMonthlyGeojson);

  //   const loadedGeoJSON = useStore((state) => state.loadedGeoJSON);

  useEffect(() => {
    // Clean up previous layer when component unmounts or showPreview changes
    return () => {
      if (geoTiffLayer) {
        map.removeLayer(geoTiffLayer);
        setGeoTiffLayer(null);
      }
    };
  }, [map, geoTiffLayer]);

  useEffect(() => {
    const loadGeoTiff = async () => {
      // Remove existing layer if any
      if (geoTiffLayer) {
        map.removeLayer(geoTiffLayer);
        setGeoTiffLayer(null);
      }

      // Only proceed if preview is enabled and we have all required data
      if (!showPreview || !previewMonth || !previewYear || !previewVariable) {
        return;
      }

      try {
        // Fetch the GeoTIFF data
        const arrayBuffer = await fetchMonthlyGeojson(previewVariable);

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
          //   mask: loadedGeoJSON,
          //   mask_strategy: "outside",
          debugLevel: 0,
        }) as unknown as Layer;

        // Add the layer to the map
        layer.addTo(map);
        setGeoTiffLayer(layer);

        // Fit map bounds to the layer
        // @ts-expect-error - Ignoring type error for getBounds method
        map.fitBounds(layer.getBounds());
      } catch (error) {
        console.error("Error loading GeoTIFF:", error);
      }
    };

    loadGeoTiff();
  }, [showPreview, previewMonth, previewYear, previewVariable, map, fetchMonthlyGeojson]);

  // This component doesn't render anything directly
  return null;
};

export default ActiveMonthlyMapLayer;
