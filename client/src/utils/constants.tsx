import nm_geojson from "../assets/geojsons/nm.json";
import nm_counties_geojson from "../assets/geojsons/nm_counties.json";

const NASS_CDL_WMS_URL =
  import.meta.env.VITE_CDL_WMS_URL || "/cdl-wms/CropScapeService/wms_cdlall.cgi";

export const API_URL = import.meta.env.VITE_API_URL || "/api";
export const TILE_SERVER_URL = import.meta.env.VITE_TILE_SERVER_URL || "/ts_v1/tiles";

export const ARD_TILES_DATA_VERSION = 2;

export const authConfig = {
  domain: import.meta.env.VITE_AUTH0_DOMAIN || "",
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID || "",
  audience: import.meta.env.VITE_AUTH0_AUDIENCE || "",
};

export const ROLES = {
  ADMIN: import.meta.env.VITE_ADMIN_ROLE,
  NEW_MEXICO_USER: import.meta.env.VITE_NEW_MEXICO_USER_ROLE,
  NEW_USER: import.meta.env.VITE_NEW_USER_ROLE,
  JOB_APPROVER: import.meta.env.VITE_JOB_APPROVER,
  JOB_SUBMITTER: import.meta.env.VITE_JOB_SUBMITTER,
};

export const OPENET_TRANSITION_DATE = 1985;
export const DATA_END_YEAR = 2025;

export const ET_COLORMAP = ["#f6e8c3", "#d8b365", "#99974a", "#53792d", "#6bdfd2", "#1839c5"];
export const DIFF_COLORMAP = ["#d7191c", "#fdae61", "#ffffbf", "#a6d96a", "#1a9641"];

export const ALL_VARIABLE_OPTIONS = ["ET", "ET_MIN", "ET_MAX", "PET", "PPT"];
export const BASE_VARIABLE_DISPLAY_NAMES = {
  ET: "ET",
  ET_MIN: "ET MIN",
  ET_MAX: "ET MAX",
  PET: "ETO",
  PPT: "PPT",
};

export const REFERENCE_GEOJSONS = {
  "New Mexico (State Boundary)": {
    name: "New Mexico",
    data: nm_geojson,
  },
  "New Mexico (Counties)": {
    name: "New Mexico",
    data: nm_counties_geojson,
  },
  "US Drought Monitor": {
    name: "US Drought Monitor",
    droughtMonitor: true,
  },
};

export const DROUGHT_MONITOR_METADATA = [
  { color: "#FFFF00", category: "D0", label: "Abnormally Dry" },
  { color: "#FCD37F", category: "D1", label: "Moderate Drought" },
  { color: "#FFAA00", category: "D2", label: "Severe Drought" },
  { color: "#E60000", category: "D3", label: "Extreme Drought" },
  { color: "#730000", category: "D4", label: "Exceptional Drought" },
];

