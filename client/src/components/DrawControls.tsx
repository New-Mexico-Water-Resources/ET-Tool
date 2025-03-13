import { FeatureGroup, useMap } from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import * as turf from "@turf/turf";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import useStore from "../utils/store";
import { useCallback, useMemo } from "react";

const getNumberOfEdges = (radius: number, segmentLength: number = 30) => {
  let circumference = 2 * Math.PI * radius;
  let edges = Math.round(circumference / segmentLength);
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

  const map = useMap();

  const handleCreated = useCallback(
    (evt: any) => {
      startNewJob();
      let geojson = evt.layer.toGeoJSON();

      if (evt.layerType === "circle") {
        let radius = evt.layer.getRadius();
        let latlng = evt.layer.getLatLng();

        let coordinates = [latlng.lng, latlng.lat];
        let numberOfEdges = getNumberOfEdges(radius, 30);
        let polygon = turf.circle(coordinates, radius, { steps: numberOfEdges, units: "meters" });

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

      let syntheticFile = new File([JSON.stringify(geojson)], "New Region.geojson", {
        type: "application/json",
      });
      setLoadedFile(syntheticFile);
      prepareGeoJSON(syntheticFile)?.then((response) => {
        setLoadedGeoJSON(response.data);
        setMultipolygons([]);
        setRows([]);
        setActiveJob(null);
        if (!jobName) {
          let fileName = "New Region";
          setJobName(fileName);
        }
      });
    },
    [jobName, map]
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
