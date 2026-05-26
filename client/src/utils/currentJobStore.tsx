import { create } from "zustand";
// @ts-expect-error - No type definitions available
import parseGeoraster from "georaster";
import { API_URL } from "./constants";
import useStore from "./store";
import { PreviewGeoRaster } from "./previewGeoraster";
import {
  CalculatedPreviewVariable,
  computeCalculatedPreview,
  getPreviewCalculation,
  isCalculatedPreviewVariable,
  isSourcePreviewVariable,
  PreviewVariableType,
  SourcePreviewVariable,
} from "./previewCalculations";

export interface Job {
  key: string;
  name: string;
  status: string;
  start_year: number;
  end_year: number;
  loaded_geo_json?: any;

  [key: string]: any;
}

export type { PreviewVariableType, SourcePreviewVariable, CalculatedPreviewVariable };
export type PreviewUnitsType = "mm" | "inches";
export type ClipToPolygonMode = "inclusive" | "exclusive" | "inverse";

export type AvailableDay = {
  year: number;
  month: number;
  day: number;
  date: string;
};

interface Store {
  previewMonth: number | string | null;
  previewYear: number | string | null;
  previewVariable: PreviewVariableType | null;
  previewUnits: PreviewUnitsType;
  showPreview: boolean;
  previewDay: number | string | null;
  availableDays: AvailableDay[];
  previewMin: number | string | null;
  previewMax: number | string | null;
  dynamicPreviewColorScale: boolean;
  previewOpacity: number;
  clipToPolygon: boolean;
  clipToPolygonMode: ClipToPolygonMode;

  monthlyGeojsonCache: Record<string, ArrayBuffer>;
  calculatedPreviewCache: Record<string, PreviewGeoRaster>;
  previewGeotiffDownloadJobId: string | null;
  bulkGeotiffDownloadJobId: string | null;
}

interface Setters {
  setPreviewMonth: (month: number | string | null) => void;
  setPreviewYear: (year: number | string | null) => void;
  setPreviewVariable: (variable: PreviewVariableType | null) => void;
  setPreviewUnits: (units: PreviewUnitsType) => void;
  setShowPreview: (show: boolean) => void;
  setPreviewDay: (day: number | string | null) => void;
  setAvailableDays: (days: AvailableDay[]) => void;
  setPreviewMin: (min: number | string | null) => void;
  setPreviewMax: (max: number | string | null) => void;
  setDynamicPreviewColorScale: (scale: boolean) => void;
  setPreviewOpacity: (opacity: number) => void;
  setClipToPolygon: (clip: boolean) => void;
  setClipToPolygonMode: (mode: ClipToPolygonMode) => void;
}

interface Actions {
  fetchVariableArrayBuffer: (variable: SourcePreviewVariable) => Promise<ArrayBuffer | null>;
  fetchMonthlyGeojson: () => Promise<ArrayBuffer | null>;
  fetchCalculatedPreviewGeoraster: (variable: CalculatedPreviewVariable) => Promise<PreviewGeoRaster | null>;
  fetchPreviewGeoraster: () => Promise<PreviewGeoRaster | null>;
  downloadGeotiff: (jobId: string) => Promise<void>;
  downloadAllGeotiffs: (jobId: string, options?: { clipped?: boolean }) => Promise<void>;
  downloadGeojson: (jobId: string, name: string) => Promise<void>;
}

