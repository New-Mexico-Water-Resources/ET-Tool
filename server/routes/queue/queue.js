const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const constants = require("../../constants");

router.get("/list", async (req, res) => {
  let canReadJobs = req.auth?.payload?.permissions?.includes("read:jobs") || false;
  if (!canReadJobs) {
    res.status(401).send("Unauthorized: missing read:jobs permission");
    return;
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let result = await collection.find({}).toArray();
  res.status(200).send(result);
});

router.get("/search_geojsons", async (req, res) => {
  let canReadJobs = req.auth?.payload?.permissions?.includes("read:jobs") || false;
  if (!canReadJobs) {
    res.status(401).send("Unauthorized: missing read:jobs permission");
    return;
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let result = await collection.find({}).toArray();
  result.forEach((job, i) => {
    let geojson = fs.readFileSync(job.geo_json, "utf8");
    result[i].geojson = JSON.parse(geojson);
  });

  res.status(200).send(result);
});

router.delete("/delete_job", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;

  let key = req.query.key;
  let deleteFiles = req.query.deleteFiles;

  if (!key) {
    res.status(400).send("Missing key");
    return;
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let job = await collection.findOne({ key });

  if (!job) {
    res.status(404).send("Job not found");
    return;
  }

  let userOwnsJob = req.auth?.payload?.sub === job?.user?.sub;
  if (!canWriteJobs && !userOwnsJob) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let result = null;
  if (!["Complete", "Failed"].includes(job.status) && job?.pid) {
    // Update status to "Killed" and let the cron handle it
    result = await collection.updateOne({ key }, { $set: { status: "Killed" } });
  } else if (["Complete", "Failed", "Pending", "WaitingApproval", "Paused"].includes(job.status)) {
    result = await collection.deleteOne({ key });
  }

  if (deleteFiles && job.base_dir) {
    if (fs.existsSync(job.base_dir)) {
      fs.rmdir(job.base_dir, { recursive: true }, (err) => {
        if (err) {
          console.error(`Error deleting ${job.base_dir}`, err);
        }
      });
    }
  }

  res.status(200).send(result);
});

router.delete("/bulk_delete_jobs", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  if (!canWriteJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let keys = req.body.keys;
  let deleteFiles = req.query.deleteFiles;

  if (!keys) {
    res.status(400).send("Missing keys");
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let deleted = await collection.deleteMany({ key: { $in: keys } });

  let jobs = await collection.find({ key: { $in: keys } }).toArray();
  jobs.forEach((job) => {
    if (!["Complete", "Failed"].includes(job.status) && job.pid) {
      try {
        process.kill(job.pid, "SIGKILL");
      } catch (e) {
        console.error(`Error killing process ${job.pid}`, e);
      }
    }

    if (deleteFiles && job.base_dir) {
      if (fs.existsSync(job.base_dir)) {
        fs.rmdir(job.base_dir, { recursive: true }, (err) => {
          if (err) {
            console.error(`Error deleting ${job.base_dir}`, err);
          }
        });
      }
    }
  });

  res.status(200).send(deleted);
});

router.post("/restart_job", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  if (!canWriteJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let key = req.body.key;

  // Change job status to "Pending" and let the cron handle it
  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let result = await collection.updateOne(
    { key },
    { $set: { status: "Pending", ended: null, pid: null, status_msg: "Pending" } }
  );

  // Delete everything in the job's output folder so we can regenerate the report
  let job = await collection.findOne({ key });
  if (job.png_dir) {
    if (fs.existsSync(job.png_dir)) {
      fs.rmdir(job.png_dir, { recursive: true }, (err) => {
        if (err) {
          console.error(`Error deleting ${job.png_dir}`, err);
        }

        // Make empty dir
        fs.mkdirSync(job.png_dir);
      });
    }
  }

  // Clear the status file
  let run_directory = path.join(constants.run_directory_base, key);
  let status_filename = path.join(run_directory, "status.txt");
  if (fs.existsSync(status_filename)) {
    fs.writeFileSync(status_filename, "Pending");
  }

  res.status(200).send(result);
});

router.post("/approve_job", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  if (!canWriteJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let key = req.body.key;

  if (!key) {
    res.status(400).send("Missing key");
    return;
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let job = await collection.findOne({ key });
  if (!job) {
    res.status(404).send("Job not found");
    return;
  }

  if (job.status !== "WaitingApproval") {
    res.status(400).send("Job is not waiting for approval");
    return;
  }

  let result = await collection.updateOne({ key }, { $set: { status: "Pending" } });

  res.status(200).send(result);
});

router.post("/bulk_approve_jobs", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  if (!canWriteJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let keys = req.body.keys;

  if (!keys) {
    res.status(400).send("Missing keys");
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let result = await collection.updateMany(
    { key: { $in: keys }, status: "WaitingApproval" },
    { $set: { status: "Pending" } }
  );

  res.status(200).send(result);
});

router.post("/pause_job", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  if (!canWriteJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let key = req.body.key;

  if (!key) {
    res.status(400).send("Missing key");
    return;
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let result = await collection.updateOne({ key }, { $set: { status: "Paused" } });

  res.status(200).send(result);
});

router.post("/bulk_pause_jobs", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  if (!canWriteJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let keys = req.body.keys;

  if (!keys) {
    res.status(400).send("Missing keys");
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let result = await collection.updateMany({ key: { $in: keys } }, { $set: { status: "Paused" } });

  res.status(200).send(result);
});

router.post("/resume_job", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  if (!canWriteJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let key = req.body.key;

  if (!key) {
    res.status(400).send("Missing key");
    return;
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let result = await collection.updateOne({ key }, { $set: { status: "Pending", paused_year: null } });

  res.status(200).send(result);
});

module.exports = router;
