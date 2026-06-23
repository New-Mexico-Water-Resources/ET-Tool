const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "config", "defaultDownloadOptions.json");

let cachedConfig = null;

const loadDefaultDownloadOptions = () => {
  if (cachedConfig) {
    return cachedConfig;
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  cachedConfig = JSON.parse(raw);
  return cachedConfig;
};

const getReportDownloadOptions = () =>
  loadDefaultDownloadOptions().options.filter((option) => option.type === "report");

const getDownloadOptionByUnits = (units) =>
  getReportDownloadOptions().find((option) => option.units === units) || null;

const reloadDefaultDownloadOptions = () => {
  cachedConfig = null;
  return loadDefaultDownloadOptions();
};

module.exports = {
  loadDefaultDownloadOptions,
  getReportDownloadOptions,
  getDownloadOptionByUnits,
  reloadDefaultDownloadOptions,
};
