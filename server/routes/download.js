const express = require("express");
const archiver = require("archiver");
const glob = require("glob");
const path = require("path");
const fs = require("fs");
const constants = require("../constants");
const { area: turfArea } = require("@turf/turf");

const router = express.Router();
const { run_directory_base, report_queue_collection, connectToDatabase } = constants;
const OPENET_TRANSITION_DATE = 1985;

const mmToIn = (mm) => {
  let mmValue = typeof mm === "string" ? parseFloat(mm) : mm;
  return isNaN(mmValue) ? "" : mmValue / 25.4;
};

const mmToAF = (value, acres) => {
  return value * acres * 0.003259;
};

class UnitConverter {
  static convert(value, units, acres = 1) {
    const unitConversionMap = {
      metric: (value) => value,
      imperial: (value) => mmToIn(value),
      "acre-feet": (value, acres) => mmToAF(value, acres),
    };

    if (!unitConversionMap[units]) {
      throw new Error(`Invalid units: ${units}`);
    }

    return unitConversionMap[units](value, acres);
  }
}

const getJob = async (key) => {
  const db = await connectToDatabase();
  const collection = db.collection(report_queue_collection);
  return collection.findOne({ key });
};

const unitsToFileSuffix = (units) => {
  if (units === "metric") return "";
  if (units === "imperial") return "in";
  if (units === "acre-feet") return "AF";
  return units;
};

const unitsToAbbreviation = (units) => {
  if (units === "metric") return "mm";
  if (units === "imperial") return "in";
  if (units === "acre-feet") return "AF";
  return units;
};

const unitsToPdfId = (units) => {
  if (units === "metric") return "";
  if (units === "imperial") return "Imperial";
  if (units === "acre-feet") return "AF";
  return units;
};

const processFigureFiles = (archive, figureDirectory, units) => {
  const pattern = path.join(figureDirectory, "*.png");
  const figureFiles = glob.sync(pattern);
  figureFiles.forEach((file) => {
    const suffix = unitsToFileSuffix(units);
    if (suffix !== "" && units !== "metric" && file.endsWith(`_${suffix}.png`)) {
      const newName = path.basename(file).replace(`_${suffix}.png`, ".png");
      console.log(`Adding figure file: ${file} as ${newName}`);
      archive.file(file, { name: newName });
    } else if (suffix === "" && units === "metric" && !file.endsWith(`_in.png`) && !file.endsWith(`_AF.png`)) {
      const name = path.basename(file);
      console.log(`Adding figure file: ${file} as ${name}`);
      archive.file(file, { name });
    }
  });
};

const processReportFiles = (archive, figureDirectory, units) => {
  const pattern = path.join(figureDirectory, "*.pdf");
  const reportFiles = glob.sync(pattern);
  const id = unitsToPdfId(units);
  reportFiles.forEach((file) => {
    // Find the PDF file with the correct units, rename this to be the report downloaded
    if (id && file.endsWith(`_${id}_Report.pdf`)) {
      const newName = path.basename(file).replace(`_${id}_Report.pdf`, "_Report.pdf");
      console.log(`Adding report file: ${file} as ${newName}`);
      archive.file(file, { name: newName });
    } else if (
      !id &&
      file.endsWith(`_Report.pdf`) &&
      !file.endsWith(`_AF_Report.pdf`) &&
      !file.endsWith(`_Imperial_Report.pdf`)
    ) {
      // Default metric report case
      const newName = path.basename(file);
      console.log(`Adding report file: ${file} as ${newName}`);
      archive.file(file, { name: newName });
    }
  });
};

const processMonthlyNanFiles = (runDir, key, jobName) => {
  const monthlyNanDir = path.join(runDir, key, "output", "monthly_nan", jobName);
  const csvPattern = path.join(monthlyNanDir, "*.csv");
  const nanFiles = glob.sync(csvPattern);
  const nanValues = {};

  nanFiles.forEach((file) => {
    const data = fs.readFileSync(file, "utf8");
    const lines = data.trim().split("\n");
    const header = lines
      .shift()
      .split(",")
      .map((s) => s.trim());

    lines.forEach((line) => {
      const columns = line.split(",").map((s) => s.trim());
      let row = {};
      header.forEach((col, i) => (row[col] = columns[i]));

      for (const key in row) {
        const convertedColumn = Number(row[key]);
        if (!isNaN(convertedColumn)) {
          // Round to 2 decimal places
          row[key] = Math.round(convertedColumn * 100) / 100;
        }
      }

      const year = row["year"];
      const month = row["month"];
      if (!nanValues[year]) {
        nanValues[year] = {};
      }
      nanValues[year][month] = row;
    });
  });

  return nanValues;
};

