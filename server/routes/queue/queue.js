const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const constants = require("../../constants");
const { sanitizeJobName, renameJobFilesystem, buildRenamedJobFields } = require("../../utils/renameJob");
const { regenerateDefaultReports } = require("../../utils/regenerateDefaultReports");

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

  let matchedJobs = [];
  result.forEach((job, i) => {
    if (job.geo_json) {
      try {
        let geojson = fs.readFileSync(job.geo_json, "utf8");
        result[i].geojson = JSON.parse(geojson);
        matchedJobs.push(job);
      } catch (e) {
        console.error(`Error parsing geojson for job ${job.key}`, e);
        result[i].geojson = {};
      }
    } else {
      result[i].geojson = {};
    }
  });

  res.status(200).send(matchedJobs);
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

router.post("/bulk_restart_jobs", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  if (!canWriteJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let keys = req.body.keys;
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    res.status(400).send("Missing keys");
    return;
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let modifiedCount = 0;

  for (const key of keys) {
    let result = await collection.updateOne(
      { key },
      { $set: { status: "Pending", ended: null, pid: null, status_msg: "Pending" } }
    );
    modifiedCount += result.modifiedCount;

    let job = await collection.findOne({ key });
    if (job?.png_dir && fs.existsSync(job.png_dir)) {
      fs.rmdir(job.png_dir, { recursive: true }, (err) => {
        if (err) {
          console.error(`Error deleting ${job.png_dir}`, err);
        }
        fs.mkdirSync(job.png_dir);
      });
    }

    let run_directory = path.join(constants.run_directory_base, key);
    let status_filename = path.join(run_directory, "status.txt");
    if (fs.existsSync(status_filename)) {
      fs.writeFileSync(status_filename, "Pending");
    }
  }

  res.status(200).send({ modifiedCount });
});

router.post("/bulk_resume_jobs", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  if (!canWriteJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let keys = req.body.keys;
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    res.status(400).send("Missing keys");
    return;
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  let result = await collection.updateMany(
    { key: { $in: keys } },
    { $set: { status: "Pending", paused_year: null } }
  );

  res.status(200).send(result);
});

router.post("/rename_job", async (req, res) => {
  const canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  const key = req.body.key;
  const newName = sanitizeJobName(req.body.name);

  if (!key) {
    res.status(400).send("Missing key");
    return;
  }

  if (!newName) {
    res.status(400).send("Missing or invalid job name");
    return;
  }

  const db = await constants.connectToDatabase();
  const collection = db.collection(constants.report_queue_collection);
  const job = await collection.findOne({ key });

  if (!job) {
    res.status(404).send("Job not found");
    return;
  }

  const userOwnsJob = req.auth?.payload?.sub === job?.user?.sub;
  if (!canWriteJobs && !userOwnsJob) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  if (job.name === newName) {
    res.status(400).send("New name must be different from the current name");
    return;
  }

  const duplicate = await collection.findOne({ name: newName, key: { $ne: key } });
  if (duplicate) {
    res.status(409).send(`A job named "${newName}" already exists`);
    return;
  }

  try {
    renameJobFilesystem(job, newName);
    const renamedFields = buildRenamedJobFields(job, newName);
    await collection.updateOne({ key }, { $set: renamedFields });

    const updatedJob = { ...job, ...renamedFields };
    await regenerateDefaultReports(updatedJob);

    res.status(200).send(updatedJob);
  } catch (error) {
    console.error(`Error renaming job ${key}`, error);
    res.status(500).send(error.message || "Failed to rename job");
  }
});

router.post("/rename_group", async (req, res) => {
  const canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  const groupId = req.body.groupId ? String(req.body.groupId).replace(/[^a-zA-Z0-9_-]/g, "") : "";
  const newName = req.body.name ? String(req.body.name).replace(/[^a-zA-Z0-9_+. -]/g, "").trim() : "";

  if (!groupId) {
    res.status(400).send("Missing groupId");
    return;
  }

  if (!newName) {
    res.status(400).send("Missing or invalid group name");
    return;
  }

  const db = await constants.connectToDatabase();
  const collection = db.collection(constants.report_queue_collection);
  const jobs = await collection.find({ group_id: groupId }).toArray();

  if (jobs.length === 0) {
    res.status(404).send("Group not found");
    return;
  }

  const userOwnsAllJobs = jobs.every((job) => req.auth?.payload?.sub === job?.user?.sub);
  if (!canWriteJobs && !userOwnsAllJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  const currentName = jobs.find((job) => job.group_name)?.group_name;
  if (currentName === newName) {
    res.status(400).send("New name must be different from the current name");
    return;
  }

  const result = await collection.updateMany({ group_id: groupId }, { $set: { group_name: newName } });

  res.status(200).send({ groupId, group_name: newName, updatedCount: result.modifiedCount });
});

router.post("/reorder_pending_jobs", async (req, res) => {
  let canWriteJobs = req.auth?.payload?.permissions?.includes("write:jobs") || false;
  if (!canWriteJobs) {
    res.status(401).send("Unauthorized: missing write:jobs permission");
    return;
  }

  let keys = req.body.keys;
  if (!keys || !Array.isArray(keys) || keys.length === 0) {
    res.status(400).send("Missing keys");
    return;
  }

  let db = await constants.connectToDatabase();
  let collection = db.collection(constants.report_queue_collection);
  const baseSubmitted = Date.now();
  let modifiedCount = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const result = await collection.updateOne(
      { key, status: { $in: ["Pending", "WaitingApproval", "Paused"] } },
      { $set: { submitted: baseSubmitted + i } }
    );
    modifiedCount += result.modifiedCount;
  }

  res.status(200).send({ modifiedCount });
});

module.exports = router;
