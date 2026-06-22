import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import axios, { AxiosInstance } from "axios";
import { API_URL, ARD_TILES_DATA_VERSION, DATA_END_YEAR, ROLES } from "./constants";
import { formatElapsedTime, formJobForQueue } from "./helpers";
import {
  combineGeojsonsToFeatureCollection,
  generateGroupId,
  partitionJobsForQueueView,
  QueueJob,
} from "./jobGroups";
import {
  applyUploadShapeList,
  buildPolygonLocationsFromGeojsons,
  collectExistingUploadShapes,
  geojsonsFromPrepareResponse,
  isSyntheticDrawnUploadFile,
  mergePolygonLocations,
  uploadFileBaseName,
} from "./uploadShapes";
import { area as turfArea } from "@turf/turf";
import packageJson from "../../package.json";
import { fetchCdlReleaseYear, getCachedCdlReleaseYear } from "./cdlYear";

export interface PolygonLocation {
  visible: boolean;
  exists?: boolean;
  id: number;
  name: string;
  crop?: string;
  acres: number;
  comments: string;
  county: string;
  polygon_So: string;
  shapeArea: number;
  shapeLeng: number;
  source: string;
  wUR_Basin: string;
  lat: number;
  long: number;
  isValidArea: boolean;
  jobKey?: string;
}

export interface ActiveJobGroup {
  groupId: string;
  groupName: string;
  jobs: any[];
}

export interface JobStatus {
  status: string;
  found: boolean;
  paused: boolean;
  currentYear: number;
  latestDate: string;
  totalYears: number;
  fileCount: number;
  estimatedPercentComplete: number;
  timeRemaining: number;
}

export interface UserInfo {
  sub: string;
  nickname: string;
  name: string;
  picture: string;
  updated_at: string;
  email: string;
  email_verified: boolean;
  permissions: string[];
}

export interface UserIdentity {
  user_id: string;
  provider: string;
  isSocial: boolean;
  connection: string;
}

export interface UserRole {
  name: string;
  id: string;
}
export interface UserListingDetails {
  nickname: string;
  updated_at: string;
  identities: UserIdentity[];
  picture: string;
  created_at: string;
  name: string;
  email: string;
  email_verified: boolean;
  user_id: string;
  last_login: string;
  last_ip: string;
  logins_count: number;
  permissions: string[];
  roles: UserRole[];
}

export type ActiveTabType = "queue" | "backlog" | "users" | "map-layers" | "";

export type MapLayer = {
  name: string;
  attribution: string;
  url: string;
  maxZoom: number;
  subdomains: string[];
  wmsLayers?: string;
  wmsLegend?: boolean;
  compositePeriodDays?: number;
  time?: string;
  backgroundProvider?: string;
  labelsProvider?: string;
  tms?: boolean;
  availableDatesURL?: string;
  gibsDescribeDomains?: { layerId: string; tileMatrixSet: string };
  hidden?: boolean;
  refresh?: "static" | "dynamic";
  units?: string;
  modes?: Record<string, string>;
  statsURL?: string;
  showColorScale?: boolean;
  [key: string]: any;
};