const processLandsatCloudCoverageCache = (runDir, key, jobName) => {
  const landsatCloudCoverageCacheDir = path.join(runDir, key, "output", "nan_subsets", jobName, "cloud_coverage_cache");
  if (!fs.existsSync(landsatCloudCoverageCacheDir)) {
    return null;
  }
  const jsonPattern = path.join(landsatCloudCoverageCacheDir, "*.json");
  const landsatCloudCoverageCacheFiles = glob.sync(jsonPattern);
  const landsatCloudCoverageCache = {};
  landsatCloudCoverageCacheFiles.forEach((file) => {
    const data = fs.readFileSync(file, "utf8");
    const jsonData = JSON.parse(data);
    landsatCloudCoverageCache[jsonData.year] = landsatCloudCoverageCache[jsonData.year] || {};
    landsatCloudCoverageCache[jsonData.year][jsonData.month] = jsonData;
  });
  return landsatCloudCoverageCache;
};

const processLandsatPassCountCache = (runDir, key, jobName) => {
  const landsatPassCountCacheDir = path.join(runDir, key, "output", "subset", jobName, "landsat_pass_count_cache");
  if (!fs.existsSync(landsatPassCountCacheDir)) {
    return null;
  }
  const jsonPattern = path.join(landsatPassCountCacheDir, "*.json");
  const landsatPassCountCacheFiles = glob.sync(jsonPattern);
  const landsatPassCountCache = {};
  landsatPassCountCacheFiles.forEach((file) => {
    const data = fs.readFileSync(file, "utf8");
    const jsonData = JSON.parse(data);
    landsatPassCountCache[jsonData.year] = landsatPassCountCache[jsonData.year] || {};
    landsatPassCountCache[jsonData.year][jsonData.month] = jsonData;
  });
  return landsatPassCountCache;
};

const processLandsatPassCounts = (runDir, key, jobName) => {
  // Landsat Pass Count cache is the older format, but much simpler, so check if this exists first
  const landsatPassCountCache = processLandsatPassCountCache(runDir, key, jobName);
  if (!landsatPassCountCache) {
    return processLandsatCloudCoverageCache(runDir, key, jobName);
  }
  return landsatPassCountCache;
};

