const express = require("express");
const archiver = require("archiver");
const path = require("path");
const fs = require("fs");
const constants = require("../constants");
const { area: turfArea } = require("@turf/turf");
const { listJobGeotiffs } = require("../utils/geotiffExport");
const { shouldIncludeYearlyCombined } = require("../utils/defaultDownloadOptions");
const {
  processFigureFiles,
  processReportFiles,
  processMonthlyNanFiles,
  processLandsatPassCounts,
  appendJobCsvsToArchive,
} = require("../utils/reportArchive");

const router = express.Router();
const { run_directory_base, report_queue_collection, connectToDatabase } = constants;
const BULK_DOWNLOAD_TYPES = new Set(["report", "geojson", "geotiff"]);

const getJob = async (key) => {
  const db = await connectToDatabase();
  const collection = db.collection(report_queue_collection);
  return collection.findOne({ key });
};

const parseJobKeys = (keysParam) =>
  String(keysParam || "")
    .split(",")
    .map((key) => decodeURIComponent(key.trim()))
    .filter(Boolean);

const loadJobsByKeys = async (keysParam) => {
  const keys = parseJobKeys(keysParam);
  const jobs = [];
  for (const key of keys) {
    const job = await getJob(key);
    if (job) {
      jobs.push(job);
    }
  }
  return jobs;
};

const addJobOutputsToArchive = async (archive, job, units, pathPrefix = "") => {
  const key = job.key;
  const jobName = job.name;
  const includeYearlyCombined = shouldIncludeYearlyCombined(units);

  const geojsonPath = path.join(run_directory_base, key, `${jobName}.geojson`);
  if (!fs.existsSync(geojsonPath)) {
    throw new Error(`GeoJSON not found for job ${jobName}`);
  }

  const prefix = pathPrefix ? `${pathPrefix}/` : "";
  archive.file(geojsonPath, { name: `${prefix}${jobName}.geojson` });

  const geojson = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
  const area = turfArea(geojson) / 4046.86;

  const figureDirectory = path.join(run_directory_base, key, "output", "figures", jobName);
  if (!fs.existsSync(figureDirectory)) {
    throw new Error(`Figure directory ${figureDirectory} does not exist`);
  }

  processFigureFiles(archive, figureDirectory, units, pathPrefix, includeYearlyCombined);
  processReportFiles(archive, figureDirectory, units, pathPrefix);

  const nanValues = processMonthlyNanFiles(run_directory_base, key, jobName);
  const landsatPassCounts = processLandsatPassCounts(run_directory_base, key, jobName);
  await appendJobCsvsToArchive(archive, run_directory_base, key, jobName, nanValues, landsatPassCounts, units, area, pathPrefix);
};

const addJobGeojsonToArchive = (archive, job) => {
  const geojsonPath = path.join(run_directory_base, job.key, `${job.name}.geojson`);
  if (!fs.existsSync(geojsonPath)) {
    throw new Error(`GeoJSON not found for job ${job.name}`);
  }

  archive.file(geojsonPath, { name: `${job.name}.geojson` });
};

const addJobGeotiffsToArchive = (archive, job) => {
  const files = listJobGeotiffs(run_directory_base, job);
  if (!files.length) {
    throw new Error(`No geotiff files found for job ${job.name}`);
  }

  files.forEach(({ filePath, archiveName }) => {
    archive.file(filePath, { name: `${job.name}/${archiveName}` });
  });
};

const addJobBulkOutputsToArchive = async (archive, job, type, units) => {
  if (type === "report") {
    await addJobOutputsToArchive(archive, job, units, job.name);
  } else if (type === "geojson") {
    addJobGeojsonToArchive(archive, job);
  } else if (type === "geotiff") {
    addJobGeotiffsToArchive(archive, job);
  } else {
    throw new Error(`Invalid download type: ${type}`);
  }
};

const sanitizeDownloadName = (name, fallback = "selected-jobs") =>
  String(name || fallback).replace(/[^a-zA-Z0-9_+. -]/g, "") || fallback;

const createZipArchive = (res, filename) => {
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("end", () => console.log("Archive wrote %d bytes", archive.pointer()));
  archive.on("warning", (err) => {
    if (err.code === "ENOENT") {
      console.warn(err);
    } else {
      throw err;
    }
  });
  archive.on("error", (err) => {
    throw err;
  });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
  archive.pipe(res);
  return archive;
};

router.get("/download", async (req, res) => {
  try {
    const key = req.query.key;
    const units = req.query.units;

    const job = await getJob(key);
    if (!job) {
      return res.status(404).send("Job not found");
    }

    const archive = createZipArchive(res, `${job.name}.zip`);
    await addJobOutputsToArchive(archive, job, units);
    await archive.finalize();
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

router.get("/download/group", async (req, res) => {
  try {
    const keys = req.query.keys;
    const units = req.query.units || "metric";
    const groupName = sanitizeDownloadName(req.query.name, "job-group");

    const jobs = await loadJobsByKeys(keys);
    if (!jobs.length) {
      return res.status(404).send("No jobs found");
    }

    const archive = createZipArchive(res, `${groupName}.zip`);
    let addedJobs = 0;

    for (const job of jobs) {
      try {
        await addJobOutputsToArchive(archive, job, units, job.name);
        addedJobs += 1;
      } catch (error) {
        console.warn(`Skipping job ${job.key} in group download:`, error.message);
      }
    }

    if (!addedJobs) {
      return res.status(404).send("No downloadable outputs found for this group");
    }

    await archive.finalize();
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

router.get("/download/bulk", async (req, res) => {
  try {
    const type = String(req.query.type || "").trim();
    const units = req.query.units || "metric";
    const downloadName = sanitizeDownloadName(req.query.name, "selected-jobs");

    if (!BULK_DOWNLOAD_TYPES.has(type)) {
      return res.status(400).send("Invalid download type");
    }

    const jobs = await loadJobsByKeys(req.query.keys);
    if (!jobs.length) {
      return res.status(404).send("No jobs found");
    }

    const archive = createZipArchive(res, `${downloadName}.zip`);
    let addedJobs = 0;

    for (const job of jobs) {
      try {
        await addJobBulkOutputsToArchive(archive, job, type, units);
        addedJobs += 1;
      } catch (error) {
        console.warn(`Skipping job ${job.key} in bulk ${type} download:`, error.message);
      }
    }

    if (!addedJobs) {
      return res.status(404).send("No downloadable outputs found for the selected jobs");
    }

    await archive.finalize();
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
