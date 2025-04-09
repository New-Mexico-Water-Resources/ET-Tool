const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const constants = require("../../constants");

const run_directory_base = constants.run_directory_base;

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
