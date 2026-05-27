import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "react-leaflet";
// @ts-expect-error - No type definitions available
import GeoRasterLayer from "georaster-layer-for-leaflet";
import { LeafletMouseEvent, Tooltip } from "leaflet";
import useCurrentJobStore from "../utils/currentJobStore";
import useStore, { MapLayer } from "../utils/store";
import { ET_COLORMAP, MAP_LAYER_OPTIONS, OPENET_TRANSITION_DATE } from "../utils/constants";
import { getPreviewColormap, getPreviewDisplayName } from "../utils/previewCalculations";
import { applyPreviewPolygonClip, isPreviewLocationVisible } from "../utils/previewPolygonClip";
import {
  formatPreviewValue,
  getPreviewValueAtLatLng,
  isNoData,
  PreviewGeoRaster,
  getPreviewLayerScale,
  shouldUpdatePreviewScaleStore,
} from "../utils/previewGeoraster";
import ColorScale from "./ColorScale";

type GroupPreviewSource = {
  jobName: string;
  georaster: PreviewGeoRaster;
  geojson: unknown;
  zIndex: number;
};

type GroupPreviewJobCache = {
  jobName: string;
  geojson: unknown;
  rawGeoraster: PreviewGeoRaster;
  locationId: number;
};

const GroupPreviewMapLayer: FC = () => {
  const map = useMap();
  const layerRefs = useRef<GeoRasterLayer[]>([]);
  const previewSourcesRef = useRef<GroupPreviewSource[]>([]);
  const jobDataCacheRef = useRef<GroupPreviewJobCache[]>([]);
  const dataFetchKeyRef = useRef("");
  const [cachedDataKey, setCachedDataKey] = useState("");
  const tooltipRef = useRef<Tooltip | null>(null);
  const mousemoveHandlerRef = useRef<((e: LeafletMouseEvent) => void) | null>(null);
  const mouseoutHandlerRef = useRef<(() => void) | null>(null);

  const activeJobGroup = useStore((state) => state.activeJobGroup);
  const locations = useStore((state) => state.locations);
  const activeJob = useStore((state) => state.activeJob);
  const isSidebarOpen = useStore((state) => state.isRightPanelOpen);
  const mapLayerKey = useStore((state) => state.mapLayerKey);

  const showPreview = useCurrentJobStore((state) => state.showPreview);
  const previewMonth = useCurrentJobStore((state) => state.previewMonth);
  const previewYear = useCurrentJobStore((state) => state.previewYear);
  const previewVariable = useCurrentJobStore((state) => state.previewVariable);
  const previewOpacity = useCurrentJobStore((state) => state.previewOpacity);
  const dynamicPreviewColorScale = useCurrentJobStore((state) => state.dynamicPreviewColorScale);
  const clipToPolygon = useCurrentJobStore((state) => state.clipToPolygon);
  const clipToPolygonMode = useCurrentJobStore((state) => state.clipToPolygonMode);
  const fetchPreviewGeorasterForJob = useCurrentJobStore((state) => state.fetchPreviewGeorasterForJob);
  const previewMin = useCurrentJobStore((state) => state.previewMin);
  const previewMax = useCurrentJobStore((state) => state.previewMax);

  const mapLayerHasColorScale = useMemo(() => {
    const mapLayer = (MAP_LAYER_OPTIONS as any)?.[mapLayerKey] as MapLayer;
    return !!mapLayer?.showColorScale;
  }, [mapLayerKey]);

  const dataFetchKey = useMemo(() => {
    const visibleKeys = locations
      .filter((location) => location.visible && location.jobKey)
      .map((location) => location.jobKey)
      .sort()
      .join(",");
    return [previewMonth, previewYear, previewVariable, visibleKeys].join("|");
  }, [locations, previewMonth, previewYear, previewVariable]);

  const cleanupHoverHandlers = useCallback(() => {
    if (mousemoveHandlerRef.current) {
      map.off("mousemove", mousemoveHandlerRef.current);
      mousemoveHandlerRef.current = null;
    }

    if (mouseoutHandlerRef.current) {
      map.off("mouseout", mouseoutHandlerRef.current);
      mouseoutHandlerRef.current = null;
    }

    tooltipRef.current?.close();
    tooltipRef.current = null;
  }, [map]);

  const removeMapLayers = useCallback(() => {
    layerRefs.current.forEach((layer) => {
      map.removeLayer(layer);
    });
    layerRefs.current = [];
    previewSourcesRef.current = [];
    cleanupHoverHandlers();
  }, [map, cleanupHoverHandlers]);

  const cleanupAll = useCallback(() => {
    removeMapLayers();
    jobDataCacheRef.current = [];
    dataFetchKeyRef.current = "";
  }, [removeMapLayers]);

  const attachHoverHandlers = useCallback(() => {
    cleanupHoverHandlers();

    const tooltip = new Tooltip({
      permanent: false,
      direction: "top",
      offset: [0, -10],
      className: "custom-tooltip",
    });
    tooltipRef.current = tooltip;

    const mousemoveHandler = (e: LeafletMouseEvent) => {
      const {
        clipToPolygon: clip,
        clipToPolygonMode: clipMode,
        previewVariable: variable,
        previewMonth: month,
        previewYear: year,
        previewUnits: units,
      } = useCurrentJobStore.getState();

      if (!variable || !month || !year) {
        tooltip.close();
        return;
      }

      const sources = [...previewSourcesRef.current].sort((a, b) => b.zIndex - a.zIndex);

      for (const source of sources) {
        const value = getPreviewValueAtLatLng(source.georaster, e.latlng.lat, e.latlng.lng);
        const insideClip =
          !clip ||
          !source.geojson ||
          isPreviewLocationVisible(
            e.latlng.lng,
            e.latlng.lat,
            source.georaster,
            source.geojson,
            clipMode
          );

        if (!insideClip || value === null || value === undefined || isNoData(value)) {
          continue;
        }

        let variableName = getPreviewDisplayName(variable);
        if (variable === "PET" && Number(year) >= OPENET_TRANSITION_DATE) {
          variableName = "ETo (Unadjusted)";
        }

        const formattedValue = formatPreviewValue(value, units);
        tooltip
          .setLatLng(e.latlng)
          .setContent(
            `<div style="text-align: center">${source.jobName} (${new Date(
              Number(year),
              Number(month) - 1
            ).toLocaleString("default", {
              month: "short",
            })} ${year})<br><b>${variableName}: ${formattedValue.value.toFixed(2)} ${formattedValue.units}</b></div>`
          )
          .openOn(map);
        return;
      }

      tooltip.close();
    };

    const mouseoutHandler = () => {
      tooltip.close();
    };

    map.on("mousemove", mousemoveHandler);
    map.on("mouseout", mouseoutHandler);
    mousemoveHandlerRef.current = mousemoveHandler;
    mouseoutHandlerRef.current = mouseoutHandler;
  }, [map, cleanupHoverHandlers]);

  useEffect(() => {
    // Always mounted alongside single-job preview — never touch previewMin/Max when inactive.
    if (!activeJobGroup) {
      cleanupAll();
      setCachedDataKey("");
      return;
    }

    if (!showPreview || !previewMonth || !previewYear || !previewVariable || !dataFetchKey) {
      cleanupAll();
      setCachedDataKey("");
      return;
    }

    if (dataFetchKeyRef.current === dataFetchKey) {
      return;
    }

    let cancelled = false;

    const fetchGroupData = async () => {
      const { activeJobGroup: currentGroup, locations: currentLocations, multipolygons: currentPolygons } =
        useStore.getState();

      if (!currentGroup) {
        return;
      }

      const visibleLocations = currentLocations.filter((location) => location.visible && location.jobKey);
      const nextCache: GroupPreviewJobCache[] = [];

      for (const location of visibleLocations) {
        if (cancelled) {
          return;
        }

        const job = currentGroup.jobs.find((entry) => entry.key === location.jobKey);
        const geojson = currentPolygons[location.id];
        if (!job?.key || !geojson || job.start_year == null || job.end_year == null) {
          continue;
        }

        const georaster = await fetchPreviewGeorasterForJob(job.key, job.start_year, job.end_year);
        if (!georaster || cancelled) {
          continue;
        }

        nextCache.push({
          jobName: job.name,
          geojson,
          rawGeoraster: georaster,
          locationId: location.id,
        });
      }

      if (cancelled) {
        return;
      }

      jobDataCacheRef.current = nextCache;
      dataFetchKeyRef.current = dataFetchKey;
      setCachedDataKey(dataFetchKey);
    };

    const timeoutId = setTimeout(() => {
      fetchGroupData();
    }, 20);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [activeJobGroup, showPreview, previewMonth, previewYear, previewVariable, dataFetchKey, fetchPreviewGeorasterForJob, cleanupAll]);

  useEffect(() => {
    if (!activeJobGroup) {
      return;
    }

    if (!cachedDataKey || !showPreview || !previewVariable || jobDataCacheRef.current.length === 0) {
      removeMapLayers();
      return;
    }

    let aggregateMin = Infinity;
    let aggregateMax = -Infinity;

    for (const cached of jobDataCacheRef.current) {
      const displayGeoraster = clipToPolygon
        ? applyPreviewPolygonClip(cached.rawGeoraster, cached.geojson, clipToPolygonMode)
        : cached.rawGeoraster;

      aggregateMin = Math.min(aggregateMin, displayGeoraster.mins[0]);
      aggregateMax = Math.max(aggregateMax, displayGeoraster.maxs[0]);
    }

    if (!Number.isFinite(aggregateMin) || !Number.isFinite(aggregateMax)) {
      removeMapLayers();
      return;
    }

    const previewState = useCurrentJobStore.getState();
    const scale = getPreviewLayerScale(
      aggregateMin,
      aggregateMax,
      previewState.dynamicPreviewColorScale,
      previewState.previewMin,
      previewState.previewMax
    );

    if (
      scale.shouldUpdateStore &&
      shouldUpdatePreviewScaleStore(previewState.previewMin, previewState.previewMax, scale.min, scale.max)
    ) {
      previewState.setPreviewMin(scale.min);
      previewState.setPreviewMax(scale.max);
    }

    const scaleMin = scale.min;
    const scaleMax = scale.max;

    removeMapLayers();

    const colormap = getPreviewColormap(previewVariable);
    const previewSources: GroupPreviewSource[] = [];

    for (const cached of jobDataCacheRef.current) {
      const displayGeoraster = clipToPolygon
        ? applyPreviewPolygonClip(cached.rawGeoraster, cached.geojson, clipToPolygonMode)
        : cached.rawGeoraster;

      const pixelValuesToColorFn = (value: number | number[]) => {
        const raw = Array.isArray(value) ? value[0] : value;
        if (isNoData(raw)) {
          return undefined;
        }
        const normalizedValue = (raw - scaleMin) / (scaleMax - scaleMin);
        const index = Math.max(0, Math.min(1, normalizedValue)) * (colormap.length - 1);
        return colormap[Math.round(index)];
      };

      const zIndex = 400 + cached.locationId;

      const layer = new GeoRasterLayer({
        georaster: displayGeoraster,
        opacity: previewOpacity,
        resolution: 256,
        pixelValuesToColorFn,
        noWrap: true,
        zIndex,
        className: "active-monthly-map-layer",
      }) as unknown as GeoRasterLayer;

      layer.addTo(map);
      layer.bringToFront();
      layerRefs.current.push(layer);

      previewSources.push({
        jobName: cached.jobName,
        georaster: displayGeoraster,
        geojson: cached.geojson,
        zIndex,
      });
    }

    previewSourcesRef.current = previewSources;

    if (previewSources.length > 0) {
      attachHoverHandlers();
    }
  }, [
    activeJobGroup,
    cachedDataKey,
    showPreview,
    previewVariable,
    previewOpacity,
    dynamicPreviewColorScale,
    previewMin,
    previewMax,
    clipToPolygon,
    clipToPolygonMode,
    map,
    attachHoverHandlers,
    removeMapLayers,
  ]);

  useEffect(() => {
    if (!activeJobGroup) {
      cleanupAll();
    }
  }, [activeJobGroup, cleanupAll]);

  useEffect(() => {
    layerRefs.current.forEach((layer) => {
      layer.setOpacity(previewOpacity);
    });
  }, [previewOpacity]);

  if (!activeJobGroup || !activeJob || !showPreview) {
    return null;
  }

  if (previewMin === null || previewMax === null || previewMin === previewMax) {
    return null;
  }

  return (
    <ColorScale
      label={`${activeJobGroup.groupName} (${new Date(Number(previewYear), Number(previewMonth) - 1).toLocaleString("default", {
        month: "short",
      })} ${previewYear})`}
      minValue={Number(previewMin)}
      maxValue={Number(previewMax)}
      colorScale={previewVariable ? getPreviewColormap(previewVariable) : ET_COLORMAP}
      style={{
        right: isSidebarOpen ? (mapLayerHasColorScale ? "400px" : "350px") : mapLayerHasColorScale ? "100px" : "50px",
        transition: "right 0.1s ease",
      }}
    />
  );
};

export default GroupPreviewMapLayer;
