const express = require("express");
const archiver = require("archiver");
const glob = require("glob");
const path = require("path");
const fs = require("fs");
const constants = require("../constants");

const router = express.Router();
const { run_directory_base, report_queue_collection, connectToDatabase } = constants;

const mmToIn = (mm) => {
  let mmValue = typeof mm === "string" ? parseFloat(mm) : mm;
  return isNaN(mmValue) ? "" : mmValue / 25.4;
};

const getJob = async (key) => {
  const db = await connectToDatabase();
  const collection = db.collection(report_queue_collection);
  return collection.findOne({ key });
};

const processFigureFiles = (archive, figureDirectory, metricUnits) => {
  const pattern = path.join(figureDirectory, "*.png");
  const figureFiles = glob.sync(pattern);
  figureFiles.forEach((file) => {
    if (metricUnits && file.endsWith("_in.png")) return;
    if (!metricUnits && !file.endsWith("_in.png")) return;

    const newName = path.basename(file).replace("_in.png", ".png");
    console.log(`Adding figure file: ${file} as ${newName}`);
    archive.file(file, { name: newName });
  });
};

const processReportFiles = (archive, figureDirectory, metricUnits) => {
  const pattern = path.join(figureDirectory, "*.pdf");
  const reportFiles = glob.sync(pattern);
  reportFiles.forEach((file) => {
    if (metricUnits && file.endsWith("_Imperial_Report.pdf")) return;
    if (!metricUnits && !file.endsWith("_Imperial_Report.pdf")) return;

    const newName = path.basename(file).replace("_Imperial_Report.pdf", "_Report.pdf");
    console.log(`Adding report file: ${file} as ${newName}`);
    archive.file(file, { name: newName });
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

const processLandsatPassCounts = (runDir, key, jobName) => {
  const landsatPassCountDir = path.join(runDir, key, "output", "subset", jobName, "landsat_pass_count_cache");
  const jsonPattern = path.join(landsatPassCountDir, "*.json");
  const landsatPassCountFiles = glob.sync(jsonPattern);
  const landsatPassCounts = {};

  landsatPassCountFiles.forEach((file) => {
    const data = fs.readFileSync(file, "utf8");
    const jsonData = JSON.parse(data);
    landsatPassCounts[jsonData.year] = landsatPassCounts[jsonData.year] || {};
    landsatPassCounts[jsonData.year][jsonData.month] = jsonData;
  });

  return landsatPassCounts;
};

const processCSVFiles = async (archive, runDir, key, jobName, nanValues, landsatPassCounts, units, metricUnits) => {
  const csvDir = path.join(runDir, key, "output", "monthly_means", jobName);
  let csvFiles = glob.sync(path.join(csvDir, "*.csv")).filter((file) => path.basename(file).endsWith("_monthly_means.csv"));

  const header = [
    "Year",
    "Month",
    `ET (${units}/month)`,
    `Uncorrected PET (${units}/month)`,
    `Adjusted PET (${units}/month)`,
    `Precipitation (${units}/month)`,
    "Cloud Coverage + Missing Data (%)",
    "Days with Landsat Passes",
  ].join(",");

  let combinedDataRows = [];

  for (const file of csvFiles) {
    if (path.basename(file).includes("_temp_")) continue;

    let data = fs.readFileSync(file, "utf8");
    let lines = data.trim().split("\n");
    const existingHeader = lines.shift();

    // Remove index column if present (when header has 5 columns).
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

      let et = metricUnits ? etRaw : mmToIn(etRaw);
      et = isNaN(et) ? "" : Math.round(et * 100) / 100;
      let pet = metricUnits ? petRaw : mmToIn(petRaw);
      pet = isNaN(pet) ? "" : Math.round(pet * 100) / 100;

      let convertedRow = [year, month, et, pet];

      const nanRow = nanValues?.[year]?.[month];
      if (nanRow) {
        let ppt = metricUnits ? nanRow["ppt_avg"] : mmToIn(nanRow["ppt_avg"]);
        ppt = isNaN(ppt) ? "" : Math.round(ppt * 100) / 100;
        let etMax = metricUnits ? nanRow["avg_max"] : mmToIn(nanRow["avg_max"]);
        etMax = isNaN(etMax) ? "" : Math.round(etMax * 100) / 100;

        let adjustedPET = pet < etMax ? etMax : pet;
        adjustedPET = isNaN(adjustedPET) ? "" : Math.round(adjustedPET * 100) / 100;

        convertedRow.push(adjustedPET, ppt, nanRow["percent_nan"]);
      } else {
        convertedRow.push("", "");
      }

      const landsatPassCountRow = landsatPassCounts?.[year]?.[month];
      if (landsatPassCountRow) {
        convertedRow.push(landsatPassCountRow["pass_count"]);
      } else {
        convertedRow.push("");
      }

      return convertedRow.join(",");
    });

    const newData = [header, ...lines].join("\n");
    const tempPath = file.replace(".csv", `_temp_${metricUnits ? "mm" : "in"}.csv`);
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
    const metricUnits = req.query.units !== "in";
    const units = metricUnits ? "mm" : "in";

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

    const figureDirectory = path.join(run_directory_base, key, "output", "figures", jobName);
    if (!fs.existsSync(figureDirectory)) {
      return res.status(404).send(`Figure directory ${figureDirectory} does not exist`);
    }
    processFigureFiles(archive, figureDirectory, metricUnits);
    processReportFiles(archive, figureDirectory, metricUnits);

    const nanValues = processMonthlyNanFiles(run_directory_base, key, jobName);
    const landsatPassCounts = processLandsatPassCounts(run_directory_base, key, jobName);
    await processCSVFiles(archive, run_directory_base, key, jobName, nanValues, landsatPassCounts, units, metricUnits);

    const geojsonPath = path.join(run_directory_base, key, `${jobName}.geojson`);
    archive.file(geojsonPath, { name: `${jobName}.geojson` });

    await archive.finalize();
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