interface Store {
  minimumValidArea: number;
  maximumValidArea: number;
  tileDate: string;
  setTileDate: (tileDate: string) => void;
  mapLayerKey: string;
  setMapLayerKey: (mapLayerKey: string) => void;
  isRightPanelOpen: boolean;
  activeTab: ActiveTabType;
  setActiveTab: (tab: ActiveTabType) => void;
  isQueueOpen: boolean;
  setIsQueueOpen: (isQueueOpen: boolean) => void;
  isUsersPanelOpen: boolean;
  setIsUsersPanelOpen: (isUsersPanelOpen: boolean) => void;
  isMapLayersPanelOpen: boolean;
  setIsMapLayersPanelOpen: (isMapLayersPanelOpen: boolean) => void;
  isBacklogOpen: boolean;
  setIsBacklogOpen: (isBacklogOpen: boolean) => void;
  backlogDateFilter: string;
  setBacklogDateFilter: (backlogDateFilter: string) => void;
  jobName: string;
  setJobName: (jobName: string) => void;
  groupJobsTogether: boolean;
  setGroupJobsTogether: (groupJobsTogether: boolean) => void;
  bulkGroupName: string;
  setBulkGroupName: (bulkGroupName: string) => void;
  minYear: number;
  setMinYear: (minYear: number) => void;
  maxYear: number;
  setMaxYear: (maxYear: number) => void;
  startYear: number;
  setStartYear: (startYear: number) => void;
  endYear: number;
  setEndYear: (endYear: number) => void;
  loadedFile: File | null;
  setLoadedFile: (loadedFile: File | null) => void;
  loadedGeoJSON: any;
  setLoadedGeoJSON: (loadedGeoJSON: any) => void;
  multipolygons: any[];
  setMultipolygons: (multipolygons: any[]) => void;
  previewMode: boolean;
  setPreviewMode: (previewMode: boolean) => void;
  showUploadDialog: boolean;
  setShowUploadDialog: (showUploadDialog: boolean) => void;
  activeJob: any | null;
  setActiveJob: (activeJob: any | null) => void;
  successMessage: string;
  setSuccessMessage: (successMessage: string) => void;
  errorMessage: string;
  setErrorMessage: (errorMessage: string) => void;
  pollCount: number;
  increasePollCount: () => void;
  queue: any[];
  setQueue: (queue: any[]) => void;
  backlog: any[];
  setBacklog: (backlog: any[]) => void;
  fetchQueue: () => void;
  deleteJob: (jobKey: string, deleteFiles?: boolean) => void;
  bulkDeleteJobs: (jobKeys: string[], deleteFiles?: boolean) => void;
  previewJob: (job: any) => void;
  previewMultipolygonJob: () => void;
  submitJob: () => void;
  locations: PolygonLocation[];
  setLocations: (locations: PolygonLocation[]) => void;
  prepareMultipolygonJob: () => any[];
  submitMultipolygonJob: (jobs: any[], options?: { groupTogether?: boolean; groupName?: string }) => void;
  jobLocateGeneration: number;
  activeJobGroup: ActiveJobGroup | null;
  loadJobGroup: (jobs: any[], groupName: string) => Promise<void>;
  clearJobGroup: () => void;
  loadJob: (job: any) => void;
  downloadJob: (jobKey: string, units?: "metric" | "imperial" | "acre-feet") => void;
  downloadJobGroup: (jobs: any[], groupName: string, units?: "metric" | "imperial" | "acre-feet") => void;
  downloadJobGroupGeojson: (jobs: QueueJob[], groupName: string) => Promise<void>;
  downloadJobsBulk: (
    jobs: QueueJob[],
    type: "report" | "geojson" | "geotiff",
    downloadName: string,
    units?: "metric" | "imperial" | "acre-feet"
  ) => Promise<void>;
  downloadingJobGroupId: string | null;
  restartJob: (jobKey: string) => void;
  pauseJob: (jobKey: string) => void;
  resumeJob: (jobKey: string) => void;
  startNewJob: () => void;
  closeNewJob: () => void;
  fetchJobLogs: (jobKey: string) => Promise<{ logs: string }> | null;
  jobStatuses: Record<string, JobStatus>;
  fetchJobStatus: (jobKey: string, jobName: string) => Promise<JobStatus> | null;
  prepareGeoJSON: (shapefile: File) => Promise<any> | null;
  addUploadShapes: (newGeojsons: unknown[]) => void;
  ingestUploadFile: (file: File) => Promise<void>;
  addUploadGeojson: (geojson: unknown, name?: string) => void;
  clearPendingJobs: () => void;
  authToken: string;
  setAuthToken: (authToken: string) => void;
  userInfo: UserInfo | null;
  fetchUserInfo: () => void;
  authAxios: () => AxiosInstance | null;
  users: UserListingDetails[];
  totalUsers: number;
  adminFetchUsers: (page?: number) => void;
  adminDeleteUser: (userId: string) => void;
  adminUpdateUser: (userId: string, roles: string[]) => void;
  reverifyEmail: (userId: string) => void;
  sortAscending: boolean;
  setSortAscending: (sortAscending: boolean) => void;
  approveJob: (jobKey: string) => void;
  bulkApproveJobs: (jobKeys: string[]) => void;
  bulkPauseJobs: (jobKeys: string[]) => void;
  bulkRestartJobs: (jobKeys: string[]) => void;
  bulkResumeJobs: (jobKeys: string[]) => void;
  reorderPendingJobs: (jobKeys: string[]) => void;
  changelog: string;
  version: string;
  loadVersion: () => void;
  lastSeenVersion: string;
  markVersionSeen: () => void;
  showARDTiles: boolean;
  toggleARDTiles: () => void;
  showAllCompletedJobs: boolean;
  toggleAllCompletedJobs: () => void;
  allCompletedJobs: any[];
  ardTiles: Record<string, any>;
  ardTilesDataVersion: number;
  visibleReferenceLayers: string[];
  setVisibleReferenceLayers: (visibleReferenceLayers: string[]) => void;
  fetchARDTiles: () => void;
  searchGeoJSONs: () => void;
  allGeoJSONs: any[];
  refreshType: "static" | "dynamic";
  setRefreshType: (refreshType: "static" | "dynamic") => void;
  minimumBaseMapColorBound: number;
  setMinimumBaseMapColorBound: (minimumBaseMapColorBound: number) => void;
  maximumBaseMapColorBound: number;
  setMaximumBaseMapColorBound: (maximumBaseMapColorBound: number) => void;
  comparisonMode: string;
  setComparisonMode: (comparisonMode: string) => void;
  droughtMonitorData: any;
  fetchDroughtMonitorData: () => void;
  droughtMonitorFetchedDate: string;
  fetchingDroughtMonitorData: boolean;
  cdlReleaseYear: number | null;
  fetchCdlReleaseYearIfNeeded: () => void;
}

