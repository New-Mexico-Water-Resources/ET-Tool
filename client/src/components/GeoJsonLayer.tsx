import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import Leaflet from "leaflet";
import useStore, { MapLayer } from "../utils/store";
import { area as turfArea } from "@turf/turf";
import { MAP_LAYER_OPTIONS, DROUGHT_MONITOR_METADATA } from "../utils/constants";
import type { Feature } from "geojson";
import { useAtomValue } from "jotai";
import { modisCountyStatsAtom } from "../utils/atoms";

interface ExtendedLayer extends Leaflet.Layer {
  labelMarker?: Leaflet.Marker;
  getBounds(): Leaflet.LatLngBounds;
}

const GeoJSONLayer = ({
  data,
  validateBounds = true,
  fitToBounds = true,
  showLabels = false,
  isDroughtMonitor = false,
  showAreaLabel = false,
  outline = false,
  tooltipText = "",
  onSelect = () => {},
}: {
  data?: any;
  validateBounds?: boolean;
  fitToBounds?: boolean;
  showLabels?: boolean;
  isDroughtMonitor?: boolean;
  showAreaLabel?: boolean;
  outline?: boolean;
  tooltipText?: string;
  onSelect?: (feature: Feature) => void;
}) => {
  const map = useMap();
  const layerRef = useRef<Leaflet.GeoJSON | null>(null);

  const minimumValidArea = useStore((state) => state.minimumValidArea);
  const maximumValidArea = useStore((state) => state.maximumValidArea);
  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const mapLayer = useMemo(() => (MAP_LAYER_OPTIONS as any)[mapLayerKey] as MapLayer, [mapLayerKey]);

  const modisCountyStats = useAtomValue(modisCountyStatsAtom);

  const layerData = useMemo(() => {
    if (data) {
      if (isDroughtMonitor) {
        return (data?.features || []).map((feature: any, index: number) => {
          const category = DROUGHT_MONITOR_METADATA[index].category;
          const color = DROUGHT_MONITOR_METADATA[index].color;
          const label = DROUGHT_MONITOR_METADATA[index].label;
          return { ...feature, properties: { ...feature.properties, color, category, label } };
        });
      }

      return data;
    } else {
      return {};
    }
  }, [data, isDroughtMonitor]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    if (layerData && Object.keys(layerData).length > 0) {
      const area = isDroughtMonitor ? 0 : turfArea(layerData);

      const isValidArea = !validateBounds || (area >= minimumValidArea && area <= maximumValidArea);
      const geoJsonLayer = new Leaflet.GeoJSON(layerData, {
        onEachFeature: (feature: Feature, layer: ExtendedLayer) => {
          if (!showLabels && layer.getTooltip) {
            layer.getTooltip()?.remove();
          }

          if (onSelect) {
            layer.on("click", () => {
              onSelect(feature);
            });
          }

          if (outline) {
            (layer as any).setStyle({
              color: "#3488FF",
              fillColor: "transparent",
            });
          }

          if (isDroughtMonitor && feature.properties?.color) {
            (layer as any).setStyle({
              fillColor: feature.properties.color,
              color: feature.properties.color,
              fillOpacity: 0.5,
              weight: 1,
            });
          }

          let tooltip = tooltipText;
          if (showLabels && feature.properties && tooltipText.length === 0) {
            let nameKey = "label";
            if (!isDroughtMonitor) {
              nameKey = Object.keys(feature.properties).find((key) => key.toLowerCase() === "namelsad") || "";
              if (!nameKey) {
                nameKey = Object.keys(feature.properties).find((key) => key.toLowerCase().includes("name")) || "";
              }
            }

            if (nameKey && feature.properties[nameKey]) {
              tooltip = feature.properties[nameKey];
            }

            if (!isDroughtMonitor && modisCountyStats?.band === mapLayer.name) {
              const countyStat = modisCountyStats?.countyStats?.[feature?.properties?.id];
              if (countyStat) {
                tooltip += `\n\nBand: ${modisCountyStats.band}`;
                tooltip += `\nTime: ${modisCountyStats.time}`;
                tooltip += `\nMean: ${countyStat.mean.toFixed(2)} ${mapLayer.units}`;
                tooltip += `\nStd Dev: ${countyStat.std_dev.toFixed(2)} ${mapLayer.units}`;
              }
            }
          }

          if (area && showAreaLabel) {
            const areaInAcres = area / 4046.86;
            tooltip += `\nArea: ${areaInAcres.toFixed(2)} acres`;
            tooltip = tooltip.trim();
          }

          if (tooltip) {
            layer.bindTooltip(tooltip, {
              direction: "top",
              offset: [0, -10],
              className: "geojson-label",
              permanent: false,
              sticky: true,
            });
          }
        },
      });

      // Add metadata to the layer
      if (!isValidArea) {
        geoJsonLayer.setStyle({
          color: "red",
          fillColor: "red",
          fillOpacity: 0.5,
        });
      }

      geoJsonLayer.addTo(map);
      if (fitToBounds) {
        if (mapLayer?.maxZoom) {
          map.setMaxZoom(mapLayer.maxZoom);
        }
        map.fitBounds(geoJsonLayer.getBounds(), { maxZoom: mapLayer.maxZoom });
      }
      layerRef.current = geoJsonLayer;
    }

    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
      }
    };
  }, [data, map, minimumValidArea, mapLayerKey, showLabels, isDroughtMonitor, modisCountyStats, mapLayer]);

  return null;
};

export default GeoJSONLayer;
