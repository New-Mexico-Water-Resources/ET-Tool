import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import Leaflet from "leaflet";
import useStore, { MapLayer } from "../utils/store";
import { area as turfArea } from "@turf/turf";
import { MAP_LAYER_OPTIONS, DROUGHT_MONITOR_METADATA } from "../utils/constants";
import type { Feature } from "geojson";
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
}: {
  data?: any;
  validateBounds?: boolean;
  fitToBounds?: boolean;
  showLabels?: boolean;
  isDroughtMonitor?: boolean;
}) => {
  const map = useMap();
  const layerRef = useRef<Leaflet.GeoJSON | null>(null);

  const minimumValidArea = useStore((state) => state.minimumValidArea);
  const maximumValidArea = useStore((state) => state.maximumValidArea);
  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const mapLayer = useMemo(() => (MAP_LAYER_OPTIONS as any)[mapLayerKey] as MapLayer, [mapLayerKey]);

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
          if (isDroughtMonitor && feature.properties?.color) {
            (layer as any).setStyle({
              fillColor: feature.properties.color,
              color: feature.properties.color,
              fillOpacity: 0.5,
              weight: 1,
            });
          }

          if (showLabels && feature.properties) {
            let nameKey = "label";
            if (!isDroughtMonitor) {
              nameKey = Object.keys(feature.properties).find((key) => key.toLowerCase() === "namelsad") || "";
              if (!nameKey) {
                nameKey = Object.keys(feature.properties).find((key) => key.toLowerCase().includes("name")) || "";
              }
            }

            if (nameKey && feature.properties[nameKey]) {
              layer.bindTooltip(feature.properties[nameKey], {
                direction: "top",
                offset: [0, -10],
                className: "geojson-label",
                permanent: false,
                sticky: true,
              });
            }
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
  }, [data, map, minimumValidArea, mapLayerKey, showLabels, isDroughtMonitor]);

  return null;
};

export default GeoJSONLayer;