const processCSVFiles = async (archive, runDir, key, jobName, nanValues, landsatPassCounts, units, area) => {
  const csvDir = path.join(runDir, key, "output", "monthly_means", jobName);
  let csvFiles = glob.sync(path.join(csvDir, "*.csv")).filter((file) => path.basename(file).endsWith("_monthly_means.csv"));
  const unitsAbbreviation = unitsToAbbreviation(units);

  const hasPostTransitionData = csvFiles.some((fileName) => {
    const year = path.basename(fileName).split("_")[0];
    if (isNaN(year)) {
      return false;
    }

    return Number(year) >= OPENET_TRANSITION_DATE;
  });

  const header = [
    "Year",
    "Month",
    `ET (${unitsAbbreviation}/month)`,
    hasPostTransitionData ? `Uncorrected PET (${unitsAbbreviation}/month)` : `PET (${unitsAbbreviation}/month)`,
    ...(hasPostTransitionData ? [`Adjusted PET (${unitsAbbreviation}/month)`] : []),
    `Precipitation (${unitsAbbreviation}/month)`,
    "Cloud Coverage + Missing Data (%)",
    ...(hasPostTransitionData ? ["Days with Landsat Passes"] : []),
  ].join(",");

  let combinedDataRows = [];

  for (const file of csvFiles) {
    if (path.basename(file).includes("_temp_")) continue;

    let data = fs.readFileSync(file, "utf8");
    let lines = data.trim().split("\n");
    const existingHeader = lines.shift();

    // Remove index column if present (when header has 5 columns)
    if (existingHeader.split(",").length === 5) {
      lines = lines.map((line) => {
        let cols = line.split(",").map((s) => s.trim());
        if (cols.length === 5) {
          cols.shift();
        }
        return cols.join(",");
      });
    }

    lines = lines.map((line) => {
      const cols = line.split(",").map((s) => s.trim());
      let [year, month, etRaw, petRaw] = cols;
      year = Number(year);
      month = Number(month);

      let et = UnitConverter.convert(etRaw, units, area);
      et = isNaN(et) ? "" : Math.round(et * 100) / 100;
      let pet = UnitConverter.convert(petRaw, units, area);
      pet = isNaN(pet) ? "" : Math.round(pet * 100) / 100;

      let convertedRow = [year, month, et, pet];

      const nanRow = nanValues?.[year]?.[month];

      if (hasPostTransitionData) {
        if (year >= OPENET_TRANSITION_DATE && nanRow) {
          let etMax = UnitConverter.convert(nanRow["avg_max"], units, area);
          etMax = isNaN(etMax) ? "" : Math.round(etMax * 100) / 100;
          let adjustedPET = pet < etMax ? etMax : pet;
          adjustedPET = isNaN(adjustedPET) ? "" : Math.round(adjustedPET * 100) / 100;
          convertedRow.push(adjustedPET);
        } else {
          convertedRow.push(""); // Empty for pre-transition years
        }
      }

      // Add precipitation and cloud coverage (for all years)
      if (nanRow) {
        let ppt = UnitConverter.convert(nanRow["ppt_avg"], units, area);
        ppt = isNaN(ppt) ? "" : Math.round(ppt * 100) / 100;
        convertedRow.push(ppt, nanRow["percent_nan"]);
      } else {
        convertedRow.push("", "");
      }

      if (hasPostTransitionData) {
        if (year >= OPENET_TRANSITION_DATE) {
          const landsatPassCountRow = landsatPassCounts?.[year]?.[month];
          convertedRow.push(landsatPassCountRow ? landsatPassCountRow["pass_count"] : "");
        } else {
          convertedRow.push(""); // Empty for pre-transition years
        }
      }

      return convertedRow.join(",");
    });

    const newData = [header, ...lines].join("\n");
    const tempPath = file.replace(".csv", `_temp_${unitsAbbreviation}.csv`);
    fs.writeFileSync(tempPath, newData);
    archive.file(tempPath, { name: path.basename(file) });
    combinedDataRows = combinedDataRows.concat(lines);
  }

  const combinedCsvPath = path.join(csvDir, `${jobName}_combined.csv`);
  const combinedStream = fs.createWriteStream(combinedCsvPath);
  combinedStream.write(header + "\n");

  // Remove duplicates and sort by Year then Month.
  combinedDataRows = Array.from(new Set(combinedDataRows)).sort((a, b) => {
    const [yearA, monthA] = a.split(",").map((s) => s.trim());
    const [yearB, monthB] = b.split(",").map((s) => s.trim());
    return yearA === yearB ? Number(monthA) - Number(monthB) : Number(yearA) - Number(yearB);
  });
  combinedDataRows.forEach((row) => combinedStream.write(row + "\n"));
  combinedStream.end();
  archive.file(combinedCsvPath, { name: `${jobName}_combined.csv` });
};

router.get("/download", async (req, res) => {
  try {
    const key = req.query.key;
    const units = req.query.units;

    const job = await getJob(key);
    if (!job) {
      return res.status(404).send("Job not found");
    }
    const jobName = job.name;

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("end", () => console.log("Archive wrote %d bytes", archive.pointer()));
    archive.on("warning", (err) => {
      if (err.code === "ENOENT") {
        console.warn(err);
      } else {
        throw err;
      }
    });
    archive.on("error", (err) => {
      throw err;
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${jobName}.zip`);
    archive.pipe(res);

    const geojsonPath = path.join(run_directory_base, key, `${jobName}.geojson`);
    archive.file(geojsonPath, { name: `${jobName}.geojson` });

    // Open the geojson file and calculate the acres
    const geojson = JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
    const area = turfArea(geojson) / 4046.86;

    const figureDirectory = path.join(run_directory_base, key, "output", "figures", jobName);
    if (!fs.existsSync(figureDirectory)) {
      return res.status(404).send(`Figure directory ${figureDirectory} does not exist`);
    }
    processFigureFiles(archive, figureDirectory, units);
    processReportFiles(archive, figureDirectory, units);

    const nanValues = processMonthlyNanFiles(run_directory_base, key, jobName);
    const landsatPassCounts = processLandsatPassCounts(run_directory_base, key, jobName);
    await processCSVFiles(archive, run_directory_base, key, jobName, nanValues, landsatPassCounts, units, area);

    await archive.finalize();
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
