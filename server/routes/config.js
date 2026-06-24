const express = require("express");
const { loadDefaultDownloadOptions } = require("../utils/defaultDownloadOptions");

const router = express.Router();

router.get("/default-download-options", (req, res) => {
  const canReadJobs = req.auth?.payload?.permissions?.includes("read:jobs") || false;
  if (!canReadJobs) {
    res.status(401).send("Unauthorized: missing read:jobs permission");
    return;
  }

  res.status(200).send(loadDefaultDownloadOptions());
});

module.exports = router;
