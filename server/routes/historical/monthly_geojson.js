const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const constants = require("../../constants");

const run_directory_base = constants.run_directory_base;

/**
 * GET /api/historical/available_dates
 * Returns all available dates for a specific job and variable
 * Query parameters:
 *   - key: Job ID
 *   - variable: Variable type (ET, ET_MIN, ET_MAX, PET, or COUNT)
 */
router.get("/available_dates", async (req, res) => {
  const { key, variable } = req.query;

  // Validate required parameters
  if (!key || !variable) {
    return res.status(400).json({ error: "Missing required parameters: key and variable are required" });
  }

  // Validate variable
  const validVariables = ["ET", "ET_MIN", "ET_MAX", "PET", "COUNT"];
  if (!validVariables.includes(variable)) {
    return res.status(400).json({ error: "Variable must be one of: ET, ET_MIN, ET_MAX, PET, or COUNT" });
  }

  try {
    // Make sure job exists
    const db = await constants.connectToDatabase();
    const collection = db.collection(constants.report_queue_collection);
    const job = await collection.findOne({ key });

    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    // Construct the path to the directory containing the geotiff files
    const run_directory = path.join(run_directory_base, key);
    const output_dir = path.join(run_directory, "output");
    const subset_dir = path.join(output_dir, "subset");
    const job_name_dir = path.join(subset_dir, job.name);

    // Check if the directory exists
    if (!fs.existsSync(job_name_dir)) {
      return res.status(404).json({ error: "No data directory found for this job" });
    }

    // Get all files in the directory
    const files = fs.readdirSync(job_name_dir);

    // Filter files that match the variable pattern and extract dates
    const datePattern = new RegExp(`(\\d{4}\\.\\d{2}\\.\\d{2})_.+_${variable}_subset\\.tif`);
    const availableDates = [];

    files.forEach((file) => {
      const match = file.match(datePattern);
      if (match) {
        const dateStr = match[1]; // Format: YYYY.MM.DD
        const [year, month, day] = dateStr.split(".");
        availableDates.push({
          year: parseInt(year),
          month: parseInt(month),
          day: parseInt(day),
          date: dateStr,
        });
      }
    });

    // Sort dates chronologically
    availableDates.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if (a.month !== b.month) return a.month - b.month;
      return a.day - b.day;
    });

    res.json({ availableDates });
  } catch (error) {
    console.error(`Error processing request: ${error.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/historical/monthly_geojson
 * Returns a geotiff file for a specific job, month, year, and variable
 * Query parameters:
 *   - key: Job ID
 *   - month: Month (1-12)
 *   - year: Year
 *   - variable: Variable type (ET, ET_MIN, ET_MAX, PET, or COUNT)
 */
router.get("/monthly_geojson", async (req, res) => {
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
  const validVariables = ["ET", "ET_MIN", "ET_MAX", "PET", "COUNT"];
  if (!validVariables.includes(variable)) {
    return res.status(400).json({ error: "Variable must be one of: ET, ET_MIN, ET_MAX, PET, or COUNT" });
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
    const run_directory = path.join(run_directory_base, key);
    const output_dir = path.join(run_directory, "output");
    const subset_dir = path.join(output_dir, "subset");
    const job_name_dir = path.join(subset_dir, job.name);

    // Format the date as YYYY.MM.DD (using the first day of the month)
    const formattedDate = `${yearNum}.${monthNum.toString().padStart(2, "0")}.01`;

    // Construct the full filename
    const geotiff_filename = path.join(job_name_dir, `${formattedDate}_${job.name}_${variable}_subset.tif`);

    // Check if the file exists
    if (!fs.existsSync(geotiff_filename)) {
      return res
        .status(404)
        .json({ error: `Geotiff file not found for month ${monthNum}, year ${yearNum}, and variable ${variable}` });
    }

    // Set appropriate headers for file download
    res.setHeader("Content-Type", "image/tiff");
    res.setHeader("Content-Disposition", `attachment; filename=${formattedDate}_${job.name}_${variable}_subset.tif`);

    // Stream the file to the response
    const fileStream = fs.createReadStream(geotiff_filename);
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

module.exports = router;