export const MAP_LAYER_OPTIONS = {
  "Google Satellite": {
    name: "Google Satellite",
    attribution: 'Imagery <a href="https://www.google.com/">Google</a>',
    url: "http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}&hl=en",
    maxZoom: 20,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
  },
  "Google Street View": {
    name: "Google Street View",
    attribution: 'Imagery <a href="https://www.google.com/">Google</a>',
    url: "http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=en",
    maxZoom: 20,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
  },
  "Google Hybrid": {
    name: "Google Hybrid",
    attribution: 'Imagery <a href="https://www.google.com/">Google</a>',
    url: "http://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=en",
    maxZoom: 20,
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
  },
  "USGS US Imagery Topo": {
    name: "USGS US Imagery Topo",
    attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
    url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
  },
  "USDA Cropland Data Layer": {
    name: "USDA Cropland Data Layer",
    attribution:
      '<a href="https://www.nass.usda.gov/Research_and_Science/Cropland/">USDA NASS Cropland Data Layer</a> via <a href="https://nassgeodata.gmu.edu/CropScape/">CropScape</a> (George Mason University).',
    url: NASS_CDL_WMS_URL,
    maxZoom: 16,
    subdomains: [],
    wmsLayers: "cdl_latest",
    wmsLegend: true,
  },
  "MODIS Terra True Color CR": {
    name: "MODIS Terra True Color CR",
    attribution:
      'Imagery provided by services from the Global Imagery Browse Services (GIBS), operated by the NASA/GSFC/Earth Science Data and Information System (<a href="https://earthdata.nasa.gov">ESDIS</a>) with funding provided by NASA/HQ.',
    url: "https://map1.vis.earthdata.nasa.gov/wmts-webmerc/MODIS_Terra_CorrectedReflectance_TrueColor/default/{time}/GoogleMapsCompatible_Level{maxZoom}/{z}/{y}/{x}.jpg",
    maxZoom: 9,
    time: "2023-01-01",
    gibsDescribeDomains: {
      layerId: "MODIS_Terra_CorrectedReflectance_TrueColor",
      tileMatrixSet: "GoogleMapsCompatible_Level9",
    },
  },
  "VIIRS SNPP NDVI 8-Day": {
    name: "VIIRS SNPP NDVI 8-Day",
    attribution:
      'Imagery provided by services from the Global Imagery Browse Services (GIBS), operated by the NASA/GSFC/Earth Science Data and Information System (<a href="https://earthdata.nasa.gov">ESDIS</a>) with funding provided by NASA/HQ. Rolling 8-day composite: {compositePeriod}.',
    url: "https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_SNPP_NDVI_8Day/default/{time}/GoogleMapsCompatible_Level{maxZoom}/{z}/{y}/{x}.png",
    maxZoom: 8,
    time: "2026-05-06",
    compositePeriodDays: 8,
    gibsDescribeDomains: {
      layerId: "VIIRS_SNPP_NDVI_8Day",
      tileMatrixSet: "GoogleMapsCompatible_Level8",
    },
  },
  "MODIS ET 500": {
    name: "MODIS ET 500",
    attribution:
      'Imagery re-formatted and made available from the NASA MODIS MOD16A2 dataset, "Steve Running, Qiaozhen Mu - University of Montana and MODAPS SIPS - NASA. (2015). MOD16A2 MODIS/Terra Evapotranspiration 8-day L4 Global 500m SIN Grid. NASA LP DAAC. http://doi.org/10.5067/MODIS/MOD16A2.006"',
    url: `${TILE_SERVER_URL}/{refresh}/MOD16A2/ET/{time}/{z}/{x}/{y}.png?color_min={minColor}&color_max={maxColor}&comparison_mode={mode}`,
    maxZoom: 11,
    time: "2021-01-01",
    backgroundProvider: "Google Satellite",
    labelsProvider: "CartoDB DarkMatter Labels",
    tms: true,
    refresh: "dynamic",
    showColorScale: true,
    availableDatesURL: `${TILE_SERVER_URL}/MOD16A2/dates`,
    statsURL: `${TILE_SERVER_URL}/stats/MOD16A2/ET/{time}/{mode}`,
    units: "mm/8-days",
    modes: {
      absolute: "Absolute",
      prevPass: "Previous Pass Difference",
    },
  },

  "MODIS PET 500": {
    name: "MODIS PET 500",
    attribution:
      'Imagery re-formatted and made available from the NASA MODIS MOD16A2 dataset, "Steve Running, Qiaozhen Mu - University of Montana and MODAPS SIPS - NASA. (2015). MOD16A2 MODIS/Terra Evapotranspiration 8-day L4 Global 500m SIN Grid. NASA LP DAAC. http://doi.org/10.5067/MODIS/MOD16A2.006"',
    url: `${TILE_SERVER_URL}/{refresh}/MOD16A2/PET/{time}/{z}/{x}/{y}.png?color_min={minColor}&color_max={maxColor}&comparison_mode={mode}`,
    maxZoom: 11,
    time: "2021-01-01",
    backgroundProvider: "Google Satellite",
    labelsProvider: "CartoDB DarkMatter Labels",
    tms: true,
    refresh: "dynamic",
    showColorScale: true,
    availableDatesURL: `${TILE_SERVER_URL}/MOD16A2/dates`,
    statsURL: `${TILE_SERVER_URL}/stats/MOD16A2/PET/{time}/{mode}`,
    units: "mm/8-days",
    modes: {
      absolute: "Absolute",
      prevPass: "Previous Pass Difference",
    },
  },

  "MODIS ESI 500": {
    name: "MODIS ESI 500",
    attribution:
      'Imagery re-formatted and made available from the NASA MODIS MOD16A2 dataset, "Steve Running, Qiaozhen Mu - University of Montana and MODAPS SIPS - NASA. (2015). MOD16A2 MODIS/Terra Evapotranspiration 8-day L4 Global 500m SIN Grid. NASA LP DAAC. http://doi.org/10.5067/MODIS/MOD16A2.006"',
    url: `${TILE_SERVER_URL}/{refresh}/MOD16A2/ESI/{time}/{z}/{x}/{y}.png?color_min={minColor}&color_max={maxColor}&comparison_mode={mode}`,
    maxZoom: 11,
    time: "2021-01-01",
    backgroundProvider: "Google Satellite",
    labelsProvider: "CartoDB DarkMatter Labels",
    tms: true,
    refresh: "dynamic",
    showColorScale: true,
    availableDatesURL: `${TILE_SERVER_URL}/MOD16A2/dates`,
    statsURL: `${TILE_SERVER_URL}/stats/MOD16A2/ESI/{time}/{mode}`,
    units: "",
    step: 0.01,
    modes: {
      absolute: "Absolute",
      prevPass: "Previous Pass Difference",
    },
  },
  "VIIRS ET 500": {
    name: "VIIRS ET 500",
    attribution:
      'Imagery re-formatted and made available from the NASA VIIRS VJ116A2 dataset, "Zhao, M., Kimball, J., & Devadiga, S. (2025). VIIRS/JPSS1 Actual and Potential Evapotranspiration 8-Day L4 Global 500m SIN Grid V002 [Data set]. NASA LP DAAC. https://doi.org/10.5067/VIIRS/VJ116A2.002"',
    url: `${TILE_SERVER_URL}/{refresh}/VJ116A2/ET/{time}/{z}/{x}/{y}.png?color_min={minColor}&color_max={maxColor}&comparison_mode={mode}`,
    maxZoom: 11,
    time: "2021-01-01",
    backgroundProvider: "Google Satellite",
    labelsProvider: "CartoDB DarkMatter Labels",
    tms: true,
    refresh: "dynamic",
    showColorScale: true,
    availableDatesURL: `${TILE_SERVER_URL}/VJ116A2/dates`,
    statsURL: `${TILE_SERVER_URL}/stats/VJ116A2/ET/{time}/{mode}`,
    units: "mm/8-days",
    modes: {
      absolute: "Absolute",
      prevPass: "Previous Pass Difference",
    },
  },

  "VIIRS PET 500": {
    name: "VIIRS PET 500",
    attribution:
      'Imagery re-formatted and made available from the NASA VIIRS VJ116A2 dataset, "Zhao, M., Kimball, J., & Devadiga, S. (2025). VIIRS/JPSS1 Actual and Potential Evapotranspiration 8-Day L4 Global 500m SIN Grid V002 [Data set]. NASA LP DAAC. https://doi.org/10.5067/VIIRS/VJ116A2.002"',
    url: `${TILE_SERVER_URL}/{refresh}/VJ116A2/PET/{time}/{z}/{x}/{y}.png?color_min={minColor}&color_max={maxColor}&comparison_mode={mode}`,
    maxZoom: 11,
    time: "2021-01-01",
    backgroundProvider: "Google Satellite",
    labelsProvider: "CartoDB DarkMatter Labels",
    tms: true,
    refresh: "dynamic",
    showColorScale: true,
    availableDatesURL: `${TILE_SERVER_URL}/VJ116A2/dates`,
    statsURL: `${TILE_SERVER_URL}/stats/VJ116A2/PET/{time}/{mode}`,
    units: "mm/8-days",
    modes: {
      absolute: "Absolute",
      prevPass: "Previous Pass Difference",
    },
  },

  "VIIRS ESI 500": {
    name: "VIIRS ESI 500",
    attribution:
      'Imagery re-formatted and made available from the NASA VIIRS VJ116A2 dataset, "Zhao, M., Kimball, J., & Devadiga, S. (2025). VIIRS/JPSS1 Actual and Potential Evapotranspiration 8-Day L4 Global 500m SIN Grid V002 [Data set]. NASA LP DAAC. https://doi.org/10.5067/VIIRS/VJ116A2.002"',
    url: `${TILE_SERVER_URL}/{refresh}/VJ116A2/ESI/{time}/{z}/{x}/{y}.png?color_min={minColor}&color_max={maxColor}&comparison_mode={mode}`,
    maxZoom: 11,
    time: "2021-01-01",
    backgroundProvider: "Google Satellite",
    labelsProvider: "CartoDB DarkMatter Labels",
    tms: true,
    refresh: "dynamic",
    showColorScale: true,
    availableDatesURL: `${TILE_SERVER_URL}/VJ116A2/dates`,
    statsURL: `${TILE_SERVER_URL}/stats/VJ116A2/ESI/{time}/{mode}`,
    units: "",
    step: 0.01,
    modes: {
      absolute: "Absolute",
      prevPass: "Previous Pass Difference",
    },
  },

  // Hidden layers
  "CartoDB DarkMatter Labels": {
    name: "CartoDB DarkMatter Labels",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    url: "https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png",
    maxZoom: 20,
    subdomains: "abcd",
    hidden: true,
  },
};

