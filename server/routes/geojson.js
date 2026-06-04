const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const constants = require("../constants");

const run_directory_base = constants.run_directory_base;
const project_directory = constants.project_directory;

router.get("/geojson", async (req, res) => {
  let key = req.query.key;

  // Make sure job exists
  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);

  let job = await collection.findOne({ key });
  if (!job) {
    res.status(404).send("Job not found");
    return;
  }

  let jobName = job.name;

  let run_directory = path.join(run_directory_base, key);
  let geojson_filename = path.join(run_directory, `${jobName}.geojson`);
  let geojson = fs.readFileSync(geojson_filename, "utf8");
  res.status(200).send(geojson);
});

router.get("/ard_tiles", (req, res) => {
  const ard_tiles_filename = path.join(project_directory, "water_rights_visualizer", "ARD_tiles.geojson");

  try {
    if (!fs.existsSync(ard_tiles_filename)) {
      console.error("ARD tiles file not found:", ard_tiles_filename);
      res.status(404).send("ARD tiles file not found");
      return;
    }

    const ard_tiles = fs.readFileSync(ard_tiles_filename, "utf8");
    res.status(200).send(ard_tiles);
  } catch (err) {
    console.error("Error reading ARD tiles:", err);
    res.status(500).send("Error reading ARD tiles");
  }
});

module.exports = router;
