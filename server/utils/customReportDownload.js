const fs = require("fs");
const os = require("os");
const path = require("path");
const archiver = require("archiver");
const { area: turfArea } = require("@turf/turf");
const constants = require("../constants");
const {
  generateCustomReport,
  buildJobPaths,
  parseUnits,
  parseBoolean,
} = require("./customReportExport");
const {
  processFigureFiles,
  processReportFiles,
  processMonthlyNanFiles,
  processLandsatPassCounts,
  appendJobCsvsToArchive,
  buildYearlyCombinedCsv,
  buildMonthlyCombinedCsv,
} = require("./reportArchive");

const getPreviewPageDownloadName = (jobName, previewPage) => {
  if (previewPage.startsWith("year:")) {
    const year = previewPage.replace("year:", "");
    return `${jobName}_${year}_report.png`;
  }
  if (previewPage === "summary") {
    return `${jobName}_summary.png`;
  }
  if (previewPage === "yearly-combined") {
    return `${jobName}_yearly_combined.png`;
  }
  if (previewPage.startsWith("documentation:")) {
    const page = previewPage.replace("documentation:", "");
    return `${jobName}_documentation_page_${page}.png`;
  }
  return `${jobName}_preview.png`;
};

const parsePreviewPageQuery = (previewPage) => {
  if (!previewPage) {
    return { previewKind: "summary" };
  }
  if (previewPage.startsWith("year:")) {
    return { previewKind: "year", year: Number(previewPage.replace("year:", "")) };
  }
  if (previewPage === "summary") {
    return { previewKind: "summary" };
  }
  if (previewPage === "yearly-combined") {
    return { previewKind: "yearly_combined" };
  }
  if (previewPage.startsWith("documentation:")) {
    return { previewKind: "documentation", previewPage: Number(previewPage.replace("documentation:", "")) || 1 };
  }
  throw new Error("Invalid preview page");
};

const addCustomJobOutputsToArchive = async (archive, job, options, tempDir) => {
  await generateCustomReport(job, { ...options, outputDir: tempDir });
  const units = parseUnits(options.etUnits);
  const includeYearlyCombined = parseBoolean(options.includeYearlyCombined);
  const { roiPath } = buildJobPaths(job);

  archive.file(roiPath, { name: `${job.name}.geojson` });

  processFigureFiles(archive, tempDir, units, "", includeYearlyCombined);
  processReportFiles(archive, tempDir, units, "");

  const geojson = JSON.parse(fs.readFileSync(roiPath, "utf8"));
  const area = turfArea(geojson) / 4046.86;
  const nanValues = processMonthlyNanFiles(constants.run_directory_base, job.key, job.name);
  const landsatPassCounts = processLandsatPassCounts(constants.run_directory_base, job.key, job.name);
  await appendJobCsvsToArchive(
    archive,
    constants.run_directory_base,
    job.key,
    job.name,
    nanValues,
    landsatPassCounts,
    units,
    area,
    "",
  );
};

const streamCustomReportZip = async (job, options, res) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "et-custom-zip-"));
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (error) => {
    throw error;
  });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${job.name}_custom_report.zip"`);
  archive.pipe(res);

  try {
    await addCustomJobOutputsToArchive(archive, job, options, tempDir);
    await archive.finalize();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const buildYearlyCombinedCsvForJob = (job, options) => {
  const units = parseUnits(options.etUnits);
  const { roiPath } = buildJobPaths(job);
  const geojson = JSON.parse(fs.readFileSync(roiPath, "utf8"));
  const area = turfArea(geojson) / 4046.86;
  return buildYearlyCombinedCsv(constants.run_directory_base, job.key, job.name, units, area);
};

const buildMonthlyCombinedCsvForJob = (job, options) => {
  const units = parseUnits(options.etUnits);
  const { roiPath } = buildJobPaths(job);
  const geojson = JSON.parse(fs.readFileSync(roiPath, "utf8"));
  const area = turfArea(geojson) / 4046.86;
  return buildMonthlyCombinedCsv(constants.run_directory_base, job.key, job.name, units, area);
};

module.exports = {
  addCustomJobOutputsToArchive,
  buildYearlyCombinedCsvForJob,
  buildMonthlyCombinedCsvForJob,
  getPreviewPageDownloadName,
  parsePreviewPageQuery,
  streamCustomReportZip,
};
