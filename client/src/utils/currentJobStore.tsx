import { create } from "zustand";
import { API_URL } from "./constants";
import useStore from "./store";

export interface Job {
  key: string;
  name: string;
  status: string;
  start_year: number;
  end_year: number;
  loaded_geo_json?: any;

  [key: string]: any;
}

export type PreviewVariableType = "ET" | "PET" | "ET_MIN" | "COUNT";

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
  showPreview: boolean;
  previewDay: number | string | null;
  availableDays: AvailableDay[];

  monthlyGeojsonCache: Record<string, ArrayBuffer>;
}

interface Setters {
  setPreviewMonth: (month: number | string | null) => void;
  setPreviewYear: (year: number | string | null) => void;
  setPreviewVariable: (variable: PreviewVariableType | null) => void;
  setShowPreview: (show: boolean) => void;
  setPreviewDay: (day: number | string | null) => void;
  setAvailableDays: (days: AvailableDay[]) => void;
}

interface Actions {
  fetchMonthlyGeojson: () => Promise<ArrayBuffer | null>;
  getAvailableDays: () => Promise<AvailableDay[] | null>;
}

const useCurrentJobStore = create<Store & Setters & Actions>((set, get) => ({
  previewMonth: 1,
  setPreviewMonth: (month) => set({ previewMonth: month }),
  previewYear: null,
  setPreviewYear: (year) => set({ previewYear: year }),
  previewVariable: "ET",
  setPreviewVariable: (variable) => set({ previewVariable: variable }),
  showPreview: false,
  setShowPreview: (show) => set({ showPreview: show }),
  previewDay: null,
  setPreviewDay: (day) => set({ previewDay: day }),
  availableDays: [],
  setAvailableDays: (days) => set({ availableDays: days }),

  monthlyGeojsonCache: {},
  fetchMonthlyGeojson: async () => {
    const { previewMonth, previewYear, previewVariable } = get();

    const { activeJob, authAxios } = useStore.getState();

    if (!activeJob || !activeJob.key) {
      console.error("No current job selected");
      return null;
    }

    if (!previewMonth || !previewYear) {
      console.error("No preview month or year selected");
      return null;
    }

    const cache = get().monthlyGeojsonCache;
    const cacheKey = `${previewMonth}-${previewYear}-${previewVariable}-${activeJob?.key}`;

    if (cache[cacheKey]) {
      return cache[cacheKey];
    }

    const month = parseInt(previewMonth as string);
    const year = parseInt(previewYear as string);

    // Make sure year is between start and end year
    if (year < activeJob.start_year || year > activeJob.end_year) {
      console.error("Invalid preview year");
      return null;
    }

    if (isNaN(month) || isNaN(year)) {
      console.error("Invalid preview month or year");
      return null;
    }

    try {
      const axiosInstance = authAxios();
      if (!axiosInstance) {
        console.error("No authAxios instance found");
        return null;
      }

      const response = await axiosInstance.get(
        `${API_URL}/historical/monthly_geojson?key=${activeJob.key}&month=${month}&year=${year}&variable=${previewVariable}`,
        { responseType: "arraybuffer" }
      );

      if (cache && cacheKey && response.data && response.data.length > 0) {
        cache[cacheKey] = response.data;
        set({ monthlyGeojsonCache: cache });
      }

      return response.data;
    } catch (error) {
      console.error("Error fetching monthly geojson:", error);
      return null;
    }
  },

  getAvailableDays: async () => {
    const { previewVariable } = get();

    const { activeJob, authAxios } = useStore.getState();

    if (!activeJob || !activeJob.key) {
      console.error("No current job selected");
      return null;
    }

    try {
      const axiosInstance = authAxios();
      if (!axiosInstance) {
        console.error("No authAxios instance found");
        return null;
      }

      const response = await axiosInstance.get(
        `${API_URL}/historical/available_dates?key=${activeJob.key}&variable=${previewVariable}`,
        { responseType: "json" }
      );

      return response.data;
    } catch (error) {
      console.error("Error fetching available days:", error);
      return null;
    }
  },
}));

export default useCurrentJobStore;
