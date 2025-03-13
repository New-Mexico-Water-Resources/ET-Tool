import { useEffect, useMemo, useRef } from "react";
import { useMap } from "react-leaflet";
import Leaflet from "leaflet";
import useStore, { MapLayer } from "../utils/store";
import { area as turfArea } from "@turf/turf";
import { MAP_LAYER_OPTIONS } from "../utils/constants";

const GeoJSONLayer = ({
  data,
  validateBounds = true,
  fitToBounds = true,
}: {
  data: any;
  validateBounds?: boolean;
  fitToBounds?: boolean;
}) => {
  const map = useMap();
  const layerRef = useRef<any>(null);

  const minimumValidArea = useStore((state) => state.minimumValidArea);
  const maximumValidArea = useStore((state) => state.maximumValidArea);
  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const mapLayer = useMemo(() => (MAP_LAYER_OPTIONS as any)[mapLayerKey] as MapLayer, [mapLayerKey]);

  useEffect(() => {
    if (layerRef.current) {
      map.removeLayer(layerRef.current);
    }

    if (data && Object.keys(data).length > 0) {
      let area = turfArea(data);

      let isValidArea = !validateBounds || (area >= minimumValidArea && area <= maximumValidArea);
      const geoJsonLayer = new Leaflet.GeoJSON(data);

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
        if (mapLayer.maxZoom) {
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
  }, [data, map, minimumValidArea, mapLayerKey]);

  return null;
};

export default GeoJSONLayer;