const useCurrentJobStore = create<Store & Setters & Actions>((set, get) => ({
  previewMonth: 1,
  setPreviewMonth: (month) => set({ previewMonth: month }),
  previewYear: null,
  setPreviewYear: (year) => set({ previewYear: year }),
  previewVariable: "ET",
  setPreviewVariable: (variable) => set({ previewVariable: variable }),
  previewUnits: "mm",
  setPreviewUnits: (units) => set({ previewUnits: units }),
  showPreview: false,
  setShowPreview: (show) => set({ showPreview: show }),
  previewDay: null,
  setPreviewDay: (day) => set({ previewDay: day }),
  availableDays: [],
  setAvailableDays: (days) => set({ availableDays: days }),
  previewMin: null,
  setPreviewMin: (min) => set({ previewMin: min }),
  previewMax: null,
  setPreviewMax: (max) => set({ previewMax: max }),
  dynamicPreviewColorScale: true,
  setDynamicPreviewColorScale: (scale) => set({ dynamicPreviewColorScale: scale }),
  previewOpacity: 1,
  setPreviewOpacity: (opacity) =>
    set({ previewOpacity: Math.max(0, Math.min(1, opacity)) }),
  clipToPolygon: false,
  setClipToPolygon: (clip) => set({ clipToPolygon: clip }),
  clipToPolygonMode: "inclusive",
  setClipToPolygonMode: (mode) => set({ clipToPolygonMode: mode }),

  monthlyGeojsonCache: {},
  calculatedPreviewCache: {},
  previewGeotiffDownloadJobId: null,
  bulkGeotiffDownloadJobId: null,

  fetchVariableArrayBuffer: async (variable: SourcePreviewVariable): Promise<ArrayBuffer | null> => {
    const { previewMonth, previewYear } = get();
    const { activeJob, authAxios } = useStore.getState();

    if (!activeJob?.key || !previewMonth || !previewYear) {
      return null;
    }

    const month = parseInt(previewMonth as string);
    const year = parseInt(previewYear as string);

    if (year < activeJob.start_year || year > activeJob.end_year || isNaN(month) || isNaN(year)) {
      return null;
    }

    const cache = get().monthlyGeojsonCache;
    const cacheKey = `${previewMonth}-${previewYear}-${variable}-${activeJob.key}`;

    if (cache[cacheKey]) {
      return cache[cacheKey];
    }

    try {
      const axiosInstance = authAxios();
      if (!axiosInstance) {
        return null;
      }

      const response = await axiosInstance.get(
        `${API_URL}/historical/monthly?key=${activeJob.key}&month=${month}&year=${year}&variable=${variable}`,
        { responseType: "arraybuffer" }
      );

      if (response.data?.length > 0) {
        cache[cacheKey] = response.data;
        set({ monthlyGeojsonCache: cache });
      }

      return response.data;
    } catch (error) {
      console.error(`Error fetching ${variable} GeoTIFF:`, error);
      return null;
    }
  },

  fetchMonthlyGeojson: async () => {
    const { previewVariable } = get();

    if (!previewVariable || !isSourcePreviewVariable(previewVariable)) {
      console.error("Calculated preview variables must be fetched via fetchPreviewGeoraster");
      return null;
    }

    return get().fetchVariableArrayBuffer(previewVariable);
  },

  fetchCalculatedPreviewGeoraster: async (variable: CalculatedPreviewVariable) => {
    const { previewMonth, previewYear } = get();
    const { activeJob } = useStore.getState();

    if (!activeJob?.key || !previewMonth || !previewYear) {
      return null;
    }

    const cacheKey = `${previewMonth}-${previewYear}-${variable}-${activeJob.key}`;
    const cache = get().calculatedPreviewCache;

    if (cache[cacheKey]) {
      return cache[cacheKey];
    }

    try {
      const calculation = getPreviewCalculation(variable);
      const buffers = await Promise.all(
        calculation.sources.map((source) => get().fetchVariableArrayBuffer(source))
      );

      if (buffers.some((buffer) => !buffer)) {
        return null;
      }

      const rasters = await Promise.all(buffers.map((buffer) => parseGeoraster(buffer!)));
      const sources = Object.fromEntries(
        calculation.sources.map((source, index) => [source, rasters[index]])
      ) as Record<SourcePreviewVariable, PreviewGeoRaster>;

      const result = computeCalculatedPreview(variable, sources);

      cache[cacheKey] = result;
      set({ calculatedPreviewCache: cache });

      return result;
    } catch (error) {
      console.error(`Error computing ${getPreviewCalculation(variable).label} preview:`, error);
      return null;
    }
  },

  fetchPreviewGeoraster: async () => {
    const { previewVariable } = get();

    if (!previewVariable) {
      return null;
    }

    if (isCalculatedPreviewVariable(previewVariable)) {
      return get().fetchCalculatedPreviewGeoraster(previewVariable);
    }

    const arrayBuffer = await get().fetchMonthlyGeojson();
    if (!arrayBuffer) {
      return null;
    }

    return parseGeoraster(arrayBuffer);
  },

  downloadGeotiff: async (jobId: string) => {
    const {
      previewMonth,
      previewYear,
      previewVariable,
      clipToPolygon,
      clipToPolygonMode,
      previewUnits,
    } = get();

    if (!previewMonth || !previewYear || !previewVariable) {
      console.error("Missing preview month, year, or variable");
      return;
    }

    const { authAxios } = useStore.getState();
    const axiosInstance = authAxios();

    if (!axiosInstance) {
      console.error("No authAxios instance found");
      return;
    }

    if (get().previewGeotiffDownloadJobId || get().bulkGeotiffDownloadJobId) {
      return;
    }

    const params = new URLSearchParams({
      key: jobId,
      month: String(previewMonth),
      year: String(previewYear),
      variable: previewVariable,
      clip: String(clipToPolygon),
      clipMode: clipToPolygonMode,
      units: previewUnits,
    });

    set({ previewGeotiffDownloadJobId: jobId });

    try {
      const response = await axiosInstance.get(
        `${API_URL}/historical/monthly?${params.toString()}`,
        { responseType: "arraybuffer" }
      );

      if (response.data) {
        const blob = new Blob([response.data], { type: "image/tiff" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${jobId}-${previewYear}-${previewMonth}-${previewVariable}.tif`;
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        console.error("No response data from downloadGeotiff");
      }
    } catch (error) {
      console.error("Error downloading geotiff:", error);
      useStore.getState().setErrorMessage("Error downloading GeoTIFF");
    } finally {
      set({ previewGeotiffDownloadJobId: null });
    }
  },

  downloadAllGeotiffs: async (jobId: string, options?: { clipped?: boolean }) => {
    const { authAxios } = useStore.getState();
    const axiosInstance = authAxios();

    if (!axiosInstance) {
      console.error("No authAxios instance found");
      return;
    }

    if (get().previewGeotiffDownloadJobId || get().bulkGeotiffDownloadJobId) {
      return;
    }

    const params = new URLSearchParams({ key: jobId });
    if (options?.clipped) {
      params.set("clipped", "true");
    }

    set({ bulkGeotiffDownloadJobId: jobId });

    try {
      const response = await axiosInstance.get(
        `${API_URL}/historical/download?${params.toString()}`,
        { responseType: "arraybuffer" }
      );

      if (response.data) {
        const blob = new Blob([response.data], { type: "application/zip" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = options?.clipped ? `${jobId}-all-geotiffs-clipped.zip` : `${jobId}-all-geotiffs.zip`;
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        console.error("No response data from downloadAllGeotiffs");
      }
    } catch (error) {
      console.error("Error downloading geotiffs:", error);
      useStore.getState().setErrorMessage(
        options?.clipped ? "Error downloading clipped GeoTIFFs" : "Error downloading GeoTIFFs"
      );
    } finally {
      set({ bulkGeotiffDownloadJobId: null });
    }
  },

  downloadGeojson: async (jobId: string, name: string) => {
    const { authAxios } = useStore.getState();

    const axiosInstance = authAxios();

    if (!axiosInstance) {
      console.error("No authAxios instance found");
      return;
    }

    const escapedKey = encodeURIComponent(jobId);
    axiosInstance
      .get(`${API_URL}/geojson?key=${escapedKey}`)
      .then((response) => {
        const blob = new Blob([JSON.stringify(response.data)], { type: "application/json" });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;

        const escapedName = encodeURIComponent(name);
        a.download = `${escapedName}.geojson`;
        a.click();
      })
      .catch((error) => {
        console.error("Error downloading geojson:", error);
      });
  },
}));

export default useCurrentJobStore;
