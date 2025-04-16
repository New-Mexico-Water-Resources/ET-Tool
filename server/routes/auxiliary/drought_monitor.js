const express = require("express");
const router = express.Router();
const axios = require("axios");
const NodeCache = require("node-cache");

// Create a cache with a 1-hour TTL (time to live)
const cache = new NodeCache({ stdTTL: 3600 });

/**
 * GET /api/auxiliary/drought-monitor
 * Returns the current US Drought Monitor data with caching
 */
router.get("/drought-monitor", async (req, res) => {
  try {
    // Check if we have cached data
    const cachedData = cache.get("droughtMonitorData");
    if (cachedData) {
      return res.json(cachedData);
    }

    // If no cached data, fetch from the API
    const response = await axios.get("https://droughtmonitor.unl.edu/data/json/usdm_current.json");
    const data = response.data;

    // Cache the data
    cache.set("droughtMonitorData", data);

    // Return the data
    res.json(data);
  } catch (error) {
    console.error("Error fetching drought monitor data:", error);
    res.status(500).json({ error: "Failed to fetch drought monitor data" });
  }
});

module.exports = router;
