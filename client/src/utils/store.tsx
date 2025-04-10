import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import axios, { AxiosInstance } from "axios";
import { API_URL, QUEUE_STATUSES, ROLES } from "./constants";
import { formatElapsedTime, formJobForQueue } from "./helpers";
import packageJson from "../../package.json";

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
  time?: string;
  backgroundProvider?: string;
  labelsProvider?: string;
  tms?: boolean;
  availableDatesURL?: string;
  hidden?: boolean;
  refresh?: "static" | "dynamic";
  units?: string;
  modes?: Record<string, string>;
  [key: string]: any;
};

interface Store {
  minimumValidArea: number;
  maximumValidArea: number;
  tileDate: string;
  setTileDate: (tileDate: string) => void;
  mapLayerKey: string;
  setMapLayerKey: (mapLayerKey: string) => void;
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
  submitMultipolygonJob: (jobs: any[]) => void;
  loadJob: (job: any) => void;
  downloadJob: (jobKey: string, imperial?: boolean) => void;
  restartJob: (jobKey: string) => void;
  pauseJob: (jobKey: string) => void;
  resumeJob: (jobKey: string) => void;
  startNewJob: () => void;
  closeNewJob: () => void;
  fetchJobLogs: (jobKey: string) => Promise<{ logs: string }> | null;
  jobStatuses: Record<string, JobStatus>;
  fetchJobStatus: (jobKey: string, jobName: string) => Promise<JobStatus> | null;
  prepareGeoJSON: (shapefile: File) => Promise<any> | null;
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
  changelog: string;
  version: string;
  loadVersion: () => void;
  lastSeenVersion: string;
  markVersionSeen: () => void;
  showARDTiles: boolean;
  toggleARDTiles: () => void;
  ardTiles: Record<string, any>;
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

