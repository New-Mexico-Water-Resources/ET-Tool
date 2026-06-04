const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const constants = require("../../constants");
const archiver = require("archiver");
const {
  ALL_VARIABLES,
  parseExportOptions,
  needsExport,
  getGeotiffPath,
  listJobGeotiffs,
  loadJobGeojson,
  exportGeotiff,
  exportGeotiffFromFile,
  isCalculatedVariable,
  geotiffExists,
  getVariableSources,
} = require("../../utils/geotiffExport");

const runDirectoryBase = constants.run_directory_base;

const findJob = async (key) => {
  const db = await constants.connectToDatabase();
  const collection = db.collection(constants.report_queue_collection);
  return collection.findOne({ key });
};

const addGeotiffFilesToArchive = (archive, directory, filePostfix, variables) => {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const file of fs.readdirSync(directory)) {
    const variable = variables.find((name) => file.endsWith(`${name}_${filePostfix}.tif`));
    if (variable) {
      archive.file(path.join(directory, file), { name: `${variable}/${file}` });
    }
  }
};

router.get("/monthly", async (req, res) => {
  const { key, month, year, variable } = req.query;
  const exportOptions = parseExportOptions(req.query);

  if (!key || !month || !year || !variable) {
    return res.status(400).json({ error: "Missing required parameters: key, month, year, and variable are required" });
  }

  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);

  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return res.status(400).json({ error: "Month must be a number between 1 and 12" });
  }

  if (isNaN(yearNum)) {
    return res.status(400).json({ error: "Year must be a valid number" });
  }

  if (!ALL_VARIABLES.includes(variable)) {
    return res.status(400).json({ error: `Variable must be one of: ${ALL_VARIABLES.join(", ")}` });
  }

  try {
    const job = await findJob(key);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (isCalculatedVariable(variable)) {
      if (!getVariableSources(variable).every((v) => geotiffExists(runDirectoryBase, job, monthNum, yearNum, v))) {
        return res
          .status(404)
          .json({ error: `Geotiff file not found for month ${monthNum}, year ${yearNum}, and variable ${variable}` });
      }
    } else {
      const geotiffPath = getGeotiffPath(runDirectoryBase, job, monthNum, yearNum, variable);
      if (!fs.existsSync(geotiffPath)) {
        return res
          .status(404)
          .json({ error: `Geotiff file not found for month ${monthNum}, year ${yearNum}, and variable ${variable}` });
      }
    }

    const basename = `${yearNum}_${String(monthNum).padStart(2, "0")}_${job.name}_${variable}.tif`;

    if (needsExport({ variable, ...exportOptions })) {
      let geojson = null;
      if (exportOptions.clip) {
        geojson = loadJobGeojson(runDirectoryBase, job);
        if (!geojson) {
          return res.status(404).json({ error: "GeoJSON not found for this job" });
        }
      }

      const buffer = await exportGeotiff({
        runDirectoryBase,
        job,
        month: monthNum,
        year: yearNum,
        variable,
        geojson,
        ...exportOptions,
      });

      res.setHeader("Content-Type", "image/tiff");
      res.setHeader("Content-Disposition", `attachment; filename=${basename}`);
      return res.send(buffer);
    }

    res.setHeader("Content-Type", "image/tiff");
    res.setHeader("Content-Disposition", `attachment; filename=${basename}`);
    const geotiffPath = getGeotiffPath(runDirectoryBase, job, monthNum, yearNum, variable);
    fs.createReadStream(geotiffPath).pipe(res).on("error", (error) => {
      console.error(`Error streaming file: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error streaming file" });
      }
    });
  } catch (error) {
    console.error(`Error processing request: ${error.message}`);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

router.get("/download", async (req, res) => {
  const { key } = req.query;
  const clipped = req.query.clipped === "true";

  if (!key) {
    return res.status(400).json({ error: "Missing required parameter: key (Job ID) is required" });
  }

  try {
    const job = await findJob(key);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const files = listJobGeotiffs(runDirectoryBase, job);
    if (files.length === 0) {
      return res.status(404).json({ error: "No geotiff files found for this job" });
    }

    let geojson = null;
    if (clipped) {
      geojson = loadJobGeojson(runDirectoryBase, job);
      if (!geojson) {
        return res.status(404).json({ error: "GeoJSON not found for this job" });
      }
    }

    const zipName = clipped ? `${job.name}_all_geotiffs_clipped.zip` : `${job.name}_all_geotiffs.zip`;
    const archive = archiver("zip", { zlib: { level: clipped ? 1 : 9 } });

    archive.on("error", (error) => {
      console.error(`Error creating ZIP archive: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error creating ZIP archive" });
      } else if (!res.writableEnded) {
        res.end();
      }
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${zipName}`);
    archive.pipe(res);

    if (clipped) {
      for (const { filePath, archiveName } of files) {
        const buffer = await exportGeotiffFromFile(filePath, geojson);
        archive.append(buffer, { name: archiveName });
      }
    } else {
      const runDirectory = path.join(runDirectoryBase, key);
      const monthlyJobDir = path.join(runDirectory, "output", "monthly", job.name);
      const subsetJobDir = path.join(runDirectory, "output", "subset", job.name);

      addGeotiffFilesToArchive(archive, monthlyJobDir, "monthly_sum", ["ET", "PET"]);
      addGeotiffFilesToArchive(archive, subsetJobDir, "subset", ["ET_MIN", "ET_MAX", "PPT"]);
    }

    await archive.finalize();
  } catch (error) {
    console.error(`Error processing request: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Internal server error" });
    } else if (!res.writableEnded) {
      res.end();
    }
  }
});

module.exports = router;
