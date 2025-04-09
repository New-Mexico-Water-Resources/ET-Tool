import { create } from "zustand";
import axios from "axios";
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

interface Store {
  currentJob: Job | null;
  previewMonth: number | string | null;
  previewYear: number | string | null;
  previewVariable: PreviewVariableType | null;
  showPreview: boolean;
}

interface Setters {
  setCurrentJob: (job: Job | null) => void;
  setPreviewMonth: (month: number | string | null) => void;
  setPreviewYear: (year: number | string | null) => void;
  setPreviewVariable: (variable: PreviewVariableType | null) => void;
  setShowPreview: (show: boolean) => void;
}

interface Actions {
  fetchMonthlyGeojson: (variable: string) => Promise<ArrayBuffer | null>;
}

const useCurrentJobStore = create<Store & Setters & Actions>((set, get) => ({
  currentJob: null,
  setCurrentJob: (job) => set({ currentJob: job }),

  previewMonth: 1,
  setPreviewMonth: (month) => set({ previewMonth: month }),
  previewYear: null,
  setPreviewYear: (year) => set({ previewYear: year }),
  previewVariable: "ET",
  setPreviewVariable: (variable) => set({ previewVariable: variable }),
  showPreview: false,
  setShowPreview: (show) => set({ showPreview: show }),

  fetchMonthlyGeojson: async () => {
    const { currentJob, previewMonth, previewYear, previewVariable } = get();

    if (!currentJob) {
      console.error("No current job selected");
      return null;
    }

    if (!previewMonth || !previewYear) {
      console.error("No preview month or year selected");
      return null;
    }

    const month = parseInt(previewMonth as string);
    const year = parseInt(previewYear as string);

    if (isNaN(month) || isNaN(year)) {
      console.error("Invalid preview month or year");
      return null;
    }

    try {
      // Need authAxios to fetch the data from other store
      const axiosInstance = useStore.getState().authAxios();
      if (!axiosInstance) {
        console.error("No authAxios instance found");
        return null;
      }

      const response = await axiosInstance.get(
        `${API_URL}/historical/monthly_geojson?key=${currentJob.key}&month=${month}&year=${year}&variable=${previewVariable}`,
        { responseType: "arraybuffer" }
      );

      return response.data;
    } catch (error) {
      console.error("Error fetching monthly geojson:", error);
      return null;
    }
  },
}));

export default useCurrentJobStore;
