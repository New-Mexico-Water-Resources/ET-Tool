const fs = require("fs");
const os = require("os");
const path = require("path");
const archiver = require("archiver");
const { area: turfArea } = require("@turf/turf");
const constants = require("../constants");
const {
  generateComparisonReport,
  getComparisonSlug,
} = require("./comparisonReportExport");
const { buildJobPaths, parseUnits, parseBoolean } = require("./customReportExport");
const {
  buildComparisonMonthlyCsv,
  buildComparisonYearlyCsv,
  processComparisonFigureFiles,
  processComparisonReportFiles,
} = require("./reportArchive");

const getJobArea = (job) => {
  const { roiPath } = buildJobPaths(job);
  const geojson = JSON.parse(fs.readFileSync(roiPath, "utf8"));
  return turfArea(geojson) / 4046.86;
};

const buildComparisonMonthlyCsvForJobs = (primaryJob, comparisonJob, options) => {
  const units = parseUnits(options.etUnits);
  return buildComparisonMonthlyCsv(
    constants.run_directory_base,
    primaryJob,
    comparisonJob,
    units,
    getJobArea(primaryJob),
    getJobArea(comparisonJob),
  );
};

const buildComparisonYearlyCsvForJobs = (primaryJob, comparisonJob, options) => {
  const units = parseUnits(options.etUnits);
  return buildComparisonYearlyCsv(
    constants.run_directory_base,
    primaryJob,
    comparisonJob,
    units,
    getJobArea(primaryJob),
    getJobArea(comparisonJob),
  );
};

const addComparisonOutputsToArchive = async (archive, primaryJob, comparisonJob, options, tempDir) => {
  const includeYearlyCombined = parseBoolean(options.includeYearlyCombined);
  const slug = getComparisonSlug(primaryJob.name, comparisonJob.name);

  await generateComparisonReport(primaryJob, comparisonJob, { ...options, outputDir: tempDir });

  const { roiPath: primaryRoiPath } = buildJobPaths(primaryJob);
  const { roiPath: comparisonRoiPath } = buildJobPaths(comparisonJob);
  archive.file(primaryRoiPath, { name: `${primaryJob.name}.geojson` });
  archive.file(comparisonRoiPath, { name: `${comparisonJob.name}.geojson` });

  processComparisonFigureFiles(archive, tempDir, "", includeYearlyCombined);
  processComparisonReportFiles(archive, tempDir, slug, "");

  const monthlyCsv = buildComparisonMonthlyCsvForJobs(primaryJob, comparisonJob, options);
  const yearlyCsv = buildComparisonYearlyCsvForJobs(primaryJob, comparisonJob, options);
  const monthlyCsvPath = path.join(tempDir, monthlyCsv.filename);
  const yearlyCsvPath = path.join(tempDir, yearlyCsv.filename);
  fs.writeFileSync(monthlyCsvPath, monthlyCsv.content);
  fs.writeFileSync(yearlyCsvPath, yearlyCsv.content);
  archive.file(monthlyCsvPath, { name: monthlyCsv.filename });
  archive.file(yearlyCsvPath, { name: yearlyCsv.filename });
};

const streamComparisonReportZip = async (primaryJob, comparisonJob, options, res) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "et-comparison-zip-"));
  const slug = getComparisonSlug(primaryJob.name, comparisonJob.name);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (error) => {
    throw error;
  });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${slug}_comparison_report.zip"`);
  archive.pipe(res);

  try {
    await addComparisonOutputsToArchive(archive, primaryJob, comparisonJob, options, tempDir);
    await archive.finalize();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

module.exports = {
  buildComparisonMonthlyCsvForJobs,
  buildComparisonYearlyCsvForJobs,
  streamComparisonReportZip,
};