const useStore = create<Store>()(
  persist(
    devtools((set, get) => ({
      minimumValidArea: 900,
      maximumValidArea: 100000000,
      tileDate: "",
      setTileDate: (tileDate) => set({ tileDate }),
      mapLayerKey: "Google Satellite",
      setMapLayerKey: (mapLayerKey) => set({ mapLayerKey }),
      isRightPanelOpen: false,
      activeTab: "",
      setActiveTab: (activeTab) => {
        let isQueueOpen = false;
        let isBacklogOpen = false;
        let isUsersPanelOpen = false;
        let isMapLayersPanelOpen = false;

        if (activeTab === "queue" && !get().isQueueOpen) {
          get().fetchQueue();
          isQueueOpen = true;
        } else if (activeTab === "backlog" && !get().isBacklogOpen) {
          get().fetchQueue();
          isBacklogOpen = true;
        } else if (activeTab === "users" && !get().isUsersPanelOpen) {
          get().adminFetchUsers();
          isUsersPanelOpen = true;
        } else if (activeTab === "map-layers" && !get().isMapLayersPanelOpen) {
          isMapLayersPanelOpen = true;
        }

        const isRightPanelOpen = isQueueOpen || isBacklogOpen || isUsersPanelOpen || isMapLayersPanelOpen;

        set({ activeTab, isQueueOpen, isBacklogOpen, isUsersPanelOpen, isMapLayersPanelOpen, isRightPanelOpen });
      },
      isQueueOpen: false,
      setIsQueueOpen: (isQueueOpen) => {
        get().setActiveTab(isQueueOpen ? "queue" : "");
      },
      isBacklogOpen: false,
      setIsBacklogOpen: (isBacklogOpen) => {
        get().setActiveTab(isBacklogOpen ? "backlog" : "");
      },
      backlogDateFilter: "Last Week",
      setBacklogDateFilter: (backlogDateFilter) => set({ backlogDateFilter }),
      isUsersPanelOpen: false,
      setIsUsersPanelOpen: (isUsersPanelOpen) => {
        get().setActiveTab(isUsersPanelOpen ? "users" : "");
      },
      isMapLayersPanelOpen: false,
      setIsMapLayersPanelOpen: (isMapLayersPanelOpen) => {
        get().setActiveTab(isMapLayersPanelOpen ? "map-layers" : "");
      },
      jobName: "",
      setJobName: (jobName) => set({ jobName }),
      groupJobsTogether: false,
      setGroupJobsTogether: (groupJobsTogether) => set({ groupJobsTogether }),
      bulkGroupName: "",
      setBulkGroupName: (bulkGroupName) => set({ bulkGroupName }),
      minYear: 1985,
      setMinYear: (minYear) => set({ minYear }),
      maxYear: DATA_END_YEAR,
      setMaxYear: (maxYear) => set({ maxYear }),
      startYear: 1985,
      setStartYear: (startYear) => set({ startYear }),
      endYear: DATA_END_YEAR,
      setEndYear: (endYear) => set({ endYear }),
      loadedFile: null,
      setLoadedFile: (loadedFile) => set({ loadedFile }),
      loadedGeoJSON: null,
      setLoadedGeoJSON: (loadedGeoJSON) => set({ loadedGeoJSON }),
      multipolygons: [],
      setMultipolygons: (multipolygons) => set({ multipolygons }),
      previewMode: false,
      setPreviewMode: (previewMode) => set({ previewMode }),
      showUploadDialog: true,
      setShowUploadDialog: (showUploadDialog) => set({ showUploadDialog }),
      activeJob: null,
      setActiveJob: (activeJob) => {
        if (!activeJob) {
          void import("./currentJobStore").then(({ default: useCurrentJobStore }) => {
            useCurrentJobStore.getState().setShowPreview(false);
          });
        }
        set({ activeJob });
      },
      jobLocateGeneration: 0,
      activeJobGroup: null,
      downloadingJobGroupId: null,
      successMessage: "",
      setSuccessMessage: (successMessage) => set({ successMessage }),
      errorMessage: "",
      setErrorMessage: (errorMessage) => set({ errorMessage }),
      pollCount: 0,
      increasePollCount: () => set((state) => ({ pollCount: state.pollCount + 1 })),
      queue: [],
      setQueue: (queue) => set({ queue }),
      backlog: [],
      setBacklog: (backlog) => set({ backlog }),
      authToken: "",
      setAuthToken: (authToken) => {
        set({ authToken });
        if (authToken) {
          get().fetchUserInfo();
        }
      },
      userInfo: null,
      fetchUserInfo: async () => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance.get(`${API_URL}/user_info`).then((response) => {
          set({ userInfo: response.data });
        });
      },
      authAxios: () => {
        const token = get().authToken;
        if (!token) {
          return null;
        }
        const instance = axios.create();
        instance.interceptors.request.use(async (config) => {
          config.headers.Authorization = `Bearer ${token}`;
          return config;
        });

        return instance;
      },
      fetchQueue: async () => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          // No token, don't fetch queue
          return;
        }

        axiosInstance.get(`${API_URL}/queue/list`).then((response) => {
          if (!response?.data || !Array.isArray(response.data)) {
            return set({ queue: [], backlog: [] });
          }

          const formattedQueue = response.data.map((job: any) => {
            const submittedAt =
              typeof job.submitted === "number"
                ? job.submitted
                : job.submitted
                  ? new Date(job.submitted).getTime()
                  : null;
            job.submittedAt = Number.isFinite(submittedAt) ? submittedAt : null;
            job.submitted = job.submittedAt ? new Date(job.submittedAt).toLocaleString() : null;
            job.started = job.started ? new Date(job.started).toLocaleString() : null;
            job.ended = job.ended ? new Date(job.ended).toLocaleString() : null;
            job.timeElapsed =
              job.started && job.ended
                ? formatElapsedTime(new Date(job.ended).getTime() - new Date(job.started).getTime())
                : null;
            return job;
          });

          const existingQueue = get().queue;
          const existingBacklog = get().backlog;

          const { queue, backlog } = partitionJobsForQueueView(formattedQueue);

          let jobsChanged = existingQueue.length !== queue.length || existingBacklog.length !== backlog.length;

          if (!jobsChanged) {
            queue.some((job) => {
              const existingJob = existingQueue.find((existingJob) => existingJob.key === job.key);

              jobsChanged =
                !existingJob ||
                existingJob.started !== job.started ||
                existingJob.status !== job.status ||
                existingJob.ended !== job.ended;
            });
          }

          if (!jobsChanged) {
            jobsChanged = backlog.some((job) => {
              const existingJob = existingBacklog.find((existingJob) => existingJob.key === job.key);

              jobsChanged =
                !existingJob ||
                existingJob.started !== job.started ||
                existingJob.status !== job.status ||
                existingJob.ended !== job.ended;
            });
          }

          if (jobsChanged) {
            set({ queue, backlog });
          }
        });
      },
      deleteJob: async (jobKey, deleteFiles: boolean = true) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        const escapedKey = encodeURIComponent(jobKey);

        axiosInstance
          .delete(`${API_URL}/queue/delete_job?key=${escapedKey}&deleteFiles=${deleteFiles ? "true" : "false"}`)
          .then(() => {
            set((state) => {
              let job = state.queue.find((item) => item.key === jobKey);
              if (!job) {
                job = state.backlog.find((item) => item.key === jobKey);
              }

              if (!job) {
                return {
                  ...state,
                  errorMessage: `Error deleting job: ${jobKey} not found`,
                };
              }

              return {
                ...state,
                queue: job ? state.queue.filter((item) => item.key !== jobKey) : state.queue,
                backlog: job ? state.backlog.filter((item) => item.key !== jobKey) : state.backlog,
                successMessage: job ? `Job "${job.name}" deleted successfully` : "",
                errorMessage: job ? "" : `Error deleting job: ${job.name} not found`,
              };
            });
          })
          .catch((error) => {
            set(() => ({ errorMessage: error?.message || "Error deleting job" }));
          });
      },
      bulkDeleteJobs: async (jobKeys, deleteFiles: boolean = true) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .delete(`${API_URL}/queue/bulk_delete_jobs`, {
            data: { keys: jobKeys, deleteFiles },
          })
          .then(() => {
            set((state) => {
              const deletedJobs = [...state.queue, ...state.backlog].filter((item) => jobKeys.includes(item.key));
              const keySet = new Set(jobKeys);

              return {
                ...state,
                queue: state.queue.filter((item) => !keySet.has(item.key)),
                backlog: state.backlog.filter((item) => !keySet.has(item.key)),
                successMessage: `${deletedJobs.length} jobs deleted successfully`,
                errorMessage: "",
              };
            });
          })
          .catch((error) => {
            set(() => ({ errorMessage: error?.message || "Error deleting jobs" }));
          });
      },
      previewJob: (job: any) => {
        set({ activeJob: job, showUploadDialog: false, previewMode: true });
      },
      previewMultipolygonJob: () => {
        set({ showUploadDialog: false, previewMode: true, activeJob: null });
      },
      submitJob: async () => {
        let jobName = get().jobName.trim() || "Untitled Job";
        jobName = jobName.replace(/[^a-zA-Z0-9_+.\s-]/gi, "") || "Untitled Job";

        let newJob = formJobForQueue(jobName, get().startYear, get().endYear, get().loadedGeoJSON);

        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/start_run`, {
            name: jobName,
            startYear: get().startYear,
            endYear: get().endYear,
            geojson: get().loadedGeoJSON,
          })
          .then((response) => {
            let message = response?.data?.status || "";
            newJob = response.data?.entry || newJob;

            set({
              showUploadDialog: false,
              previewMode: false,
              loadedFile: null,
              activeJob: newJob,
              successMessage: message,
              errorMessage: "",
            });
            get().increasePollCount();
          })
          .catch((error) => {
            set({ errorMessage: error?.message || "Error submitting job" });
          });
      },
      locations: [],
      setLocations: (locations) => {
        const validLocations = locations.filter((location) => location?.id !== undefined);
        set({ locations: validLocations });
      },
      prepareMultipolygonJob: () => {
        let baseName = get().jobName.trim() || "Untitled Job";
        baseName = baseName.replace(/[^\w\s-_]/gi, "");
        const multipolygons = get().multipolygons;
        const polygonLocations = get().locations;

        if (multipolygons.length === 0 || polygonLocations.length !== multipolygons.length) {
          set({ errorMessage: "No multipolygons to submit" });
          return [];
        }

        return polygonLocations
          .filter((location) => location.visible)
          .map((location) => {
            const defaultName = `${baseName} Part ${location.id + 1}`;
            let jobName = location?.name || defaultName;
            jobName = jobName.replace(/[^\w\s-_]/gi, "") || "Untitled Job";
            const geojson = multipolygons[location.id];

            return formJobForQueue(jobName, get().startYear, get().endYear, geojson);
          });
      },
      submitMultipolygonJob: async (jobs: any[], options?: { groupTogether?: boolean; groupName?: string }) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        const shouldGroup = Boolean(options?.groupTogether) && jobs.length > 1;
        const groupId = shouldGroup ? generateGroupId() : undefined;
        const groupName = shouldGroup
          ? options?.groupName?.trim() || get().bulkGroupName.trim() || get().jobName.trim() || "Untitled Job"
          : undefined;

        try {
          let activeJob = jobs[0];
          for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];
            const jobName = job?.name.replace(/[^\w\s-_]/gi, "") || "Untitled Job";
            const response = await axiosInstance.post(`${API_URL}/start_run`, {
              name: jobName,
              startYear: job.start_year,
              endYear: job.end_year,
              geojson: job.loaded_geo_json,
              ...(groupId ? { groupId, groupName } : {}),
            });
            if (i === 0 && response.data?.entry) {
              activeJob = response.data.entry;

              set({
                activeJob: activeJob,
                loadedGeoJSON: activeJob.loaded_geo_json,
              });
            }
          }

          set({
            showUploadDialog: false,
            previewMode: false,
            loadedFile: null,
            multipolygons: [],
            locations: [],
            groupJobsTogether: false,
            bulkGroupName: "",
            successMessage: `All ${jobs.length} jobs submitted successfully!`,
            errorMessage: "",
          });
        } catch (error: any) {
          set({
            errorMessage: error?.message || `Error submitting multipolygon job! (${error})`,
            successMessage: "",
          });
        }
      },
      clearJobGroup: () => {
        void import("./currentJobStore").then(({ default: useCurrentJobStore }) => {
          useCurrentJobStore.getState().setShowPreview(false);
        });
        set({
          activeJobGroup: null,
          activeJob: null,
          loadedGeoJSON: null,
          multipolygons: [],
          locations: [],
        });
      },
      loadJobGroup: async (jobs: QueueJob[], groupName: string) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance || jobs.length === 0) {
          return;
        }

        try {
          const geojsons = await Promise.all(
            jobs.map(async (job) => {
              if (job.loaded_geo_json) {
                return job.loaded_geo_json;
              }

              const escapedName = encodeURIComponent(job.name);
              const escapedKey = encodeURIComponent(job.key);
              const response = await axiosInstance.get(
                `${API_URL}/geojson?name=${escapedName}&key=${escapedKey}`
              );
              return response.data;
            })
          );

          const locations: PolygonLocation[] = jobs.map((job, index) => {
            const geojson = geojsons[index];
            const area = turfArea(geojson);

            let lat = geojson?.geometry?.coordinates?.[0]?.[0]?.[0];
            let long = geojson?.geometry?.coordinates?.[0]?.[0]?.[1];
            if (!lat || !long) {
              lat = geojson?.features?.[0]?.geometry?.coordinates?.[0]?.[0]?.[0];
              long = geojson?.features?.[0]?.geometry?.coordinates?.[0]?.[0]?.[1];
            }

            return {
              visible: true,
              name: job.name,
              jobKey: job.key,
              acres: area,
              comments: geojson?.properties?.Comments || "",
              county: geojson?.properties?.County || "",
              polygon_So: geojson?.properties?.Polygon_So || "",
              shapeArea: area,
              shapeLeng: geojson?.properties?.Shape_Leng || 0,
              source: geojson?.properties?.Source || "",
              wUR_Basin: geojson?.properties?.WUR_Basin || "",
              id: index,
              lat: lat || 0,
              long: long || 0,
              isValidArea: area > 900,
            };
          });

          const startYears = jobs.map((job) => job.start_year).filter((y): y is number => y != null);
          const endYears = jobs.map((job) => job.end_year).filter((y): y is number => y != null);
          const minStart = Math.min(...startYears);
          const maxEnd = Math.max(...endYears);
          const groupId = jobs[0].group_id || `group_${Date.now()}`;

          const representativeJob = {
            ...jobs[0],
            name: groupName,
            start_year: minStart,
            end_year: maxEnd,
            loaded_geo_json: null,
          };

          set({
            activeJobGroup: { groupId, groupName, jobs },
            activeJob: representativeJob,
            loadedGeoJSON: null,
            multipolygons: geojsons,
            locations,
            showUploadDialog: false,
            previewMode: false,
            jobLocateGeneration: get().jobLocateGeneration + 1,
          });

          const useCurrentJobStore = (await import("./currentJobStore")).default;
          const previewStore = useCurrentJobStore.getState();
          previewStore.setPreviewMonth(1);
          previewStore.setPreviewYear(minStart);
          previewStore.setPreviewVariable("ET");
          previewStore.setShowPreview(false);
        } catch (error: any) {
          set({
            errorMessage: error?.message || "Error loading job group",
            activeJobGroup: null,
          });
        }
      },
      loadJob: (job) => {
        set({ activeJobGroup: null, activeJob: job, showUploadDialog: false, previewMode: false });

        const resetPreviewVisibility = () => {
          void import("./currentJobStore").then(({ default: useCurrentJobStore }) => {
            useCurrentJobStore.getState().setShowPreview(false);
          });
        };

        if (job.loaded_geo_json) {
          set({
            loadedGeoJSON: job.loaded_geo_json,
            multipolygons: [],
            jobLocateGeneration: get().jobLocateGeneration + 1,
          });
          resetPreviewVisibility();
          return;
        }

        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        const escapedName = encodeURIComponent(job.name);
        const escapedKey = encodeURIComponent(job.key);
        axiosInstance
          .get(`${API_URL}/geojson?name=${escapedName}&key=${escapedKey}`)
          .then((response) => {
            let loadedGeoJSON = null;
            let multipolygons = [];
            if (response?.data?.geojsons) {
              multipolygons = response.data.geojsons;
            } else {
              loadedGeoJSON = response.data;
              job.loaded_geo_json = response.data;
            }

            set({
              loadedGeoJSON,
              multipolygons,
              jobLocateGeneration: get().jobLocateGeneration + 1,
            });
            resetPreviewVisibility();
          })
          .catch((error) => {
            set({ loadedGeoJSON: null, multipolygons: [], errorMessage: error?.message || "Error loading job" });
          });
      },
      downloadJobGroup: (jobs, groupName, units = "metric") => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance || jobs.length === 0) {
          return;
        }

        const groupId = jobs[0]?.group_id || groupName;
        set({ downloadingJobGroupId: groupId });

        const keys = jobs.map((job) => encodeURIComponent(job.key)).join(",");
        const escapedGroupName = encodeURIComponent(groupName.replace(/[(),]/g, ""));

        axiosInstance
          .get(`${API_URL}/download/group?keys=${keys}&units=${units}&name=${escapedGroupName}`, {
            responseType: "arraybuffer",
          })
          .then((response) => {
            const blob = new Blob([response.data], { type: "application/zip" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${groupName.replace(/[(),]/g, "")}.zip`;
            a.click();
            window.URL.revokeObjectURL(url);
          })
          .catch((error) => {
            set({ errorMessage: error?.message || "Error downloading job group" });
          })
          .finally(() => {
            set({ downloadingJobGroupId: null });
          });
      },
      downloadJobGroupGeojson: async (jobs, groupName) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance || jobs.length === 0) {
          return;
        }

        const groupId = jobs[0]?.group_id || groupName;
        set({ downloadingJobGroupId: groupId });

        try {
          const { activeJobGroup, locations, multipolygons } = get();
          const groupLoaded =
            activeJobGroup &&
            activeJobGroup.groupName === groupName &&
            activeJobGroup.jobs.length === jobs.length &&
            activeJobGroup.jobs.every((job) => jobs.some((entry) => entry.key === job.key)) &&
            multipolygons.length > 0 &&
            locations.length > 0;

          let sources: { geojson: unknown; name?: string; jobKey?: string }[];

          if (groupLoaded) {
            sources = jobs.map((job) => {
              const location = locations.find((entry) => entry.jobKey === job.key);
              const geojson =
                location != null && multipolygons[location.id] != null
                  ? multipolygons[location.id]
                  : job.loaded_geo_json;

              return { geojson, name: job.name, jobKey: job.key };
            });
          } else {
            sources = await Promise.all(
              jobs.map(async (job) => {
                if (job.loaded_geo_json) {
                  return { geojson: job.loaded_geo_json, name: job.name, jobKey: job.key };
                }

                const escapedName = encodeURIComponent(job.name);
                const escapedKey = encodeURIComponent(job.key);
                const response = await axiosInstance.get(
                  `${API_URL}/geojson?name=${escapedName}&key=${escapedKey}`
                );
                return { geojson: response.data, name: job.name, jobKey: job.key };
              })
            );
          }

          const combined = combineGeojsonsToFeatureCollection(sources);
          if (combined.features.length === 0) {
            set({ errorMessage: "No shapes available to download for this group" });
            return;
          }

          const blob = new Blob([JSON.stringify(combined)], { type: "application/json" });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${groupName.replace(/[(),]/g, "")}.geojson`;
          a.click();
          window.URL.revokeObjectURL(url);
        } catch (error: unknown) {
          const err = error as Error;
          set({ errorMessage: err?.message || "Error downloading group GeoJSON" });
        } finally {
          set({ downloadingJobGroupId: null });
        }
      },
      downloadJobsBulk: async (jobs, type, downloadName, units = "metric") => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance || jobs.length === 0) {
          return;
        }

        const keys = jobs.map((job) => encodeURIComponent(job.key)).join(",");
        const escapedName = encodeURIComponent(downloadName.replace(/[(),]/g, ""));
        const unitsParam = type === "report" ? `&units=${units}` : "";

        await axiosInstance
          .get(`${API_URL}/download/bulk?keys=${keys}&type=${type}&name=${escapedName}${unitsParam}`, {
            responseType: "arraybuffer",
          })
          .then((response) => {
            const blob = new Blob([response.data], { type: "application/zip" });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${downloadName.replace(/[(),]/g, "")}.zip`;
            a.click();
            window.URL.revokeObjectURL(url);
          })
          .catch((error) => {
            set({ errorMessage: error?.message || "Error downloading selected jobs" });
          });
      },
      downloadJob: (jobKey, units = "metric") => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        let job = get().queue.find((item) => item.key === jobKey);
        if (!job) {
          job = get().backlog.find((item) => item.key === jobKey);
        }

        if (!job) {
          set({ errorMessage: `Error downloading job: ${jobKey} not found` });
          return;
        }

        const shortName = job.name.replace(/[(),]/g, "");
        const escapedName = encodeURIComponent(shortName);
        const escapedKey = encodeURIComponent(job.key);

        axiosInstance
          .get(`${API_URL}/download?name=${escapedName}&key=${escapedKey}&units=${units}`, {
            responseType: "arraybuffer",
          })
          .then((response) => {
            const blob = new Blob([response.data], { type: "application/zip" });

            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${escapedName}.zip`;
            a.click();
          })
          .catch((error) => {
            set({ errorMessage: error?.message || "Error downloading job" });
          });
      },
      restartJob: (jobKey) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/queue/restart_job`, { key: jobKey })
          .then(() => {
            get().fetchQueue();
            set({ successMessage: "Job restarted" });
          })
          .catch((error) => {
            set({ errorMessage: error?.message || "Error restarting job" });
          });
      },
      pauseJob: (jobKey) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/queue/pause_job`, { key: jobKey })
          .then(() => {
            get().fetchQueue();
            set({ successMessage: "Job paused" });
          })
          .catch((error) => {
            set({ errorMessage: error?.message || "Error pausing job" });
          });
      },
      resumeJob: (jobKey) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/queue/resume_job`, { key: jobKey })
          .then(() => {
            get().fetchQueue();
            set({ successMessage: "Job resumed" });
          })
          .catch((error) => {
            set({ errorMessage: error?.message || "Error resuming job" });
          });
      },
      startNewJob: () => {
        set({
          loadedFile: null,
          loadedGeoJSON: null,
          multipolygons: [],
          locations: [],
          jobName: "",
          groupJobsTogether: false,
          bulkGroupName: "",
          startYear: 1985,
          endYear: DATA_END_YEAR,
          showUploadDialog: true,
          previewMode: false,
          activeJob: null,
        });
      },
      addUploadShapes: (newGeojsons) => {
        if (!newGeojsons.length) {
          return;
        }

        const state = get();
        const existing = collectExistingUploadShapes(state);
        const previousLocations = state.locations;
        const combined = [...existing, ...newGeojsons];
        const { loadedGeoJSON, multipolygons } = applyUploadShapeList(combined);
        const inheritFirstName =
          multipolygons.length > 1 && previousLocations.length === 0 && existing.length > 0
            ? state.jobName.trim()
            : undefined;
        const locations =
          multipolygons.length > 0
            ? mergePolygonLocations(
                buildPolygonLocationsFromGeojsons(
                  multipolygons,
                  state.minimumValidArea,
                  state.maximumValidArea
                ),
                previousLocations,
                inheritFirstName ? { inheritFirstName } : undefined
              )
            : [];

        set({
          loadedGeoJSON,
          multipolygons,
          locations,
          activeJob: null,
          previewMode: false,
        });
      },
      ingestUploadFile: async (file) => {
        const hadShapes = collectExistingUploadShapes(get()).length > 0;

        if (!get().jobName) {
          const fileName = file.name.replace(/\.[^/.]+$/, "").trim();
          if (fileName) {
            set({ jobName: fileName });
          }
        }

        const response = await get().prepareGeoJSON(file);
        if (!response?.data) {
          return;
        }

        const shapes = geojsonsFromPrepareResponse(response.data);
        if (!shapes.length) {
          return;
        }

        get().addUploadShapes(shapes);

        const updates: Partial<{
          loadedFile: File;
          bulkGroupName: string;
          groupJobsTogether: boolean;
        }> = {};

        if (!hadShapes) {
          updates.loadedFile = file;
        }

        if (!hadShapes && shapes.length > 1 && !isSyntheticDrawnUploadFile(file)) {
          const groupName = uploadFileBaseName(file);
          if (groupName) {
            updates.bulkGroupName = groupName;
            updates.groupJobsTogether = false;
          }
        }

        if (Object.keys(updates).length > 0) {
          set(updates);
        }
      },
      addUploadGeojson: (geojson, name) => {
        if (!geojson) {
          return;
        }

        const hadShapes = collectExistingUploadShapes(get()).length > 0;

        if (!get().jobName && name) {
          set({ jobName: name });
        }

        get().addUploadShapes([geojson]);

        if (!hadShapes) {
          const fileLabel = name ? `${name}.geojson` : "drawn-shape.geojson";
          set({
            loadedFile: new File([JSON.stringify(geojson)], fileLabel, { type: "application/json" }),
          });
        }
      },
      closeNewJob: () => {
        void import("./currentJobStore").then(({ default: useCurrentJobStore }) => {
          useCurrentJobStore.getState().setShowPreview(false);
        });
        set({
          showUploadDialog: false,
          previewMode: false,
          loadedFile: null,
          loadedGeoJSON: null,
          multipolygons: [],
          locations: [],
          jobName: "",
          groupJobsTogether: false,
          bulkGroupName: "",
          startYear: 1985,
          endYear: DATA_END_YEAR,
        });
      },
      fetchJobLogs: (jobKey) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return null;
        }

        const escapedKey = encodeURIComponent(jobKey);

        return axiosInstance
          .get(`${API_URL}/job/logs?key=${escapedKey}`)
          .then((response) => {
            return response.data;
          })
          .catch((error) => {
            set({ errorMessage: error?.message || "Error fetching job logs" });
            return { logs: "" };
          });
      },
      jobStatuses: {},
      fetchJobStatus: (jobKey, jobName) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return null;
        }

        const escapedKey = encodeURIComponent(jobKey);
        const escapedName = encodeURIComponent(jobName);

        return axiosInstance
          .get(`${API_URL}/job/status?key=${escapedKey}&name=${escapedName}`)
          .then((response) => {
            set((state) => {
              const jobStatuses = { ...state.jobStatuses };
              jobStatuses[jobKey] = response.data;
              return { jobStatuses };
            });
            return response.data;
          })
          .catch((error) => {
            // Only log error message if status !== 404
            const errorMessage = error?.response?.status === 404 ? "" : error?.message || "Error fetching job status";

            set((state) => ({
              errorMessage: errorMessage,
              jobStatuses: {
                ...state.jobStatuses,
                [jobKey]: {
                  status: "Error fetching job status",
                  found: error?.response?.status === 200,
                  paused: false,
                  currentYear: 0,
                  latestDate: "",
                  totalYears: 0,
                  fileCount: 0,
                  estimatedPercentComplete: 0,
                  timeRemaining: 0,
                },
              },
            }));
            return {
              status: "Error",
              found: error?.response?.status === 200,
              paused: false,
              currentYear: 0,
              latestDate: "",
              totalYears: 0,
              fileCount: 0,
              estimatedPercentComplete: 0,
              timeRemaining: 0,
            };
          });
      },
      prepareGeoJSON: (geoFile: File) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return null;
        }

        const formData = new FormData();
        formData.append("file", geoFile);

        return axiosInstance
          .post(`${API_URL}/prepare_geojson`, formData, {
            headers: {
              "Content-Type": "multipart/form-data",
            },
          })
          .then((response) => {
            return response;
          })
          .catch((error) => {
            set({ errorMessage: error?.response?.data || error?.message || "Error preparing file" });
          });
      },
      clearPendingJobs: () => {
        const pendingJobs = get()
          .queue.filter((job) => ["Pending", "WaitingApproval"].includes(job.status))
          .map((job) => job.key);

        if (pendingJobs.length === 0) {
          return;
        }

        get().bulkDeleteJobs(pendingJobs, true);
      },
      users: [],
      totalUsers: 0,
      adminFetchUsers: (page = 0) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .get(`${API_URL}/admin/users?page=${page}`)
          .then((response) => {
            const users: UserListingDetails[] = response.data.users;
            users.sort((a, b) => {
              if (
                a.roles.some((role) => role.id === ROLES.NEW_USER) &&
                !b.roles.some((role) => role.id === ROLES.NEW_USER)
              ) {
                return -1;
              } else if (
                !a.roles.some((role) => role.id === ROLES.NEW_USER) &&
                b.roles.some((role) => role.id === ROLES.NEW_USER)
              ) {
                return 1;
              } else {
                return new Date(b.last_login).getTime() - new Date(a.last_login).getTime();
              }
            });

            set({ users, totalUsers: response.data.total });
          })
          .catch((error) => {
            set({ errorMessage: error?.response?.data || error?.message || "Error fetching users" });
          });
      },
      adminDeleteUser: (userId) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .delete(`${API_URL}/admin/delete_user?userId=${userId}`)
          .then(() => {
            set((state) => {
              const users = state.users.filter((user) => user.user_id !== userId);
              state.adminFetchUsers();
              return { users };
            });
          })
          .catch((error) => {
            get().adminFetchUsers();
            set({ errorMessage: error?.response?.data || error?.message || "Error deleting user" });
          });
      },
      adminUpdateUser: (userId, roles) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/admin/update_user`, { userId, roles })
          .then(() => {
            set((state) => {
              const users = state.users.map((user) => {
                if (user.user_id === userId) {
                  user.roles = roles.map((role) => ({ name: role, id: role }));
                }
                return user;
              });
              state.adminFetchUsers();
              return { users };
            });
          })
          .catch((error) => {
            get().adminFetchUsers();
            set({ errorMessage: error?.response?.data || error?.message || "Error updating user" });
          });
      },
      reverifyEmail: (userId) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/admin/reverify_email`, { userId })
          .then(() => {
            set({ successMessage: "Email verification sent" });
          })
          .catch((error) => {
            set({ errorMessage: error?.response?.data || error?.message || "Error sending email verification" });
          });
      },
      sortAscending: true,
      setSortAscending: (sortAscending) => set({ sortAscending }),
      approveJob: (jobKey) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/queue/approve_job`, { key: jobKey })
          .then((response) => {
            get().fetchQueue();
            if (response?.data?.modifiedCount === 1) {
              set({ successMessage: "Job approved, it will be added to the queue" });
            }
          })
          .catch((error) => {
            set({ errorMessage: error?.response?.data || error?.message || "Error approving job" });
          });
      },
      bulkApproveJobs: (jobKeys) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/queue/bulk_approve_jobs`, { keys: jobKeys })
          .then((response) => {
            get().fetchQueue();
            if (response?.data?.modifiedCount > 0) {
              set({ successMessage: `${response?.data?.modifiedCount} jobs approved and added to the queue` });
            }
          })
          .catch((error) => {
            set({ errorMessage: error?.response?.data || error?.message || "Error approving jobs" });
          });
      },
      bulkPauseJobs: (jobKeys) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/queue/bulk_pause_jobs`, { keys: jobKeys })
          .then((response) => {
            get().fetchQueue();
            if (response?.data?.modifiedCount > 0) {
              set({ successMessage: `${response?.data?.modifiedCount} jobs paused` });
            }
          })
          .catch((error) => {
            set({ errorMessage: error?.response?.data || error?.message || "Error pausing jobs" });
          });
      },
      bulkRestartJobs: (jobKeys) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/queue/bulk_restart_jobs`, { keys: jobKeys })
          .then((response) => {
            get().fetchQueue();
            if (response?.data?.modifiedCount > 0) {
              set({ successMessage: `${response?.data?.modifiedCount} jobs restarted` });
            }
          })
          .catch((error) => {
            set({ errorMessage: error?.response?.data || error?.message || "Error restarting jobs" });
          });
      },
      bulkResumeJobs: (jobKeys) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/queue/bulk_resume_jobs`, { keys: jobKeys })
          .then((response) => {
            get().fetchQueue();
            if (response?.data?.modifiedCount > 0) {
              set({ successMessage: `${response?.data?.modifiedCount} jobs started` });
            }
          })
          .catch((error) => {
            set({ errorMessage: error?.response?.data || error?.message || "Error starting jobs" });
          });
      },
      reorderPendingJobs: (jobKeys) => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/queue/reorder_pending_jobs`, { keys: jobKeys })
          .then(() => {
            get().fetchQueue();
          })
          .catch((error) => {
            set({ errorMessage: error?.response?.data || error?.message || "Error reordering jobs" });
          });
      },
      changelog: "",
      version: "0.0.0",
      loadVersion: () => {
        const version = packageJson.version;
        set({ version });
      },
      lastSeenVersion: "0.0.0",
      markVersionSeen: () => {
        set({ lastSeenVersion: get().version });
      },
      showARDTiles: false,
      toggleARDTiles: () => {
        set({ showARDTiles: !get().showARDTiles });
      },
      showAllCompletedJobs: false,
      toggleAllCompletedJobs: () => {
        set({ showAllCompletedJobs: !get().showAllCompletedJobs });
      },
      allCompletedJobs: [],
      visibleReferenceLayers: [],
      setVisibleReferenceLayers: (visibleReferenceLayers) => set({ visibleReferenceLayers }),
      ardTiles: {},
      ardTilesDataVersion: 0,
      fetchARDTiles: () => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .get(`${API_URL}/ard_tiles`)
          .then((response) => {
            set({
              ardTiles: response.data,
              ardTilesDataVersion: ARD_TILES_DATA_VERSION,
            });
          })
          .catch((error) => {
            console.error("Error fetching ARD tiles", error);
            set({ errorMessage: error?.response?.data || error?.message || "Error fetching ARD tiles" });
          });
      },
      searchGeoJSONs: () => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .get(`${API_URL}/queue/search_geojsons`)
          .then((response) => {
            set({ allGeoJSONs: response.data });
          })
          .catch((error) => {
            console.error("Error fetching GeoJSONs", error);
            set({ errorMessage: error?.response?.data || error?.message || "Error fetching GeoJSONs" });
          });
      },
      allGeoJSONs: [],
      refreshType: "dynamic",
      setRefreshType: (refreshType) => set({ refreshType }),
      minimumBaseMapColorBound: 0,
      setMinimumBaseMapColorBound: (minimumBaseMapColorBound) => set({ minimumBaseMapColorBound }),
      maximumBaseMapColorBound: 200,
      setMaximumBaseMapColorBound: (maximumBaseMapColorBound) => set({ maximumBaseMapColorBound }),
      comparisonMode: "absolute",
      setComparisonMode: (comparisonMode) => set({ comparisonMode }),
      droughtMonitorData: {},
      droughtMonitorFetchedDate: "",
      fetchingDroughtMonitorData: false,
      fetchDroughtMonitorData: () => {
        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        set({ fetchingDroughtMonitorData: true });

        const existingData = get().droughtMonitorData;
        // Check if data is already cached
        if (existingData && Object.keys(existingData).length > 0 && get().droughtMonitorFetchedDate) {
          const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
          if (new Date(get().droughtMonitorFetchedDate) > oneHourAgo) {
            return;
          }
        }

        axiosInstance
          .get(`${API_URL}/auxiliary/drought-monitor`)
          .then((response) => {
            set({
              droughtMonitorData: response.data,
              droughtMonitorFetchedDate: new Date().toISOString(),
              fetchingDroughtMonitorData: false,
            });
          })
          .catch((error) => {
            set({
              errorMessage: error?.response?.data || error?.message || "Error fetching drought monitor data",
              fetchingDroughtMonitorData: false,
            });
          });
      },
      cdlReleaseYear: getCachedCdlReleaseYear(),
      fetchCdlReleaseYearIfNeeded: () => {
        const cached = getCachedCdlReleaseYear();
        if (cached != null) {
          if (get().cdlReleaseYear !== cached) {
            set({ cdlReleaseYear: cached });
          }
          return;
        }

        const axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        void fetchCdlReleaseYear(axiosInstance).then((year) => {
          if (year != null) {
            set({ cdlReleaseYear: year });
          }
        });
      },
    })),
    {
      name: "et-visualizer-state",
      partialize: (state) => ({
        lastSeenVersion: state.lastSeenVersion,
        sortAscending: state.sortAscending,
        changelog: state.changelog,
        ardTiles: state.ardTiles,
        ardTilesDataVersion: state.ardTilesDataVersion,
        mapLayerKey: state.mapLayerKey,
        showARDTiles: state.showARDTiles,
      }),
      migrate: (persistedState) => {
        const state = persistedState as Record<string, unknown>;
        if (state.ardTilesDataVersion !== ARD_TILES_DATA_VERSION) {
          delete state.ardTiles;
          state.ardTilesDataVersion = 0;
        }
        return state;
      },
      version: 1,
    }
  )
);

export default useStore;
