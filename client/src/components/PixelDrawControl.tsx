import { useCallback, useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { Feature } from "geojson";
import useStore from "../utils/store";
import useCurrentJobStore from "../utils/currentJobStore";
import {
  defaultPixelGridSpec,
  ET_PIXEL_GRID_MIN_ZOOM,
  pixelFeatureFromLonLat,
  pixelGridSpecFromGeoraster,
  pixelIndexKey,
  type PixelGridSpec,
  viewportPixelGrid,
} from "../utils/etPixelGrid";

const GRID_STYLE: L.PathOptions = {
  color: "#ffffff",
  weight: 1,
  opacity: 0.85,
  fillColor: "#ffffff",
  fillOpacity: 0.05,
};

const HOVER_STYLE: L.PathOptions = {
  color: "#3488FF",
  weight: 2,
  opacity: 1,
  fillColor: "#3488FF",
  fillOpacity: 0.25,
};

const PIXEL_DRAW_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" opacity="0.35"/><path fill="currentColor" d="M13 13h8v8h-8v-8z"/></svg>`;

function attachPixelDrawButton(map: L.Map, onLink: (link: HTMLAnchorElement | null) => void): () => void {
  let currentLink: HTMLAnchorElement | null = null;

  const tryAttach = () => {
    map.getContainer().querySelectorAll(".pixel-draw-control").forEach((el) => el.remove());

    const toolbar = map.getContainer().querySelector(".leaflet-draw-toolbar-top") as HTMLElement | null;
    if (!toolbar) {
      if (currentLink) {
        currentLink = null;
        onLink(null);
      }
      return;
    }

    let link = toolbar.querySelector("a.pixel-draw-button") as HTMLAnchorElement | null;
    if (!link) {
      link = L.DomUtil.create("a", "pixel-draw-button", toolbar) as HTMLAnchorElement;
      link.href = "#";
      link.title = "Draw single 30 m pixel";
      link.setAttribute("role", "button");
      link.setAttribute("aria-label", "Draw single 30 m pixel");
      link.innerHTML = PIXEL_DRAW_ICON_SVG;
      L.DomEvent.disableClickPropagation(link);
      L.DomEvent.on(link, "click", L.DomEvent.preventDefault);
    }

    if (link !== currentLink) {
      currentLink = link;
      onLink(link);
    }
  };

  tryAttach();
  requestAnimationFrame(tryAttach);
  const lateAttach = window.setTimeout(tryAttach, 150);

  const observer = new MutationObserver(tryAttach);
  observer.observe(map.getContainer(), { childList: true, subtree: true });

  return () => {
    window.clearTimeout(lateAttach);
    observer.disconnect();
    map.getContainer().querySelector("a.pixel-draw-button")?.remove();
    currentLink = null;
    onLink(null);
  };
}

const PixelDrawControl = () => {
  const map = useMap();
  const ingestUploadFile = useStore((state) => state.ingestUploadFile);
  const startNewJob = useStore((state) => state.startNewJob);
  const showUploadDialog = useStore((state) => state.showUploadDialog);
  const activeJob = useStore((state) => state.activeJob);
  const activeJobGroup = useStore((state) => state.activeJobGroup);

  const showPreview = useCurrentJobStore((state) => state.showPreview);
  const previewMonth = useCurrentJobStore((state) => state.previewMonth);
  const previewYear = useCurrentJobStore((state) => state.previewYear);
  const previewVariable = useCurrentJobStore((state) => state.previewVariable);
  const fetchPreviewGeoraster = useCurrentJobStore((state) => state.fetchPreviewGeoraster);

  const [pixelMode, setPixelMode] = useState(false);
  const [mountEl, setMountEl] = useState<HTMLAnchorElement | null>(null);
  const [gridSpec, setGridSpec] = useState<PixelGridSpec>(() => defaultPixelGridSpec());

  const gridLayerRef = useRef<L.GeoJSON | null>(null);
  const hoveredLayerRef = useRef<L.Layer | null>(null);
  const hoveredKeyRef = useRef<string | null>(null);
  const pixelModeRef = useRef(false);
  const gridSpecRef = useRef(gridSpec);

  useEffect(() => {
    pixelModeRef.current = pixelMode;
  }, [pixelMode]);

  useEffect(() => {
    gridSpecRef.current = gridSpec;
  }, [gridSpec]);

  useEffect(() => {
    let cancelled = false;

    const loadPreviewGrid = async () => {
      if (!showPreview || activeJobGroup || !activeJob?.key) {
        setGridSpec(defaultPixelGridSpec());
        return;
      }

      const georaster = await fetchPreviewGeoraster();
      if (cancelled) {
        return;
      }

      if (georaster) {
        setGridSpec(pixelGridSpecFromGeoraster(georaster));
      } else {
        setGridSpec(defaultPixelGridSpec());
      }
    };

    void loadPreviewGrid();

    return () => {
      cancelled = true;
    };
  }, [
    activeJob?.key,
    activeJobGroup,
    fetchPreviewGeoraster,
    previewMonth,
    previewVariable,
    previewYear,
    showPreview,
  ]);

  const clearGrid = useCallback(() => {
    if (gridLayerRef.current) {
      map.removeLayer(gridLayerRef.current);
      gridLayerRef.current = null;
    }
    hoveredLayerRef.current = null;
    hoveredKeyRef.current = null;
  }, [map]);

  const selectPixel = useCallback(
    (lon: number, lat: number) => {
      const feature = pixelFeatureFromLonLat(lon, lat, gridSpecRef.current);

      clearGrid();
      setPixelMode(false);
      map.getContainer().style.cursor = "";

      if (!showUploadDialog) {
        startNewJob();
      }

      const strippedLon = lon.toFixed(4);
      const strippedLat = lat.toFixed(4);

      const syntheticFile = new File([JSON.stringify(feature)], `Point_${strippedLon}_${strippedLat}.geojson`, {
        type: "application/json",
      });
      void ingestUploadFile(syntheticFile);
    },
    [clearGrid, ingestUploadFile, map, showUploadDialog, startNewJob]
  );

  const refreshGrid = useCallback(() => {
    if (!pixelModeRef.current) {
      return;
    }

    clearGrid();

    if (map.getZoom() < ET_PIXEL_GRID_MIN_ZOOM) {
      return;
    }

    const bounds = map.getBounds();
    const spec = gridSpecRef.current;
    const grid = viewportPixelGrid(
      {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      },
      spec
    );

    if (grid.features.length === 0) {
      return;
    }

    gridLayerRef.current = L.geoJSON(grid, {
      style: GRID_STYLE,
      interactive: true,
      onEachFeature: (feature: Feature, layer) => {
        layer.on("click", (event: L.LeafletMouseEvent) => {
          if (!pixelModeRef.current) {
            return;
          }
          L.DomEvent.stop(event);
          selectPixel(event.latlng.lng, event.latlng.lat);
        });

        layer.on("mouseover", () => {
          if (!pixelModeRef.current) {
            return;
          }
          hoveredLayerRef.current = layer;
          hoveredKeyRef.current = pixelIndexKey({
            col: feature.properties?.pixelCol as number,
            row: feature.properties?.pixelRow as number,
          });
          (layer as L.Path).setStyle(HOVER_STYLE);
        });

        layer.on("mouseout", () => {
          if (hoveredLayerRef.current === layer) {
            (layer as L.Path).setStyle(GRID_STYLE);
            hoveredLayerRef.current = null;
            hoveredKeyRef.current = null;
          }
        });
      },
    }).addTo(map);
  }, [clearGrid, map, selectPixel]);

  useEffect(() => {
    if (pixelMode) {
      refreshGrid();
    }
  }, [gridSpec, pixelMode, refreshGrid]);

  useEffect(() => {
    return attachPixelDrawButton(map, setMountEl);
  }, [map]);

  useEffect(() => {
    if (!mountEl) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      L.DomEvent.preventDefault(event);
      setPixelMode((active) => !active);
    };

    mountEl.classList.toggle("pixel-draw-active", pixelMode);
    mountEl.addEventListener("click", handleClick);

    return () => {
      mountEl.removeEventListener("click", handleClick);
    };
  }, [mountEl, pixelMode]);

  useEffect(() => {
    if (!pixelMode) {
      clearGrid();
      map.getContainer().style.cursor = "";
      return;
    }

    map.getContainer().style.cursor = "crosshair";
    refreshGrid();

    const onMoveEnd = () => refreshGrid();
    const onClick = (event: L.LeafletMouseEvent) => {
      if (!pixelModeRef.current) {
        return;
      }
      L.DomEvent.stop(event);
      selectPixel(event.latlng.lng, event.latlng.lat);
    };

    map.on("moveend", onMoveEnd);
    map.on("zoomend", onMoveEnd);
    map.on("click", onClick);

    return () => {
      map.off("moveend", onMoveEnd);
      map.off("zoomend", onMoveEnd);
      map.off("click", onClick);
    };
  }, [clearGrid, map, pixelMode, refreshGrid, selectPixel]);

  useEffect(() => {
    return () => {
      clearGrid();
    };
  }, [clearGrid]);

  return null;
};

export default PixelDrawControl;
