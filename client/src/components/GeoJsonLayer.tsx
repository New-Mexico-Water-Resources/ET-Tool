import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import Leaflet from "leaflet";
import useStore, { MapLayer } from "../utils/store";
import { area as turfArea } from "@turf/turf";
import { MAP_LAYER_OPTIONS } from "../utils/constants";
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
}: {
  data: any;
  validateBounds?: boolean;
  fitToBounds?: boolean;
  showLabels?: boolean;
}) => {
  const map = useMap();
  const layerRef = useRef<Leaflet.GeoJSON | null>(null);

  const minimumValidArea = useStore((state) => state.minimumValidArea);
  const maximumValidArea = useStore((state) => state.maximumValidArea);
  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const mapLayer = useMemo(() => (MAP_LAYER_OPTIONS as any)[mapLayerKey] as MapLayer, [mapLayerKey]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    if (data && Object.keys(data).length > 0) {
      const area = turfArea(data);

      const isValidArea = !validateBounds || (area >= minimumValidArea && area <= maximumValidArea);
      const geoJsonLayer = new Leaflet.GeoJSON(data, {
        onEachFeature: (feature: Feature, layer: ExtendedLayer) => {
          if (showLabels && feature.properties) {
            // Prefer NAMELSAD over NAME
            let nameKey = Object.keys(feature.properties).find((key) => key.toLowerCase() === "namelsad");
            if (!nameKey) {
              nameKey = Object.keys(feature.properties).find((key) => key.toLowerCase().includes("name"));
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
  }, [data, map, minimumValidArea, mapLayerKey, showLabels]);

  return null;
};

export default GeoJSONLayer;
