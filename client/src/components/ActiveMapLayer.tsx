import { memo, useEffect, useMemo } from "react";
import L from "leaflet";
import { TileLayer, WMSTileLayer, useMap } from "react-leaflet";
import { MAP_LAYER_OPTIONS } from "../utils/constants";
import useStore, { MapLayer } from "../utils/store";

const injectLayer = (layer: MapLayer, variable: string, value: string | number) => {
  const newLayer = JSON.parse(JSON.stringify(layer));
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

const formatUtcDateShort = (d: Date) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const formatCompositePeriod = (endIso: string, inclusiveDays: number) => {
  const [y, m, d] = endIso.split("-").map(Number);
  if (!y || !m || !d) return endIso;
  const end = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (inclusiveDays - 1));
  return `${formatUtcDateShort(start)} - ${formatUtcDateShort(end)}`;
};

const injectCompositePeriodAttribution = (layer: MapLayer, tileDate: string): MapLayer => {
  const days = layer.compositePeriodDays;
  if (!days || !tileDate || !layer.attribution.includes("{compositePeriod}")) {
    return layer;
  }
  return {
    ...layer,
    attribution: layer.attribution.replace("{compositePeriod}", formatCompositePeriod(tileDate, days)),
  };
};

const ActiveMapLayer = () => {
  const map = useMap();

  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const refreshType = useStore((state) => state.refreshType);
  const minColor = useStore((state) => state.minimumBaseMapColorBound);
  const maxColor = useStore((state) => state.maximumBaseMapColorBound);
  const tileDate = useStore((state) => state.tileDate);
  const comparisonMode = useStore((state) => state.comparisonMode);

  const effectiveTileDate = useMemo(() => {
    let mapLayer = (MAP_LAYER_OPTIONS as any)?.[mapLayerKey] as MapLayer | undefined;
    if (!mapLayer) {
      mapLayer = MAP_LAYER_OPTIONS["Google Satellite"] as MapLayer;
    }
    return tileDate || mapLayer.time || "";
  }, [mapLayerKey, tileDate]);

  const activeMapLayer = useMemo(() => {
    let mapLayer = (MAP_LAYER_OPTIONS as any)?.[mapLayerKey] as MapLayer;
    if (!mapLayer) {
      mapLayer = MAP_LAYER_OPTIONS["Google Satellite"];
    }

    let layer = injectTimeIntoLayer(mapLayer, effectiveTileDate);
    layer = injectLayer(layer, "refresh", refreshType);
    layer = injectLayer(layer, "minColor", minColor);
    layer = injectLayer(layer, "maxColor", maxColor);
    layer = injectLayer(layer, "mode", comparisonMode);
    layer = injectLayer(layer, "maxZoom", layer.maxZoom);
    layer = injectCompositePeriodAttribution(layer, effectiveTileDate);

    return layer;
  }, [mapLayerKey, effectiveTileDate, refreshType, minColor, maxColor, comparisonMode]);

  useEffect(() => {
    if (activeMapLayer?.maxZoom) {
      map.setMaxZoom(activeMapLayer.maxZoom);
    }

    const currentZoom = map.getZoom();
    if (activeMapLayer?.maxZoom && currentZoom > activeMapLayer?.maxZoom) {
      map.setZoom(activeMapLayer?.maxZoom);
    }
  }, [activeMapLayer, map]);

  const BackgroundTileLayer = useMemo(() => {
    if (activeMapLayer.backgroundProvider && (MAP_LAYER_OPTIONS as any)[activeMapLayer.backgroundProvider]) {
      const backgroundLayer = (MAP_LAYER_OPTIONS as any)[activeMapLayer.backgroundProvider] as MapLayer;

      let layer = injectTimeIntoLayer(backgroundLayer, effectiveTileDate);
      layer = injectLayer(layer, "refresh", refreshType);
      layer = injectLayer(layer, "minColor", minColor);
      layer = injectLayer(layer, "maxColor", maxColor);
      layer = injectLayer(layer, "mode", comparisonMode);
      layer = injectLayer(layer, "maxZoom", layer.maxZoom);

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
  }, [activeMapLayer, effectiveTileDate, refreshType, minColor, maxColor, comparisonMode]);

  const LabelsLayer = useMemo(() => {
    if (activeMapLayer.backgroundProvider && (MAP_LAYER_OPTIONS as any)[activeMapLayer.labelsProvider]) {
      const labelsLayer = (MAP_LAYER_OPTIONS as any)[activeMapLayer.labelsProvider] as MapLayer;
      let layer = injectTimeIntoLayer(labelsLayer, effectiveTileDate);
      layer = injectLayer(layer, "refresh", refreshType);
      layer = injectLayer(layer, "minColor", minColor);
      layer = injectLayer(layer, "maxColor", maxColor);
      layer = injectLayer(layer, "mode", comparisonMode);
      layer = injectLayer(layer, "maxZoom", layer.maxZoom);

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
  }, [activeMapLayer, effectiveTileDate, refreshType, minColor, maxColor, comparisonMode]);

  const basemapInstanceKey = useMemo(
    () => `${activeMapLayer.url}\0${activeMapLayer.wmsLayers ?? ""}`,
    [activeMapLayer.url, activeMapLayer.wmsLayers]
  );

  const wmsTileParams = useMemo(() => {
    if (!activeMapLayer.wmsLayers) {
      return null;
    }

    return {
      layers: activeMapLayer.wmsLayers,
      format: "image/png" as const,
      transparent: false,
      version: "1.1.1" as const,
    };
  }, [activeMapLayer.wmsLayers]);

  return (
    <>
      {activeMapLayer.wmsLayers ? (
        <WMSTileLayer
          key={basemapInstanceKey}
          url={activeMapLayer.url}
          params={wmsTileParams!}
          crs={L.CRS.EPSG4326}
          attribution={activeMapLayer.attribution}
          maxZoom={activeMapLayer.maxZoom}
          maxNativeZoom={activeMapLayer.maxZoom}
          zIndex={1}
          updateWhenIdle
          keepBuffer={4}
        />
      ) : (
        <TileLayer
          key={basemapInstanceKey}
          url={activeMapLayer.url}
          attribution={activeMapLayer.attribution}
          maxNativeZoom={activeMapLayer.maxZoom}
          maxZoom={activeMapLayer.maxZoom}
          subdomains={activeMapLayer.subdomains || []}
          bounds={activeMapLayer?.bounds}
          tms={activeMapLayer?.tms || false}
          zIndex={1}
          updateWhenIdle
          keepBuffer={4}
        />
      )}
      {BackgroundTileLayer}
      {LabelsLayer}
    </>
  );
};

export default memo(ActiveMapLayer);
