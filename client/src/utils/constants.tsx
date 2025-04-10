import nm_geojson from "../assets/geojsons/nm.json";
import nm_counties_geojson from "../assets/geojsons/nm_counties.json";

export const API_URL = import.meta.env.VITE_API_URL || "/api";
export const TILE_SERVER_URL = import.meta.env.VITE_TILE_SERVER_URL || "/ts_v1/tiles";

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

export const OPENET_TRANSITION_DATE = 2008;

export const ET_COLORMAP = ["#f6e8c3", "#d8b365", "#99974a", "#53792d", "#6bdfd2", "#1839c5"];
export const DIFF_COLORMAP = ["#d7191c", "#fdae61", "#ffffbf", "#a6d96a", "#1a9641"];

export const ALL_VARIABLE_OPTIONS = ["ET", "ET_MIN", "ET_MAX", "PET", "PPT"];
export const PRE_OPENET_VARIABLE_OPTIONS = ["ET", "PET", "PPT"];
export const POST_OPENET_VARIABLE_OPTIONS = ["ET", "PET", "PPT", "ET_MIN", "ET_MAX"];

export const REFERENCE_GEOJSONS = {
  "New Mexico (State Boundary)": {
    name: "New Mexico",
    data: nm_geojson,
  },
  "New Mexico (Counties)": {
    name: "New Mexico",
    data: nm_counties_geojson,
  },
};

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
  "USGS US Imagery Topo": {
    name: "USGS US Imagery Topo",
    attribution: 'Tiles courtesy of the <a href="https://usgs.gov/">U.S. Geological Survey</a>',
    url: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 16,
  },
  "MODIS Terra True Color CR": {
    name: "MODIS Terra True Color CR",
    attribution:
      'Imagery provided by services from the Global Imagery Browse Services (GIBS), operated by the NASA/GSFC/Earth Science Data and Information System (<a href="https://earthdata.nasa.gov">ESDIS</a>) with funding provided by NASA/HQ.',
    url: "https://map1.vis.earthdata.nasa.gov/wmts-webmerc/MODIS_Terra_CorrectedReflectance_TrueColor/default/{time}/GoogleMapsCompatible_Level{maxZoom}/{z}/{y}/{x}.jpg",
    maxZoom: 9,
    time: "2023-01-01",
  },
  "MODIS ET 500": {
    name: "MODIS ET 500",
    attribution:
      'Imagery re-formatted and made available from the NASA MODIS MOD16A2 dataset, "Steve Running, Qiaozhen Mu - University of Montana and MODAPS SIPS - NASA. (2015). MOD16A2 MODIS/Terra Evapotranspiration 8-day L4 Global 500m SIN Grid. NASA LP DAAC. http://doi.org/10.5067/MODIS/MOD16A2.006"',
    url: `${TILE_SERVER_URL}/{refresh}/ET/{time}/{z}/{x}/{y}.png?color_min={minColor}&color_max={maxColor}&comparison_mode={mode}`,
    maxZoom: 11,
    time: "2021-01-01",
    backgroundProvider: "Google Satellite",
    labelsProvider: "CartoDB DarkMatter Labels",
    tms: true,
    refresh: "dynamic",
    availableDatesURL: `${TILE_SERVER_URL}/modis-dates`,
    units: "mm/8-days",
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
