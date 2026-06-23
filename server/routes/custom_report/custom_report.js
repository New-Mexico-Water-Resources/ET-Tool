const express = require("express");
const fs = require("fs");
const constants = require("../../constants");
const { generateCustomPreview, generateCustomReport, getEtScaleBounds } = require("../../utils/customReportExport");

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

router.get("/preview", async (req, res) => {
  try {
    const key = req.query.key;
    const job = await getJob(key);
    if (!job) {
      return res.status(404).send("Job not found");
    }

    const previewKind = req.query.previewKind || "year";
    const previewOptions = {
      previewKind,
      etUnits: req.query.etUnits,
      pptUnits: req.query.pptUnits,
      colorScale: req.query.colorScale,
      etCustomMin: req.query.etCustomMin,
      etCustomMax: req.query.etCustomMax,
      showMonthlyAverages: req.query.showMonthlyAverages,
    };

    if (previewKind === "year") {
      previewOptions.year = parsePreviewYear(job, req.query.year);
    } else if (previewKind === "documentation") {
      previewOptions.previewPage = Number(req.query.previewPage) || 1;
    }

    const previewPath = await generateCustomPreview(job, previewOptions);

    if (!fs.existsSync(previewPath)) {
      return res.status(500).send("Preview image was not generated");
    }

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
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

    const reportPath = await generateCustomReport(job, {
      etUnits: req.query.etUnits,
      pptUnits: req.query.pptUnits,
      colorScale: req.query.colorScale,
      etCustomMin: req.query.etCustomMin,
      etCustomMax: req.query.etCustomMax,
      showMonthlyAverages: req.query.showMonthlyAverages,
    });

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

module.exports = router;