export const QUEUE_STATUSES = ["Pending", "In Progress", "WaitingApproval", "Paused"];

export const ALL_JOB_STATUSES = [
  "Pending",
  "WaitingApproval",
  "In Progress",
  "Paused",
  "Complete",
  "Failed",
  "Killed",
];

const JOB_STATUS_DISPLAY_NAMES: Record<string, string> = {
  WaitingApproval: "Waiting For Approval",
};

const JOB_STATUS_DESCRIPTIONS: Record<string, string> = {
  Pending: "Queued for processing",
  WaitingApproval: "Waiting for admin to approve job",
  "In Progress": "Currently processing",
  Paused: "Job is paused",
  Complete: "Job finished successfully",
  Failed: "Job failed",
  Killed: "Job was manually killed",
};

export function getJobStatusDisplayName(status: string): string {
  return JOB_STATUS_DISPLAY_NAMES[status] ?? status;
}

export function getJobStatusTooltip(status: string, statusMessage?: string | null): string {
  const displayStatus = getJobStatusDisplayName(status);
  const defaultDescription = JOB_STATUS_DESCRIPTIONS[status];
  const message = statusMessage?.trim();
  const lines = [displayStatus];

  if (status === "Complete") {
    if (defaultDescription) {
      lines.push(defaultDescription);
    }
    return lines.join("\n");
  }

  const detail =
    message && message !== status && message !== displayStatus ? message : defaultDescription;

  if (detail) {
    lines.push(detail);
  }

  return lines.join("\n");
}

export function getCdlDisplayYear(
  layer: { wmsLayers?: string } | undefined,
  releaseYear?: number | null
): number | undefined {
  if (releaseYear != null) {
    return releaseYear;
  }
  if (!layer) {
    return undefined;
  }
  const match = layer.wmsLayers?.match(/^cdl_(\d{4})$/);
  return match ? Number(match[1]) : undefined;
}
