const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const constants = require("../constants");

const GENERATE_SCRIPT = path.join(__dirname, "generateCustomReport.py");
const DOC_PREVIEW_CACHE_DIR = path.join(
  constants.project_directory,
  "water_rights_visualizer",
  "documentation_preview_cache",
);
const VALID_UNITS = new Set(["metric", "imperial", "acre-feet"]);
const VALID_COLOR_SCALES = new Set(["across_years", "per_year", "custom"]);

const normalizeColorScale = (value, fallback = "across_years") => {
  const colorScale = String(value || fallback);
  if (colorScale === "global") {
    return "across_years";
  }
  if (colorScale === "per_month") {
    return "per_year";
  }
  return VALID_COLOR_SCALES.has(colorScale) ? colorScale : fallback;
};

const parseColorScale = (value, fallback = "across_years") => normalizeColorScale(value, fallback);

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

const unitFigureSuffix = (units) => {
  if (units === "imperial") {
    return "_in";
  }
  if (units === "acre-feet") {
    return "_AF";
  }
  return "";
};

const canUsePipelineFigures = (options) => {
  const etUnits = parseUnits(options.etUnits);
  const pptUnits = parseUnits(options.pptUnits, etUnits);
  const colorScale = parseColorScale(options.colorScale);
  const showMonthlyAverages = parseBoolean(options.showMonthlyAverages);
  return colorScale === "across_years" && !showMonthlyAverages && etUnits === pptUnits;
};

const resolvePipelinePreviewPath = (job, options) => {
  if (!canUsePipelineFigures(options)) {
    return null;
  }

  const { outputDirectory } = buildJobPaths(job);
  const etUnits = parseUnits(options.etUnits);
  const suffix = unitFigureSuffix(etUnits);
  const figureDirectory = path.join(outputDirectory, "figures", job.name);
  const previewKind = options.previewKind || "year";

  if (previewKind === "year" && options.year != null) {
    return path.join(figureDirectory, `${options.year}_${job.name}${suffix}.png`);
  }
  if (previewKind === "summary") {
    return path.join(figureDirectory, `summary_${job.name}${suffix}.png`);
  }
  return null;
};

const resolveDocumentationPreviewPath = (previewPage) => {
  const page = Number(previewPage) || 1;
  return path.join(DOC_PREVIEW_CACHE_DIR, `page_${page}.png`);
};

const buildJobPaths = (job) => {
  const runDirectory = path.join(constants.run_directory_base, job.key);
  const outputDirectory = path.join(runDirectory, "output");
  const roiPath = path.join(runDirectory, `${job.name}.geojson`);

  if (!fs.existsSync(roiPath)) {
    throw new Error(`GeoJSON not found for job ${job.name}`);
  }
  if (!fs.existsSync(outputDirectory)) {
    throw new Error(`Job output not found for ${job.name}`);
  }

  return { runDirectory, outputDirectory, roiPath };
};

const buildReportConfig = (job, options) => {
  const { outputDirectory, roiPath } = buildJobPaths(job);
  const startYear = Number(job.start_year);
  const endYear = Number(job.end_year);

  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) {
    throw new Error(`Job ${job.name} is missing start or end year`);
  }

  return {
    mode: options.mode,
    output_directory: outputDirectory,
    roi_path: roiPath,
    roi_name: job.name,
    start_year: startYear,
    end_year: endYear,
    et_units: parseUnits(options.etUnits),
    ppt_units: parseUnits(options.pptUnits, parseUnits(options.etUnits)),
    color_scale: parseColorScale(options.colorScale),
    et_custom_min: parseOptionalNumber(options.etCustomMin),
    et_custom_max: parseOptionalNumber(options.etCustomMax),
    show_monthly_averages: parseBoolean(options.showMonthlyAverages),
    requestor: job.user || null,
    year: options.year,
    preview_kind: options.previewKind || "year",
    preview_page: options.previewPage != null ? Number(options.previewPage) : 1,
    include_summary: options.includeSummary !== false,
    include_documentation: options.includeDocumentation !== false,
    output_dir: options.outputDir || null,
  };
};

const runGenerateCustomReport = (config) =>
  new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "et-custom-report-"));
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
            reject(new Error("Custom report generator did not return a file path"));
            return;
          }
          resolve(result.path);
        } catch (error) {
          reject(new Error(`Failed to parse custom report output: ${error.message}`));
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

const generateCustomPreview = async (job, options) => {
  const previewKind = options.previewKind || "year";
  if (previewKind === "year" && !options.year) {
    throw new Error("Preview year is required");
  }

  if (previewKind === "documentation") {
    const docPath = resolveDocumentationPreviewPath(options.previewPage);
    if (fs.existsSync(docPath)) {
      return docPath;
    }
  } else {
    const pipelinePath = resolvePipelinePreviewPath(job, options);
    if (pipelinePath && fs.existsSync(pipelinePath)) {
      return pipelinePath;
    }
  }

  const config = buildReportConfig(job, { ...options, mode: "preview" });
  return runGenerateCustomReport(config);
};

const getEtScaleBounds = async (job, options) => {
  const year = Number(options.year);
  if (!Number.isFinite(year)) {
    throw new Error("Year is required to fetch ET scale bounds");
  }
  const config = buildReportConfig(job, { ...options, mode: "bounds", year });
  return runGenerateCustomReport(config);
};

const generateCustomReport = async (job, options) => {
  const config = buildReportConfig(job, { ...options, mode: "report" });
  return runGenerateCustomReport(config);
};

module.exports = {
  buildJobPaths,
  generateCustomPreview,
  generateCustomReport,
  getEtScaleBounds,
  parseColorScale,
  parseUnits,
};
