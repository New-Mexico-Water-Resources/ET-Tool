const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");

const spawn_child = require("./spawn_child");

const constants = require("../../constants");

const project_directory = constants.project_directory;
const run_directory_base = constants.run_directory_base;

const argv = process.argv.slice(2);
const data_source = argv[0];

router.post("/start_run", async (req, res) => {
  let canSubmitJob = req.auth?.payload?.permissions?.includes("submit:jobs") || false;
  if (!canSubmitJob) {
    res.status(401).send("Unauthorized: missing submit:jobs permission");
    return;
  }

  let userInfoEndpoint = req.auth?.payload?.aud?.find((aud) => aud.endsWith("/userinfo"));
  if (!userInfoEndpoint) {
    res.status(401).send("Unauthorized: missing userinfo endpoint");
    return;
  }

  let userInfo = await fetch(userInfoEndpoint, {
    headers: {
      Authorization: req.headers.authorization,
    },
  }).then((res) => res.json());

  let name = req.body.name;
  let start_year = req.body.startYear;
  let end_year = req.body.endYear;
  let geojson = req.body.geojson;
  let epoch = Date.now(); //used to make sure run is unique
  let key = name + "_" + start_year + "_" + end_year + "_" + epoch;

  console.log("receiving start run request");
  console.log(`name: ${name}`);
  console.log(`key: ${key}`);
  console.log(`start year: ${start_year}`);
  console.log(`end year: ${end_year}`);
  console.log("GeoJSON:");
  console.log(geojson);
  var run_directory = path.join(run_directory_base, key);
  console.log(`creating run directory ${run_directory}`);
  fs.mkdirSync(run_directory, { recursive: true });
  geojson_filename = path.join(run_directory, `${name}.geojson`);
  console.log(`writing GeoJSON to ${geojson_filename}`);

  geojson_text = JSON.stringify(geojson);

  if (geojson_text.startsWith('"') && geojson_text.endsWith('"')) {
    geojson_text = geojson_text.slice(1, -1);
  }

  geojson_text = geojson_text.replace(/\\"/g, '"');

  fs.writeFile(geojson_filename, geojson_text, "utf8", function (err) {
    if (err) throw err;
    console.log(`successfully wrote GeoJSON to ${geojson_filename}`);
  });

  var start_year_filename = path.join(run_directory, "start_year.txt");
  console.log(`writing start year to ${start_year_filename}`);

  fs.writeFile(start_year_filename, `${start_year}`, "utf8", function (err) {
    if (err) throw err;
    console.log(`successfully wrote start year to ${start_year_filename}`);
  });

  var end_year_filename = path.join(run_directory, "end_year.txt");
  console.log(`writing end year to ${end_year_filename}`);

  fs.writeFile(end_year_filename, `${end_year}`, "utf8", function (err) {
    if (err) throw err;
    console.log(`successfully wrote end year to ${end_year_filename}`);
  });

  var status = "run created";
  var status_filename = path.join(run_directory, "status.txt");
  console.log(`writing status to ${status_filename}`);

  fs.writeFile(status_filename, status, "utf8", function (err) {
    if (err) throw err;
    console.log(`successfully wrote status to ${status_filename}`);
  });

  var config_filename = path.join(run_directory, "config.json");

  var config = {
    key: key,
    name: name,
    start_year: start_year,
    end_year: end_year,
    working_directory: run_directory,
    geojson_filename: geojson_filename,
    status_filename: status_filename,
  };

  fs.writeFile(config_filename, JSON.stringify(config, null, 2), function (err) {
    if (err) {
      console.log(err);
    } else {
      console.log("JSON saved to " + config_filename);
    }
  });

  var pipeline_script;

  if (data_source == "demo") {
    pipeline_script = path.join(project_directory, "water-rights-visualizer-backend-demo.py");
  } else if (data_source == "S3") {
    pipeline_script = path.join(project_directory, "water-rights-visualizer-backend-S3.py");
  } else if (data_source == "google") {
    pipeline_script = path.join(project_directory, "water-rights-visualizer-backend-google.py");
  }

  console.log(`pipeline script: ${pipeline_script}`);
  var command = `/opt/conda/bin/python ${pipeline_script} ${config_filename}`;
  console.log(command);

  let canWriteJob = req.auth?.payload?.permissions?.includes("write:jobs") || false;

  var entry = {
    key: key,
    name: name,
    cmd: command,
    status: canWriteJob ? "Pending" : "WaitingApproval",
    status_msg: null,
    submitted: epoch,
    started: null,
    ended: null,
    pid: null,
    invoker: "to-do",
    base_dir: run_directory,
    png_dir: run_directory + "/output/figures/" + name,
    csv_dir: run_directory + "/output/monthly_nan/" + name,
    subset_dir: run_directory + "/output/subset/" + name,
    geo_json: run_directory + "/" + name + ".geojson",
    start_year: parseInt(start_year),
    end_year: parseInt(end_year),
    user: userInfo,
  };

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  await collection.insertOne(entry);

  console.log("Writing entry to mongodb");
  console.log(entry);

  res.status(200).send(`Queued report for ${name} from ${start_year} to ${end_year}`);
});

module.exports = router;
