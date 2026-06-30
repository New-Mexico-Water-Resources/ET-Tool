const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const constants = require("../constants");
const { buildJobPaths } = require("./customReportExport");
const { CUSTOM_REPORT_PREVIEW_VERSION } = require("./customReportPreview");

const GENERATE_SCRIPT = path.join(__dirname, "generateComparisonReport.py");
const VALID_UNITS = new Set(["metric", "imperial", "acre-feet"]);
const VALID_COLOR_SCALES = new Set(["across_years", "per_year", "custom"]);

const parseColorScale = (value, fallback = "across_years") => {
  const colorScale = String(value || fallback);
  if (colorScale === "global") {
    return "across_years";
  }
  if (colorScale === "per_month") {
    return "per_year";
  }
  return VALID_COLOR_SCALES.has(colorScale) ? colorScale : fallback;
};

const parseUnits = (value, fallback = "metric") => {
  const units = String(value || fallback);
  return VALID_UNITS.has(units) ? units : fallback;
};

const parseOptionalNumber = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return value === true || value === "true";
};

const buildJobSource = (job) => {
  const { outputDirectory, roiPath } = buildJobPaths(job);
  const startYear = Number(job.start_year);
  const endYear = Number(job.end_year);

  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) {
    throw new Error(`Job ${job.name} is missing start or end year`);
  }

  return {
    output_directory: outputDirectory,
    roi_path: roiPath,
    roi_name: job.name,
    start_year: startYear,
    end_year: endYear,
  };
};

const VALID_MAP_TILE_MODES = new Set(["yearly_total", "yearly_average", "month", "winter", "spring", "summer", "fall"]);

const parseMapTileMode = (value, fallback = "yearly_total") => {
  const mapTileMode = String(value || fallback);
  if (mapTileMode === "yearly_average") {
    return "yearly_total";
  }
  return VALID_MAP_TILE_MODES.has(mapTileMode) ? mapTileMode : fallback;
};

const parseMapTileMonth = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const month = Math.trunc(parsed);
  if (month < 1 || month > 12) {
    return fallback;
  }
  return month;
};

const buildComparisonReportConfig = (primaryJob, comparisonJob, options) => ({
  mode: options.mode,
  primary: buildJobSource(primaryJob),
  comparison: buildJobSource(comparisonJob),
  et_units: parseUnits(options.etUnits),
  ppt_units: parseUnits(options.pptUnits, parseUnits(options.etUnits)),
  et_eto_scale: parseColorScale(options.etEtoScale),
  et_eto_custom_min: parseOptionalNumber(options.etEtoCustomMin),
  et_eto_custom_max: parseOptionalNumber(options.etEtoCustomMax),
  ppt_scale: parseColorScale(options.pptScale),
  ppt_custom_min: parseOptionalNumber(options.pptCustomMin),
  ppt_custom_max: parseOptionalNumber(options.pptCustomMax),
  color_scale: parseColorScale(options.colorScale),
  et_custom_min: parseOptionalNumber(options.etCustomMin),
  et_custom_max: parseOptionalNumber(options.etCustomMax),
  requestor: primaryJob.user || null,
  year: options.year,
  preview_kind: options.previewKind || "year",
  include_summary: options.includeSummary !== false,
  include_yearly_combined: parseBoolean(options.includeYearlyCombined),
  preview_version: Number(options.previewVersion) || CUSTOM_REPORT_PREVIEW_VERSION,
  force_refresh: parseBoolean(options.forceRefresh),
  output_dir: options.outputDir || null,
  map_tile_mode: parseMapTileMode(options.mapTileMode),
  map_tile_month: parseMapTileMonth(options.mapTileMonth),
});

const runGenerateComparisonReport = (config) =>
  new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "et-comparison-report-"));
    const configPath = path.join(tmpDir, "config.json");

    try {
      fs.writeFileSync(configPath, JSON.stringify(config));

      const child = spawn("python3", [GENERATE_SCRIPT, "--config", configPath], {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: constants.project_directory,
        env: {
          ...process.env,
          PYTHONPATH: constants.project_directory,
        },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }

        if (code !== 0) {
          let message = stderr.trim();
          try {
            const parsed = JSON.parse(stderr.trim());
            message = parsed.error || message;
          } catch {
            // use raw stderr
          }
          reject(new Error(message || `python3 exited with code ${code}`));
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          if (config.mode === "bounds") {
            resolve(result);
            return;
          }
          if (!result.path) {
            reject(new Error("Comparison report generator did not return a file path"));
            return;
          }
          resolve(result.path);
        } catch (error) {
          reject(new Error(`Failed to parse comparison report output: ${error.message}`));
        }
      });
    } catch (error) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
      reject(error);
    }
  });

const generateComparisonPreview = async (primaryJob, comparisonJob, options) => {
  const previewKind = options.previewKind || "year";
  if (previewKind === "year" && !options.year) {
    throw new Error("Preview year is required");
  }

  const config = buildComparisonReportConfig(primaryJob, comparisonJob, { ...options, mode: "preview" });
  return runGenerateComparisonReport(config);
};

const getComparisonScaleBounds = async (primaryJob, comparisonJob, options) => {
  const year = Number(options.year);
  if (!Number.isFinite(year)) {
    throw new Error("Year is required to fetch comparison scale bounds");
  }
  const config = buildComparisonReportConfig(primaryJob, comparisonJob, { ...options, mode: "bounds", year });
  return runGenerateComparisonReport(config);
};

const generateComparisonReport = async (primaryJob, comparisonJob, options) => {
  const config = buildComparisonReportConfig(primaryJob, comparisonJob, { ...options, mode: "report" });
  return runGenerateComparisonReport(config);
};

const parseComparisonReportOptions = (query) => ({
  etUnits: query.etUnits,
  pptUnits: query.pptUnits,
  etEtoScale: query.etEtoScale,
  etEtoCustomMin: query.etEtoCustomMin,
  etEtoCustomMax: query.etEtoCustomMax,
  pptScale: query.pptScale,
  pptCustomMin: query.pptCustomMin,
  pptCustomMax: query.pptCustomMax,
  colorScale: query.colorScale,
  etCustomMin: query.etCustomMin,
  etCustomMax: query.etCustomMax,
  includeYearlyCombined: query.includeYearlyCombined,
  previewVersion: query.previewVersion,
  forceRefresh: query.refresh === "true",
  mapTileMode: query.mapTileMode,
  mapTileMonth: query.mapTileMonth,
});

const getComparisonSlug = (primaryName, comparisonName) => `${primaryName}_vs_${comparisonName}`;

const getComparisonPreviewPageDownloadName = (primaryName, comparisonName, previewPage) => {
  const slug = getComparisonSlug(primaryName, comparisonName);
  if (previewPage.startsWith("year:")) {
    return `${slug}_${previewPage.replace("year:", "")}_comparison.png`;
  }
  if (previewPage === "summary") {
    return `${slug}_summary_comparison.png`;
  }
  if (previewPage === "yearly-combined") {
    return `${slug}_yearly_combined_comparison.png`;
  }
  return `${slug}_comparison_preview.png`;
};

module.exports = {
  generateComparisonPreview,
  generateComparisonReport,
  getComparisonScaleBounds,
  getComparisonPreviewPageDownloadName,
  getComparisonSlug,
  parseComparisonReportOptions,
};
