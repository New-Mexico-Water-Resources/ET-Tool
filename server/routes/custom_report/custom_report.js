const express = require("express");
const fs = require("fs");
const constants = require("../../constants");
const {
  generateCustomPreview,
  generateCustomReport,
  getEtScaleBounds,
  parseCustomReportOptions,
} = require("../../utils/customReportExport");
const {
  buildYearlyCombinedCsvForJob,
  buildMonthlyCombinedCsvForJob,
  getPreviewPageDownloadName,
  parsePreviewPageQuery,
  streamCustomReportZip,
} = require("../../utils/customReportDownload");

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

const buildPreviewOptions = (job, query) => {
  const previewKind = query.previewKind || "year";
  const previewOptions = {
    ...parseCustomReportOptions(query),
    previewKind,
  };

  if (previewKind === "year") {
    previewOptions.year = parsePreviewYear(job, query.year);
  } else if (previewKind === "documentation") {
    previewOptions.previewPage = Number(query.previewPage) || 1;
  }

  return previewOptions;
};

router.get("/preview", async (req, res) => {
  try {
    const key = req.query.key;
    const job = await getJob(key);
    if (!job) {
      return res.status(404).send("Job not found");
    }

    const forceRefresh = req.query.refresh === "true";
    const previewOptions = buildPreviewOptions(job, req.query);
    const previewPath = await generateCustomPreview(job, previewOptions);

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
    const key = req.query.key;
    const job = await getJob(key);
    if (!job) {
      return res.status(404).send("Job not found");
    }

    const year = parsePreviewYear(job, req.query.year);
    const bounds = await getEtScaleBounds(job, {
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
    const key = req.query.key;
    const job = await getJob(key);
    if (!job) {
      return res.status(404).send("Job not found");
    }

    const reportPath = await generateCustomReport(job, parseCustomReportOptions(req.query));

    if (!fs.existsSync(reportPath)) {
      return res.status(500).send("Report was not generated");
    }

    const downloadName = `${job.name}_custom_report.pdf`;
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
    const key = req.query.key;
    const job = await getJob(key);
    if (!job) {
      return res.status(404).send("Job not found");
    }

    const previewPage = String(req.query.previewPage || "");
    const { previewKind, year, previewPage: docPage } = parsePreviewPageQuery(previewPage);
    const previewOptions = {
      ...parseCustomReportOptions(req.query),
      previewKind,
      forceRefresh: true,
    };
    if (previewKind === "year") {
      previewOptions.year = Number.isFinite(year) ? year : parsePreviewYear(job, String(year));
    } else if (previewKind === "documentation") {
      previewOptions.previewPage = docPage;
    }

    const previewPath = await generateCustomPreview(job, previewOptions);
    if (!fs.existsSync(previewPath)) {
      return res.status(500).send("Preview image was not generated");
    }

    const downloadName = getPreviewPageDownloadName(job.name, previewPage);
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
    const key = req.query.key;
    const job = await getJob(key);
    if (!job) {
      return res.status(404).send("Job not found");
    }

    const options = parseCustomReportOptions(req.query);
    const csv =
      req.query.csvKind === "yearly"
        ? buildYearlyCombinedCsvForJob(job, options)
        : buildMonthlyCombinedCsvForJob(job, options);
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
    const key = req.query.key;
    const job = await getJob(key);
    if (!job) {
      return res.status(404).send("Job not found");
    }

    await streamCustomReportZip(job, parseCustomReportOptions(req.query), res);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message || "Internal Server Error");
  }
});

module.exports = router;
