const express = require("express");
const router = express.Router();
const axios = require("axios");
const NodeCache = require("node-cache");

const cache = new NodeCache({ stdTTL: 86400 });

const CDL_RELEASE_BASE =
  "https://www.nass.usda.gov/Research_and_Science/Cropland/Release/datasets";
const MIN_CDL_YEAR = 2000;

function cdlDatasetUrl(year) {
  return `${CDL_RELEASE_BASE}/${year}_10m_cdls.zip`;
}

async function datasetExists(year) {
  const response = await axios.head(cdlDatasetUrl(year), {
    timeout: 15000,
    maxRedirects: 5,
    validateStatus: (status) => status < 500,
  });
  return response.status === 200;
}

async function resolveLatestCdlYear() {
  const startYear = new Date().getFullYear();
  for (let year = startYear; year >= MIN_CDL_YEAR; year -= 1) {
    try {
      if (await datasetExists(year)) {
        return year;
      }
    } catch (error) {
      console.warn(`CDL year probe failed for ${year}:`, error.message);
    }
  }
  throw new Error("No USDA CDL release dataset found");
}

router.get("/cdl-year", async (req, res) => {
  try {
    const cached = cache.get("cdlYear");
    if (cached) {
      return res.json(cached);
    }

    const year = await resolveLatestCdlYear();
    const payload = {
      year,
      datasetUrl: cdlDatasetUrl(year),
      checkedAt: new Date().toISOString(),
    };
    cache.set("cdlYear", payload);
    res.json(payload);
  } catch (error) {
    console.error("Error resolving CDL release year:", error);
    res.status(500).json({ error: "Failed to resolve CDL release year" });
  }
});

module.exports = router;
