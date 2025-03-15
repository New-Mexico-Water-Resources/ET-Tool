import { useEffect, useMemo } from "react";
import { TileLayer, useMap } from "react-leaflet";
import { MAP_LAYER_OPTIONS } from "../utils/constants";
import useStore, { MapLayer } from "../utils/store";

const injectLayer = (layer: MapLayer, variable: string, value: string | number) => {
  let newLayer = JSON.parse(JSON.stringify(layer));
  if (variable) {
    newLayer.url = newLayer.url.replace(`{${variable}}`, value);
  } else if (newLayer?.[variable]) {
    newLayer.url = newLayer.url.replace(`{${variable}}`, newLayer[variable]);
  }

  return newLayer;
};

const injectTimeIntoLayer = (layer: MapLayer, time: string) => {
  return injectLayer(layer, "time", time);
};

const ActiveMapLayer = () => {
  const map = useMap();

  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const refreshType = useStore((state) => state.refreshType);
  const minColor = useStore((state) => state.minimumBaseMapColorBound);
  const maxColor = useStore((state) => state.maximumBaseMapColorBound);
  const tileDate = useStore((state) => state.tileDate);
  const comparisonMode = useStore((state) => state.comparisonMode);
  // const tileDate = "2021-01-01";

  const activeMapLayer = useMemo(() => {
    let mapLayer = (MAP_LAYER_OPTIONS as any)?.[mapLayerKey] as MapLayer;
    if (!mapLayer) {
      mapLayer = MAP_LAYER_OPTIONS["Google Satellite"];
    }

    let layer = injectTimeIntoLayer(mapLayer, tileDate);
    layer = injectLayer(layer, "refresh", refreshType);
    layer = injectLayer(layer, "minColor", minColor);
    layer = injectLayer(layer, "maxColor", maxColor);
    layer = injectLayer(layer, "mode", comparisonMode);

    return layer;
  }, [mapLayerKey, tileDate, refreshType, minColor, maxColor, comparisonMode]);

  useEffect(() => {
    if (activeMapLayer?.maxZoom) {
      map.setMaxZoom(activeMapLayer.maxZoom);
    }

    let currentZoom = map.getZoom();
    if (activeMapLayer?.maxZoom && currentZoom > activeMapLayer?.maxZoom) {
      map.setZoom(activeMapLayer?.maxZoom);
    }
  }, [activeMapLayer, map]);

  const BackgroundTileLayer = useMemo(() => {
    if (activeMapLayer.backgroundProvider && (MAP_LAYER_OPTIONS as any)[activeMapLayer.backgroundProvider]) {
      let backgroundLayer = (MAP_LAYER_OPTIONS as any)[activeMapLayer.backgroundProvider] as MapLayer;

      let layer = injectTimeIntoLayer(backgroundLayer, tileDate);
      layer = injectLayer(layer, "refresh", refreshType);
      layer = injectLayer(layer, "minColor", minColor);
      layer = injectLayer(layer, "maxColor", maxColor);
      layer = injectLayer(layer, "mode", comparisonMode);

      return (
        <TileLayer
          key={layer.name}
          url={layer.url}
          attribution={layer.attribution}
          maxNativeZoom={layer.maxZoom}
          maxZoom={layer.maxZoom}
          subdomains={layer.subdomains || []}
          bounds={layer?.bounds}
          opacity={0.8}
          zIndex={0}
        />
      );
    }

    return null;
  }, [activeMapLayer, tileDate, refreshType, minColor, maxColor, comparisonMode]);

  const LabelsLayer = useMemo(() => {
    if (activeMapLayer.backgroundProvider && (MAP_LAYER_OPTIONS as any)[activeMapLayer.labelsProvider]) {
      let labelsLayer = (MAP_LAYER_OPTIONS as any)[activeMapLayer.labelsProvider] as MapLayer;
      let layer = injectTimeIntoLayer(labelsLayer, tileDate);
      layer = injectLayer(layer, "refresh", refreshType);
      layer = injectLayer(layer, "minColor", minColor);
      layer = injectLayer(layer, "maxColor", maxColor);
      layer = injectLayer(layer, "mode", comparisonMode);

      return (
        <TileLayer
          key={layer.name}
          url={layer.url}
          attribution={layer.attribution}
          maxNativeZoom={layer.maxZoom}
          maxZoom={layer.maxZoom}
          subdomains={layer.subdomains || []}
          bounds={layer?.bounds}
          opacity={0.8}
          zIndex={2}
        />
      );
    }

    return null;
  }, [activeMapLayer, tileDate, refreshType, minColor, maxColor, comparisonMode]);

  return (
    <>
      <TileLayer
        key={activeMapLayer.name + tileDate + refreshType + minColor + maxColor + comparisonMode}
        url={activeMapLayer.url}
        attribution={activeMapLayer.attribution}
        maxNativeZoom={activeMapLayer.maxZoom}
        maxZoom={activeMapLayer.maxZoom}
        subdomains={activeMapLayer.subdomains || []}
        bounds={activeMapLayer?.bounds}
        tms={activeMapLayer?.tms || false}
        zIndex={1}
      />
      {BackgroundTileLayer}
      {LabelsLayer}
    </>
  );
};

export default ActiveMapLayer;
