import { FeatureGroup, useMap } from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import * as turf from "@turf/turf";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import useStore, { MapLayer } from "../utils/store";
import { useCallback, useEffect, useMemo } from "react";
import { MAP_LAYER_OPTIONS } from "../utils/constants";

const getNumberOfEdges = (radius: number, segmentLength: number = 30) => {
  const circumference = 2 * Math.PI * radius;
  const edges = Math.round(circumference / segmentLength);
  return Math.max(edges, 6);
};

const DrawControls = () => {
  const setLoadedGeoJSON = useStore((state) => state.setLoadedGeoJSON);
  const setLoadedFile = useStore((state) => state.setLoadedFile);
  const setMultipolygons = useStore((state) => state.setMultipolygons);
  const setRows = useStore((state) => state.setLocations);
  const setActiveJob = useStore((state) => state.setActiveJob);
  const [jobName, setJobName] = useStore((state) => [state.jobName, state.setJobName]);
  const prepareGeoJSON = useStore((state) => state.prepareGeoJSON);
  const startNewJob = useStore((state) => state.startNewJob);

  const isRightPanelOpen = useStore((state) => state.isRightPanelOpen);

  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const tileDate = useStore((state) => state.tileDate);

  const activeMapLayer = useMemo(() => {
    let mapLayer = (MAP_LAYER_OPTIONS as any)?.[mapLayerKey] as MapLayer;
    if (!mapLayer) {
      mapLayer = MAP_LAYER_OPTIONS["Google Satellite"];
    }

    const layer = JSON.parse(JSON.stringify(mapLayer));
    if (tileDate) {
      layer.url = layer.url.replace("{time}", tileDate);
    } else if (layer.time) {
      layer.url = layer.url.replace("{time}", layer.time);
    }

    return layer;
  }, [mapLayerKey, tileDate]);

  const showColorScale = useMemo(() => {
    return activeMapLayer?.refresh;
  }, [activeMapLayer?.refresh]);

  const updateDrawControls = useCallback(() => {
    if (isRightPanelOpen) {
      const controls = document.querySelectorAll(".leaflet-right .leaflet-control");
      controls.forEach((control) => {
        if (control instanceof HTMLElement && control) {
          control.style.marginRight = "310px";

          const drawActions = document.querySelectorAll(".leaflet-touch .leaflet-right .leaflet-draw-actions");
          drawActions.forEach((action) => {
            if (action instanceof HTMLElement && action) {
              action.style.right = showColorScale ? "78px" : "38px";
            }
          });
        }
      });
    } else {
      const controls = document.querySelectorAll(".leaflet-right .leaflet-control");
      controls.forEach((control) => {
        if (control instanceof HTMLElement && control) {
          control.style.marginRight = "10px";

          const drawActions = document.querySelectorAll(".leaflet-touch .leaflet-right .leaflet-draw-actions");
          drawActions.forEach((action) => {
            if (action instanceof HTMLElement && action) {
              action.style.right = showColorScale ? "78px" : "38px";
            }
          });
        }
      });
    }
  }, [isRightPanelOpen, showColorScale]);

  const map = useMap();

  const handleCreated = useCallback(
    (evt: any) => {
      startNewJob();
      let geojson = evt.layer.toGeoJSON();

      if (evt.layerType === "circle") {
        const radius = evt.layer.getRadius();
        const latlng = evt.layer.getLatLng();

        const coordinates = [latlng.lng, latlng.lat];
        const numberOfEdges = getNumberOfEdges(radius, 30);
        const polygon = turf.circle(coordinates, radius, { steps: numberOfEdges, units: "meters" });

        geojson = {
          type: "Feature",
          properties: {},
          geometry: polygon.geometry,
        };
      }

      map.eachLayer((layer) => {
        if ((layer.options as any).color && !(layer as any)?.feature?.properties) {
          map.removeLayer(layer);
        }
      });

      const syntheticFile = new File([JSON.stringify(geojson)], "New Region.geojson", {
        type: "application/json",
      });
      setLoadedFile(syntheticFile);
      prepareGeoJSON(syntheticFile)?.then((response) => {
        setLoadedGeoJSON(response.data);
        setMultipolygons([]);
        setRows([]);
        setActiveJob(null);
        if (!jobName) {
          const fileName = "New Region";
          setJobName(fileName);
        }
      });

      setTimeout(() => {
        updateDrawControls();
      }, 100);
    },
    [
      jobName,
      map,
      setActiveJob,
      setJobName,
      setLoadedFile,
      setLoadedGeoJSON,
      setMultipolygons,
      setRows,
      startNewJob,
      prepareGeoJSON,
      updateDrawControls,
    ]
  );

  const editSettings = useMemo(() => {
    return {
      edit: false,
      remove: false,
    };
  }, []);

  const drawSettings = useMemo(() => {
    return {
      rectangle: false,
      polygon: true,
      circle: true,
      marker: false,
      circlemarker: false,
      polyline: false,
    };
  }, []);

  return (
    <FeatureGroup>
      <EditControl position="topright" onCreated={handleCreated} draw={drawSettings} edit={editSettings} />
    </FeatureGroup>
  );
};

export default DrawControls;
