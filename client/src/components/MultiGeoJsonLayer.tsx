import { FC, useEffect, useState } from "react";
import { useMap } from "react-leaflet";
import Leaflet from "leaflet";
import useStore from "../utils/store";
import { area as turfArea } from "@turf/turf";

const MultiGeoJSONLayer: FC<{ data: any[]; locations: any[] }> = ({ data, locations }) => {
  const map = useMap();
  const [destructors, setDestructors] = useState<(() => void)[]>([]);

  const loadedGeoJSON = useStore((state) => state.loadedGeoJSON);
  const setLocations = useStore((state) => state.setLocations);
  const minimumValidArea = useStore((state) => state.minimumValidArea);
  const maximumValidArea = useStore((state) => state.maximumValidArea);

  const [selectedMapLayer, setSelectedMapLayer] = useState<number | null>(null);

  // Listen to delete keypress
  useEffect(() => {
    const handleKeyPress = (event: any) => {
      if (selectedMapLayer !== null) {
        if (["Delete", "Backspace"].includes(event.key)) {
          locations[selectedMapLayer].visible = false;
          locations[selectedMapLayer].exists = true;
          setLocations([...locations]);
          setSelectedMapLayer(null);
        } else if (event.key === "Enter") {
          // Re-select
          locations[selectedMapLayer].visible = true;
          locations[selectedMapLayer].exists = true;
          setLocations([...locations]);
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);

    return () => {
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, [selectedMapLayer, locations]);

  useEffect(() => {
    destructors.forEach((destructor) => {
      destructor();
    });

    setDestructors([]);

    if (data && data.length > 0 && data.length === locations.length && !loadedGeoJSON) {
      let bounds: Leaflet.LatLngBounds | null = null;
      const destructors: (() => void)[] = [];

      let fitToBounds = true;

      locations.forEach((location) => {
        if (!data[location.id]) {
          return;
        }

        const layer = data[location.id];
        if (location?.exists) {
          fitToBounds = false;
        }

        const area = turfArea(layer);
        const isValidArea = area >= minimumValidArea && area <= maximumValidArea;

        const style: Record<string, any> = {};
        if (!location.visible) {
          style.fillOpacity = 0.5;
          style.color = "black";
          style.fillColor = "black";
        }

        if (!isValidArea && location.visible) {
          style.color = "red";
          style.fillColor = "red";
          style.fillOpacity = 0.5;
        }

        const geoJsonLayer = new Leaflet.GeoJSON(layer, { style });
        geoJsonLayer.on({
          dblclick: () => {
            setSelectedMapLayer(location.id);
            map.fitBounds(geoJsonLayer.getBounds());
          },
          click: () => {
            setSelectedMapLayer(location.id);
          },
        });

        const roundedAcres = Math.round(location.acres * 100) / 100;
        const roundedLat = location?.lat ? Math.round(location.lat * 1000000) / 1000000 : "NaN";
        const roundedLong = location?.long ? Math.round(location.long * 1000000) / 1000000 : "NaN";

        geoJsonLayer.bindTooltip(
          `<div style='padding:1px 3px 1px 3px;display:flex;flex-direction:column;'>
            <b>${location.name}</b>
            <b>Acres: ${roundedAcres}</b>
            <b>Coordinates: ${roundedLat}, ${roundedLong}</b>
            <b>Comments: ${location.comments || "None"}</b>
            ${location.crop ? `<b>Crop: ${location.crop}</b>` : ""}
          </div>`,
          {
            direction: "right",
            permanent: false,
            sticky: true,
            offset: [10, 0],
            opacity: 0.75,
            className: "custom-tooltip",
          }
        );
        geoJsonLayer.addTo(map);

        if (!bounds) {
          bounds = geoJsonLayer.getBounds();
        } else {
          bounds.extend(geoJsonLayer.getBounds());
        }

        destructors.push(() => geoJsonLayer.remove());
      });

      setDestructors(destructors);

      if (fitToBounds && bounds) {
        map.fitBounds(bounds);
      }
    }

    return () => {
      destructors.forEach((destructor) => {
        destructor();
      });
    };
  }, [data, map, loadedGeoJSON, locations]);

  return null;
};

export default MultiGeoJSONLayer;
