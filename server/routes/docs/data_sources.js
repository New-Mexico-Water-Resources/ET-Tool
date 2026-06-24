const express = require("express");
const router = express.Router();
const { loadDataDocs } = require("../../utils/loadDataDocs");

router.get("/data-sources", async (req, res) => {
  try {
    const content = await loadDataDocs();
    res.status(200).json(content);
  } catch (err) {
    console.error("Failed to load data documentation:", err);
    res.status(500).json({ error: "Failed to load data documentation" });
  }
});

module.exports = router;
