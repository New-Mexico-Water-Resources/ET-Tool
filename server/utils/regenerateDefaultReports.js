const fs = require("fs");
const os = require("os");
const path = require("path");
const { generateCustomReport, buildJobPaths } = require("./customReportExport");
const { getReportDownloadOptions } = require("./defaultDownloadOptions");

const UNIT_FIGURE_SUFFIX = {
  metric: "",
  imperial: "_in",
  "acre-feet": "_AF",
};

const UNIT_REPORT_SUFFIX = {
  metric: "_Report.pdf",
  imperial: "_Imperial_Report.pdf",
  "acre-feet": "_AF_Report.pdf",
};

const installGeneratedReportArtifacts = (sourceDir, targetDir, jobName, units) => {
  const figureSuffix = UNIT_FIGURE_SUFFIX[units] || "";
  const reportSuffix = UNIT_REPORT_SUFFIX[units] || UNIT_REPORT_SUFFIX.metric;

  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir)) {
    const sourcePath = path.join(sourceDir, entry);
    if (!fs.statSync(sourcePath).isFile()) {
      continue;
    }

    if (entry.endsWith("_Report.pdf")) {
      fs.copyFileSync(sourcePath, path.join(targetDir, `${jobName}${reportSuffix}`));
      continue;
    }

    if (!entry.endsWith(".png")) {
      continue;
    }

    if (entry.startsWith("summary_")) {
      const targetName = `summary_${jobName}${figureSuffix}.png`;
      fs.copyFileSync(sourcePath, path.join(targetDir, targetName));
      continue;
    }

    const yearMatch = entry.match(/^(\d{4})_/);
    if (yearMatch) {
      const targetName = `${yearMatch[1]}_${jobName}${figureSuffix}.png`;
      fs.copyFileSync(sourcePath, path.join(targetDir, targetName));
    }
  }
};

const regenerateDefaultReports = async (job) => {
  const reportOptions = getReportDownloadOptions();
  if (!reportOptions.length) {
    return;
  }

  const { outputDirectory } = buildJobPaths(job);
  const figureDirectory = path.join(outputDirectory, "figures", job.name);
  fs.mkdirSync(figureDirectory, { recursive: true });

  for (const option of reportOptions) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "et-default-report-"));
    try {
      await generateCustomReport(job, {
        etUnits: option.etUnits,
        pptUnits: option.pptUnits,
        colorScale: option.colorScale,
        showMonthlyAverages: option.showMonthlyAverages,
        outputDir: tempDir,
      });
      installGeneratedReportArtifacts(tempDir, figureDirectory, job.name, option.units);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
};

module.exports = {
  regenerateDefaultReports,
};
