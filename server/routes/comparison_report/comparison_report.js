const express = require("express");
const fs = require("fs");
const constants = require("../../constants");
const {
  generateComparisonPreview,
  generateComparisonReport,
  getComparisonScaleBounds,
  getComparisonPreviewPageDownloadName,
  getComparisonSlug,
  parseComparisonReportOptions,
} = require("../../utils/comparisonReportExport");
const {
  buildComparisonMonthlyCsvForJobs,
  buildComparisonYearlyCsvForJobs,
  streamComparisonReportZip,
} = require("../../utils/comparisonReportDownload");
const { parsePreviewPageQuery } = require("../../utils/customReportDownload");

const router = express.Router();
const { report_queue_collection, connectToDatabase } = constants;

const getJob = async (key) => {
  const db = await connectToDatabase();
  const collection = db.collection(report_queue_collection);
  return collection.findOne({ key });
};

const parsePreviewYear = (job, yearParam) => {
  const parsed = Number(yearParam);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  if (job.end_year != null) {
    return Number(job.end_year);
  }
  if (job.start_year != null) {
    return Number(job.start_year);
  }
  throw new Error("Preview year is required");
};

const loadComparisonJobs = async (primaryKey, comparisonKey) => {
  if (!primaryKey || !comparisonKey) {
    throw new Error("Primary and comparison job keys are required");
  }
  if (primaryKey === comparisonKey) {
    throw new Error("Select a different job for comparison");
  }

  const primaryJob = await getJob(primaryKey);
  if (!primaryJob) {
    throw new Error("Primary job not found");
  }

  const comparisonJob = await getJob(comparisonKey);
  if (!comparisonJob) {
    throw new Error("Comparison job not found");
  }

  return { primaryJob, comparisonJob };
};

const buildPreviewOptions = (primaryJob, query) => {
  const previewKind = query.previewKind || "year";
  const previewOptions = {
    ...parseComparisonReportOptions(query),
    previewKind,
  };

  if (previewKind === "year") {
    previewOptions.year = parsePreviewYear(primaryJob, query.year);
  }

  return previewOptions;
};

router.get("/preview", async (req, res) => {
  try {
    const { primaryJob, comparisonJob } = await loadComparisonJobs(req.query.key, req.query.comparisonKey);
    const forceRefresh = req.query.refresh === "true";
    const previewOptions = buildPreviewOptions(primaryJob, req.query);
    const previewPath = await generateComparisonPreview(primaryJob, comparisonJob, previewOptions);

    if (!fs.existsSync(previewPath)) {
      return res.status(500).send("Preview image was not generated");
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Cache-Control",
      forceRefresh ? "no-store, no-cache, must-revalidate" : "private, max-age=60",
    );
    fs.createReadStream(previewPath).pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message || "Internal Server Error");
  }
});

router.get("/bounds", async (req, res) => {
  try {
    const { primaryJob, comparisonJob } = await loadComparisonJobs(req.query.key, req.query.comparisonKey);
    const year = parsePreviewYear(primaryJob, req.query.year);
    const bounds = await getComparisonScaleBounds(primaryJob, comparisonJob, {
      year,
      etUnits: req.query.etUnits,
      pptUnits: req.query.pptUnits,
    });

    res.json(bounds);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message || "Internal Server Error");
  }
});

router.get("/download", async (req, res) => {
  try {
    const { primaryJob, comparisonJob } = await loadComparisonJobs(req.query.key, req.query.comparisonKey);
    const reportPath = await generateComparisonReport(primaryJob, comparisonJob, parseComparisonReportOptions(req.query));

    if (!fs.existsSync(reportPath)) {
      return res.status(500).send("Report was not generated");
    }

    const slug = getComparisonSlug(primaryJob.name, comparisonJob.name);
    const downloadName = `${slug}_comparison_report.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    fs.createReadStream(reportPath).pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message || "Internal Server Error");
  }
});

router.get("/download/page", async (req, res) => {
  try {
    const { primaryJob, comparisonJob } = await loadComparisonJobs(req.query.key, req.query.comparisonKey);
    const previewPage = String(req.query.previewPage || "");
    const { previewKind, year } = parsePreviewPageQuery(previewPage);
    const previewOptions = {
      ...parseComparisonReportOptions(req.query),
      previewKind,
      forceRefresh: true,
    };
    if (previewKind === "year") {
      previewOptions.year = Number.isFinite(year) ? year : parsePreviewYear(primaryJob, String(year));
    }

    const previewPath = await generateComparisonPreview(primaryJob, comparisonJob, previewOptions);
    if (!fs.existsSync(previewPath)) {
      return res.status(500).send("Preview image was not generated");
    }

    const downloadName = getComparisonPreviewPageDownloadName(primaryJob.name, comparisonJob.name, previewPage);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    fs.createReadStream(previewPath).pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message || "Internal Server Error");
  }
});

router.get("/download/csv", async (req, res) => {
  try {
    const { primaryJob, comparisonJob } = await loadComparisonJobs(req.query.key, req.query.comparisonKey);
    const options = parseComparisonReportOptions(req.query);
    const csv =
      req.query.csvKind === "yearly"
        ? buildComparisonYearlyCsvForJobs(primaryJob, comparisonJob, options)
        : buildComparisonMonthlyCsvForJobs(primaryJob, comparisonJob, options);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${csv.filename}"`);
    res.send(csv.content);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message || "Internal Server Error");
  }
});

router.get("/download/zip", async (req, res) => {
  try {
    const { primaryJob, comparisonJob } = await loadComparisonJobs(req.query.key, req.query.comparisonKey);
    await streamComparisonReportZip(primaryJob, comparisonJob, parseComparisonReportOptions(req.query), res);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message || "Internal Server Error");
  }
});

module.exports = router;