        set({ activeTab, isQueueOpen, isBacklogOpen, isUsersPanelOpen, isMapLayersPanelOpen });
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
      minYear: 1985,
      setMinYear: (minYear) => set({ minYear }),
      maxYear: 2023,
      setMaxYear: (maxYear) => set({ maxYear }),
      startYear: 1985,
      setStartYear: (startYear) => set({ startYear }),
      endYear: 2023,
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
      setActiveJob: (activeJob) => set({ activeJob }),
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
        let axiosInstance = get().authAxios();
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
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          // No token, don't fetch queue
          return;
        }

        axiosInstance.get(`${API_URL}/queue/list`).then((response) => {
          if (!response?.data || !Array.isArray(response.data)) {
            return set({ queue: [], backlog: [] });
          }

          let formattedQueue = response.data.map((job: any) => {
            job.submitted = job.submitted ? new Date(job.submitted).toLocaleString() : null;
            job.started = job.started ? new Date(job.started).toLocaleString() : null;
            job.ended = job.ended ? new Date(job.ended).toLocaleString() : null;
            job.timeElapsed =
              job.started && job.ended
                ? formatElapsedTime(new Date(job.ended).getTime() - new Date(job.started).getTime())
                : null;
            return job;
          });

          let existingQueue = get().queue;
          let existingBacklog = get().backlog;

          let queue = formattedQueue.filter((job: any) => QUEUE_STATUSES.includes(job.status));
          let backlog = formattedQueue.filter((job: any) => !QUEUE_STATUSES.includes(job.status));

          let jobsChanged = existingQueue.length !== queue.length || existingBacklog.length !== backlog.length;

          if (!jobsChanged) {
            queue.some((job) => {
              let existingJob = existingQueue.find((existingJob) => existingJob.key === job.key);

              jobsChanged =
                !existingJob ||
                existingJob.started !== job.started ||
                existingJob.status !== job.status ||
                existingJob.ended !== job.ended;
            });
          }

          if (!jobsChanged) {
            jobsChanged = backlog.some((job) => {
              let existingJob = existingBacklog.find((existingJob) => existingJob.key === job.key);

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
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        let escapedKey = encodeURIComponent(jobKey);

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
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .delete(`${API_URL}/queue/bulk_delete_jobs`, {
            data: { keys: jobKeys, deleteFiles },
          })
          .then(() => {
            set((state) => {
              let deletedJobs = state.queue.filter((item) => jobKeys.includes(item.key));
              let remainingJobs = state.queue.filter((item) => !jobKeys.includes(item.key));

              return {
                ...state,
                queue: remainingJobs,
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

        let axiosInstance = get().authAxios();
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
        let validLocations = locations.filter((location) => location?.id !== undefined);
        set({ locations: validLocations });
      },
      prepareMultipolygonJob: () => {
        let baseName = get().jobName.trim() || "Untitled Job";
        baseName = baseName.replace(/[^\w\s-_]/gi, "");
        let multipolygons = get().multipolygons;
        let polygonLocations = get().locations;

        if (multipolygons.length === 0 || polygonLocations.length !== multipolygons.length) {
          set({ errorMessage: "No multipolygons to submit" });
          return [];
        }

        return polygonLocations
          .filter((location) => location.visible)
          .map((location) => {
            let defaultName = `${baseName} Part ${location.id + 1}`;
            let jobName = location?.name || defaultName;
            jobName = jobName.replace(/[^\w\s-_]/gi, "") || "Untitled Job";
            let geojson = multipolygons[location.id];

            return formJobForQueue(jobName, get().startYear, get().endYear, geojson);
          });
      },
      submitMultipolygonJob: async (jobs: any[]) => {
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        try {
          let activeJob = jobs[0];
          let responses: any[] = [];
          await jobs.forEach(async (job, i) => {
            let jobName = job?.name.replace(/[^\w\s-_]/gi, "") || "Untitled Job";
            const response = await axiosInstance.post(`${API_URL}/start_run`, {
              name: jobName,
              startYear: job.start_year,
              endYear: job.end_year,
              geojson: job.loaded_geo_json,
            });
            responses.push(response.data);
            if (i === 0 && response.data?.entry) {
              activeJob = response.data.entry;

              set({
                activeJob: activeJob,
                loadedGeoJSON: activeJob.loaded_geo_json,
              });
            }
          });

          set({
            showUploadDialog: false,
            previewMode: false,
            loadedFile: null,
            multipolygons: [],
            locations: [],
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
      loadJob: (job) => {
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        let escapedName = encodeURIComponent(job.name);
        let escapedKey = encodeURIComponent(job.key);
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

            set({ loadedGeoJSON, multipolygons, showUploadDialog: false, previewMode: false });
          })
          .catch((error) => {
            set({ loadedGeoJSON: null, multipolygons: [], errorMessage: error?.message || "Error loading job" });
          });
        set({ activeJob: job });
      },
      downloadJob: (jobKey, imperial = false) => {
        let job = get().queue.find((item) => item.key === jobKey);
        if (!job) {
          job = get().backlog.find((item) => item.key === jobKey);
        }

        if (!job) {
          set({ errorMessage: `Error downloading job: ${jobKey} not found` });
          return;
        }

        let shortName = job.name.replace(/[(),]/g, "");
        let escapedName = encodeURIComponent(shortName);
        let escapedKey = encodeURIComponent(job.key);

        // Check if it's a 404 first
        axios
          .get(`${API_URL}/download?name=${escapedName}&key=${escapedKey}&units=${imperial ? "in" : "mm"}`)
          .then(() => {
            window.open(`${API_URL}/download?name=${escapedName}&key=${escapedKey}&units=${imperial ? "in" : "mm"}`);
          })
          .catch((error) => {
            set({ errorMessage: error?.message || "Error downloading job" });
          });
      },
      restartJob: (jobKey) => {
        let axiosInstance = get().authAxios();
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
        let axiosInstance = get().authAxios();
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
        let axiosInstance = get().authAxios();
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
          jobName: "",
          startYear: 1985,
          endYear: 2023,
          showUploadDialog: true,
          previewMode: false,
          activeJob: null,
        });
      },
      closeNewJob: () => {
        set({
          showUploadDialog: false,
          previewMode: false,
          loadedFile: null,
          loadedGeoJSON: null,
          multipolygons: [],
          locations: [],
          jobName: "",
          startYear: 1985,
          endYear: 2023,
        });
      },
      fetchJobLogs: (jobKey) => {
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return null;
        }

        let escapedKey = encodeURIComponent(jobKey);

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
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return null;
        }

        let escapedKey = encodeURIComponent(jobKey);
        let escapedName = encodeURIComponent(jobName);

        return axiosInstance
          .get(`${API_URL}/job/status?key=${escapedKey}&name=${escapedName}`)
          .then((response) => {
            set((state) => {
              let jobStatuses = { ...state.jobStatuses };
              jobStatuses[jobKey] = response.data;
              return { jobStatuses };
            });
            return response.data;
          })
          .catch((error) => {
            // Only log error message if status !== 404
            let errorMessage = error?.response?.status === 404 ? "" : error?.message || "Error fetching job status";

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
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return null;
        }

        let formData = new FormData();
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
        let pendingJobs = get()
          .queue.filter((job) => job.status === "Pending")
          .map((job) => job.key);

        if (pendingJobs.length === 0) {
          return;
        }

        get().bulkDeleteJobs(pendingJobs, true);
      },
      users: [],
      totalUsers: 0,
      adminFetchUsers: (page = 0) => {
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .get(`${API_URL}/admin/users?page=${page}`)
          .then((response) => {
            let users: UserListingDetails[] = response.data.users;
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
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .delete(`${API_URL}/admin/delete_user?userId=${userId}`)
          .then(() => {
            set((state) => {
              let users = state.users.filter((user) => user.user_id !== userId);
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
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .post(`${API_URL}/admin/update_user`, { userId, roles })
          .then(() => {
            set((state) => {
              let users = state.users.map((user) => {
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
        let axiosInstance = get().authAxios();
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
        let axiosInstance = get().authAxios();
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
        let axiosInstance = get().authAxios();
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
      changelog: "",
      version: "0.0.0",
      loadVersion: () => {
        let version = packageJson.version;
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
      visibleReferenceLayers: [],
      setVisibleReferenceLayers: (visibleReferenceLayers) => set({ visibleReferenceLayers }),
      ardTiles: {},
      fetchARDTiles: () => {
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .get(`${API_URL}/ard_tiles`)
          .then((response) => {
            set({ ardTiles: response.data });
          })
          .catch((error) => {
            console.error("Error fetching ARD tiles", error);
            set({ errorMessage: error?.response?.data || error?.message || "Error fetching ARD tiles" });
          });
      },
      searchGeoJSONs: () => {
        let axiosInstance = get().authAxios();
        if (!axiosInstance) {
          return;
        }

        axiosInstance
          .get(`${API_URL}/search_geojsons`)
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
    })),
    {
      name: "et-visualizer-state",
      partialize: (state) => ({
        lastSeenVersion: state.lastSeenVersion,
        sortAscending: state.sortAscending,
        changelog: state.changelog,
        ardTiles: state.ardTiles,
        mapLayerKey: state.mapLayerKey,
        showARDTiles: state.showARDTiles,
      }),
    }
  )
);

export default useStore;
