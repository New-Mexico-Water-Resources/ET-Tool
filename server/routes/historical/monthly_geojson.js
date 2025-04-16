const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const constants = require("../../constants");
const archiver = require("archiver");

const runDirectoryBase = constants.run_directory_base;

/**
 * GET /api/historical/monthly
 * Returns a geotiff file for a specific job, month, year, and variable
 * Query parameters:
 *   - key: Job ID
 *   - month: Month (1-12)
 *   - year: Year
 *   - variable: Variable type (ET, ET_MIN, ET_MAX, PET, or COUNT)
 */
router.get("/monthly", async (req, res) => {
  const { key, month, year, variable } = req.query;

  // Validate required parameters
  if (!key || !month || !year || !variable) {
    return res.status(400).json({ error: "Missing required parameters: key, month, year, and variable are required" });
  }

  // Validate month format (1-12)
  const monthNum = parseInt(month, 10);
  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return res.status(400).json({ error: "Month must be a number between 1 and 12" });
  }

  // Validate year format
  const yearNum = parseInt(year, 10);
  if (isNaN(yearNum)) {
    return res.status(400).json({ error: "Year must be a valid number" });
  }

  // Validate variable
  const validVariables = ["ET", "ET_MIN", "ET_MAX", "PET", "COUNT", "PPT"];
  const monthlyVariables = ["ET", "PET"];

  if (!validVariables.includes(variable)) {
    return res.status(400).json({ error: "Variable must be one of: ET, ET_MIN, ET_MAX, PET, COUNT, or PPT" });
  }

  try {
    // Make sure job exists
    const db = await constants.connectToDatabase();
    const collection = db.collection(constants.report_queue_collection);
    const job = await collection.findOne({ key });

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Construct the path to the geotiff file based on the example path structure
    const runDirectory = path.join(runDirectoryBase, key);
    const outputDir = path.join(runDirectory, "output");
    const subsetDir = path.join(outputDir, "subset");
    const monthlyDir = path.join(outputDir, "monthly");

    const monthlyJobDir = path.join(monthlyDir, job.name);
    const subsetJobDir = path.join(subsetDir, job.name);

    let geotiffFilename = "";
    let formattedDate = "";
    // ET and PET have additional corrections, which are applied in the monthly directory
    if (monthlyVariables.includes(variable)) {
      formattedDate = `${yearNum}_${monthNum.toString().padStart(2, "0")}`;
      geotiffFilename = path.join(monthlyJobDir, `${formattedDate}_${job.name}_${variable}_monthly_sum.tif`);
    } else {
      formattedDate = `${yearNum}.${monthNum.toString().padStart(2, "0")}.01`;
      geotiffFilename = path.join(subsetJobDir, `${formattedDate}_${job.name}_${variable}_subset.tif`);
    }

    // Check if the file exists
    if (!fs.existsSync(geotiffFilename)) {
      return res
        .status(404)
        .json({ error: `Geotiff file not found for month ${monthNum}, year ${yearNum}, and variable ${variable}` });
    }

    // Set appropriate headers for file download
    res.setHeader("Content-Type", "image/tiff");
    res.setHeader("Content-Disposition", `attachment; filename=${formattedDate}_${job.name}_${variable}_subset.tif`);

    // Stream the file to the response
    const fileStream = fs.createReadStream(geotiffFilename);
    fileStream.pipe(res);

    // Handle errors
    fileStream.on("error", (error) => {
      console.error(`Error streaming file: ${error.message}`);
      res.status(500).json({ error: "Error streaming file" });
    });
  } catch (error) {
    console.error(`Error processing request: ${error.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/historical/download
 * Returns a ZIP file containing all geotiff files for a specific job across all months, years, and variables
 * Query parameters:
 *   - key: Job ID
 */
router.get("/download", async (req, res) => {
  const { key } = req.query;

  // Validate required parameters
  if (!key) {
    return res.status(400).json({ error: "Missing required parameter: key (Job ID) is required" });
  }

  try {
    // Make sure job exists
    const db = await constants.connectToDatabase();
    const collection = db.collection(constants.report_queue_collection);
    const job = await collection.findOne({ key });

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const runDirectory = path.join(runDirectoryBase, key);
    const outputDir = path.join(runDirectory, "output");
    const subsetDir = path.join(outputDir, "subset");
    const monthlyDir = path.join(outputDir, "monthly");

    const monthlyJobDir = path.join(monthlyDir, job.name);
    const subsetJobDir = path.join(subsetDir, job.name);

    // Check if directories exist
    if (!fs.existsSync(monthlyJobDir) && !fs.existsSync(subsetJobDir)) {
      return res.status(404).json({ error: "No geotiff files found for this job" });
    }

    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${job.name}_all_geotiffs.zip`);

    archive.pipe(res);

    const addFilesFromDirectory = (directory, file_postfix, variables) => {
      if (fs.existsSync(directory)) {
        const files = fs.readdirSync(directory);
        for (const file of files) {
          let fileVariable = "";
          variables.forEach((variable) => {
            if (file.endsWith(`${variable}_${file_postfix}.tif`)) {
              fileVariable = variable;
            }
          });

          if (fileVariable) {
            const filePath = path.join(directory, file);
            archive.file(filePath, { name: `${fileVariable}/${file}` });
          }
        }
      }
    };

    addFilesFromDirectory(monthlyJobDir, "monthly_sum", ["ET", "PET"]);
    addFilesFromDirectory(subsetJobDir, "subset", ["ET_MIN", "ET_MAX", "PPT"]);

    await archive.finalize();

    archive.on("error", (error) => {
      console.error(`Error creating ZIP archive: ${error.message}`);
      res.status(500).json({ error: "Error creating ZIP archive" });
    });

    res.on("finish", () => {
      console.log("ZIP archive created successfully, size:", archive.pointer());
    });
  } catch (error) {
    console.error(`Error processing request: ${error.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
