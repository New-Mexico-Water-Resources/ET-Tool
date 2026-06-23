const glob = require("glob");
const path = require("path");
const fs = require("fs");

const OPENET_TRANSITION_DATE = 1985;
const ANNUAL_ARCHIVE_DIR = "annual";

const mmToIn = (mm) => {
  const mmValue = typeof mm === "string" ? parseFloat(mm) : mm;
  return Number.isNaN(mmValue) ? "" : mmValue / 25.4;
};

const mmToAF = (value, acres) => value * acres * 0.003259;

class UnitConverter {
  static convert(value, units, acres = 1) {
    const unitConversionMap = {
      metric: (val) => val,
      imperial: (val) => mmToIn(val),
      "acre-feet": (val, acreage) => mmToAF(val, acreage),
    };

    if (!unitConversionMap[units]) {
      throw new Error(`Invalid units: ${units}`);
    }

    return unitConversionMap[units](value, acres);
  }
}

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

const getFigureArchiveName = (name) => (/^\d{4}_/.test(name) ? `${ANNUAL_ARCHIVE_DIR}/${name}` : name);

const processFigureFiles = (archive, figureDirectory, units, pathPrefix = "", includeYearlyCombined = true) => {
  const prefix = pathPrefix ? `${pathPrefix}/` : "";
  const pattern = path.join(figureDirectory, "*.png");
  const figureFiles = glob.sync(pattern);
  figureFiles.forEach((file) => {
    const basename = path.basename(file);
    if (!includeYearlyCombined && basename.startsWith("yearly_combined_")) {
      return;
    }

    const suffix = unitsToFileSuffix(units);
    if (suffix !== "" && units !== "metric" && file.endsWith(`_${suffix}.png`)) {
      const newName = path.basename(file).replace(`_${suffix}.png`, ".png");
      const archiveName = `${prefix}${getFigureArchiveName(newName)}`;
      archive.file(file, { name: archiveName });
    } else if (suffix === "" && units === "metric" && !file.endsWith(`_in.png`) && !file.endsWith(`_AF.png`)) {
      const name = path.basename(file);
      const archiveName = `${prefix}${getFigureArchiveName(name)}`;
      archive.file(file, { name: archiveName });
    }
  });
};

const processReportFiles = (archive, figureDirectory, units, pathPrefix = "") => {
  const prefix = pathPrefix ? `${pathPrefix}/` : "";
  const pattern = path.join(figureDirectory, "*.pdf");
  const reportFiles = glob.sync(pattern);
  const id = unitsToPdfId(units);
  reportFiles.forEach((file) => {
    if (id && file.endsWith(`_${id}_Report.pdf`)) {
      const newName = path.basename(file).replace(`_${id}_Report.pdf`, "_Report.pdf");
      archive.file(file, { name: `${prefix}${newName}` });
    } else if (
      !id &&
      file.endsWith(`_Report.pdf`) &&
      !file.endsWith(`_AF_Report.pdf`) &&
      !file.endsWith(`_Imperial_Report.pdf`)
    ) {
      const newName = path.basename(file);
      archive.file(file, { name: `${prefix}${newName}` });
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
      const row = {};
      header.forEach((col, i) => {
        row[col] = columns[i];
      });

      for (const col in row) {
        const convertedColumn = Number(row[col]);
        if (!Number.isNaN(convertedColumn)) {
          row[col] = Math.round(convertedColumn * 100) / 100;
        }
      }

      const year = row.year;
      const month = row.month;
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
  const landsatPassCountCache = processLandsatPassCountCache(runDir, key, jobName);
  if (!landsatPassCountCache) {
    return processLandsatCloudCoverageCache(runDir, key, jobName);
  }
  return landsatPassCountCache;
};

const aggregateYearlyCombinedRows = (combinedDataRows, hasPostTransitionData) => {
  const yearlyTotals = {};

  combinedDataRows.forEach((row) => {
    const cols = row.split(",").map((s) => s.trim());
    const year = cols[0];
    if (!yearlyTotals[year]) {
      yearlyTotals[year] = {
        et: 0,
        pet: 0,
        ppt: 0,
        cloudCoverValues: [],
        passCount: 0,
        hasPassCount: false,
      };
    }

    const entry = yearlyTotals[year];
    const et = parseFloat(cols[2]);
    const pet = parseFloat(cols[3]);
    if (!Number.isNaN(et)) {
      entry.et += et;
    }
    if (!Number.isNaN(pet)) {
      entry.pet += pet;
    }

    if (cols[4] !== "") {
      const ppt = parseFloat(cols[4]);
      if (!Number.isNaN(ppt)) {
        entry.ppt += ppt;
      }
    }

    if (cols[5] !== "") {
      const cloudCover = parseFloat(cols[5]);
      if (!Number.isNaN(cloudCover)) {
        entry.cloudCoverValues.push(cloudCover);
      }
    }

    if (hasPostTransitionData && cols[6] !== "") {
      const passCount = parseFloat(cols[6]);
      if (!Number.isNaN(passCount)) {
        entry.passCount += passCount;
        entry.hasPassCount = true;
      }
    }
  });

  return Object.keys(yearlyTotals)
    .sort((a, b) => Number(a) - Number(b))
    .map((year) => {
      const entry = yearlyTotals[year];
      const et = Math.round(entry.et * 100) / 100;
      const pet = Math.round(entry.pet * 100) / 100;
      const ppt = entry.ppt ? Math.round(entry.ppt * 100) / 100 : "";
      const cloudCover =
        entry.cloudCoverValues.length > 0
          ? Math.round((entry.cloudCoverValues.reduce((sum, value) => sum + value, 0) / entry.cloudCoverValues.length) * 100) /
            100
          : "";
      const csvRow = [year, et, pet, ppt, cloudCover];

      if (hasPostTransitionData) {
        csvRow.push(entry.hasPassCount ? entry.passCount : "");
      }

      return csvRow.join(",");
    });
};

const collectCombinedDataRows = (runDir, key, jobName, nanValues, landsatPassCounts, units, area) => {
  const csvDir = path.join(runDir, key, "output", "monthly_means", jobName);
  const csvFiles = glob.sync(path.join(csvDir, "*.csv")).filter((file) => path.basename(file).endsWith("_monthly_means.csv"));

  const hasPostTransitionData = csvFiles.some((fileName) => {
    const year = path.basename(fileName).split("_")[0];
    if (Number.isNaN(Number(year))) {
      return false;
    }
    return Number(year) >= OPENET_TRANSITION_DATE;
  });

  let combinedDataRows = [];

  for (const file of csvFiles) {
    if (path.basename(file).includes("_temp_")) {
      continue;
    }

    const data = fs.readFileSync(file, "utf8");
    const lines = data.trim().split("\n");
    const existingHeader = lines.shift();

    let normalizedLines = lines;
    if (existingHeader.split(",").length === 5) {
      normalizedLines = lines.map((line) => {
        const cols = line.split(",").map((s) => s.trim());
        if (cols.length === 5) {
          cols.shift();
        }
        return cols.join(",");
      });
    }

    const convertedLines = normalizedLines.map((line) => {
      const cols = line.split(",").map((s) => s.trim());
      let [year, month, etRaw, petRaw] = cols;
      year = Number(year);
      month = Number(month);

      let et = UnitConverter.convert(etRaw, units, area);
      et = Number.isNaN(et) ? "" : Math.round(et * 100) / 100;
      let pet = UnitConverter.convert(petRaw, units, area);
      pet = Number.isNaN(pet) ? "" : Math.round(pet * 100) / 100;

      const convertedRow = [year, month, et, pet];
      const nanRow = nanValues?.[year]?.[month];

      if (nanRow) {
        let ppt = UnitConverter.convert(nanRow.ppt_avg, units, area);
        ppt = Number.isNaN(ppt) ? "" : Math.round(ppt * 100) / 100;
        convertedRow.push(ppt, nanRow.percent_nan);
      } else {
        convertedRow.push("", "");
      }

      if (hasPostTransitionData) {
        if (year >= OPENET_TRANSITION_DATE) {
          const landsatPassCountRow = landsatPassCounts?.[year]?.[month];
          convertedRow.push(landsatPassCountRow ? landsatPassCountRow.pass_count : "");
        } else {
          convertedRow.push("");
        }
      }

      return convertedRow.join(",");
    });

    combinedDataRows = combinedDataRows.concat(convertedLines);
  }

  combinedDataRows = Array.from(new Set(combinedDataRows)).sort((a, b) => {
    const [yearA, monthA] = a.split(",").map((s) => s.trim());
    const [yearB, monthB] = b.split(",").map((s) => s.trim());
    return yearA === yearB ? Number(monthA) - Number(monthB) : Number(yearA) - Number(yearB);
  });

  return { combinedDataRows, hasPostTransitionData };
};

const buildMonthlyCombinedCsv = (runDir, key, jobName, units, area) => {
  const nanValues = processMonthlyNanFiles(runDir, key, jobName);
  const landsatPassCounts = processLandsatPassCounts(runDir, key, jobName);
  const { combinedDataRows, hasPostTransitionData } = collectCombinedDataRows(
    runDir,
    key,
    jobName,
    nanValues,
    landsatPassCounts,
    units,
    area,
  );
  const unitsAbbreviation = unitsToAbbreviation(units);
  const header = [
    "Year",
    "Month",
    `ET (${unitsAbbreviation}/month)`,
    `ETo (${unitsAbbreviation}/month)`,
    `Precipitation (${unitsAbbreviation}/month)`,
    "Cloud Coverage + Missing Data (%)",
    ...(hasPostTransitionData ? ["Days with Landsat Passes"] : []),
  ].join(",");

  return {
    filename: `${jobName}_combined.csv`,
    content: [header, ...combinedDataRows].join("\n"),
  };
};

const buildYearlyCombinedCsv = (runDir, key, jobName, units, area) => {
  const nanValues = processMonthlyNanFiles(runDir, key, jobName);
  const landsatPassCounts = processLandsatPassCounts(runDir, key, jobName);
  const { combinedDataRows, hasPostTransitionData } = collectCombinedDataRows(
    runDir,
    key,
    jobName,
    nanValues,
    landsatPassCounts,
    units,
    area,
  );
  const unitsAbbreviation = unitsToAbbreviation(units);
  const yearlyHeader = [
    "Year",
    `ET (${unitsAbbreviation}/year)`,
    `ETo (${unitsAbbreviation}/year)`,
    `Precipitation (${unitsAbbreviation}/year)`,
    "Cloud Coverage + Missing Data (%)",
    ...(hasPostTransitionData ? ["Days with Landsat Passes"] : []),
  ].join(",");
  const yearlyRows = aggregateYearlyCombinedRows(combinedDataRows, hasPostTransitionData);

  return {
    filename: `${jobName}_yearly_combined.csv`,
    content: [yearlyHeader, ...yearlyRows].join("\n"),
  };
};

const appendJobCsvsToArchive = async (archive, runDir, key, jobName, nanValues, landsatPassCounts, units, area, pathPrefix = "") => {
  const prefix = pathPrefix ? `${pathPrefix}/` : "";
  const csvDir = path.join(runDir, key, "output", "monthly_means", jobName);
  const csvFiles = glob.sync(path.join(csvDir, "*.csv")).filter((file) => path.basename(file).endsWith("_monthly_means.csv"));
  const unitsAbbreviation = unitsToAbbreviation(units);

  const hasPostTransitionData = csvFiles.some((fileName) => {
    const year = path.basename(fileName).split("_")[0];
    if (Number.isNaN(Number(year))) {
      return false;
    }
    return Number(year) >= OPENET_TRANSITION_DATE;
  });

  const header = [
    "Year",
    "Month",
    `ET (${unitsAbbreviation}/month)`,
    `ETo (${unitsAbbreviation}/month)`,
    `Precipitation (${unitsAbbreviation}/month)`,
    "Cloud Coverage + Missing Data (%)",
    ...(hasPostTransitionData ? ["Days with Landsat Passes"] : []),
  ].join(",");

  let combinedDataRows = [];

  for (const file of csvFiles) {
    if (path.basename(file).includes("_temp_")) {
      continue;
    }

    const data = fs.readFileSync(file, "utf8");
    const lines = data.trim().split("\n");
    const existingHeader = lines.shift();

    let normalizedLines = lines;
    if (existingHeader.split(",").length === 5) {
      normalizedLines = lines.map((line) => {
        const cols = line.split(",").map((s) => s.trim());
        if (cols.length === 5) {
          cols.shift();
        }
        return cols.join(",");
      });
    }

    const convertedLines = normalizedLines.map((line) => {
      const cols = line.split(",").map((s) => s.trim());
      let [year, month, etRaw, petRaw] = cols;
      year = Number(year);
      month = Number(month);

      let et = UnitConverter.convert(etRaw, units, area);
      et = Number.isNaN(et) ? "" : Math.round(et * 100) / 100;
      let pet = UnitConverter.convert(petRaw, units, area);
      pet = Number.isNaN(pet) ? "" : Math.round(pet * 100) / 100;

      const convertedRow = [year, month, et, pet];
      const nanRow = nanValues?.[year]?.[month];

      if (nanRow) {
        let ppt = UnitConverter.convert(nanRow.ppt_avg, units, area);
        ppt = Number.isNaN(ppt) ? "" : Math.round(ppt * 100) / 100;
        convertedRow.push(ppt, nanRow.percent_nan);
      } else {
        convertedRow.push("", "");
      }

      if (hasPostTransitionData) {
        if (year >= OPENET_TRANSITION_DATE) {
          const landsatPassCountRow = landsatPassCounts?.[year]?.[month];
          convertedRow.push(landsatPassCountRow ? landsatPassCountRow.pass_count : "");
        } else {
          convertedRow.push("");
        }
      }

      return convertedRow.join(",");
    });

    const newData = [header, ...convertedLines].join("\n");
    const tempPath = file.replace(".csv", `_temp_${unitsAbbreviation}.csv`);
    fs.writeFileSync(tempPath, newData);
    archive.file(tempPath, { name: `${prefix}${ANNUAL_ARCHIVE_DIR}/${path.basename(file)}` });
    combinedDataRows = combinedDataRows.concat(convertedLines);
  }

  const combinedCsvPath = path.join(csvDir, `${jobName}_combined.csv`);
  const combinedStream = fs.createWriteStream(combinedCsvPath);
  combinedStream.write(`${header}\n`);

  combinedDataRows = Array.from(new Set(combinedDataRows)).sort((a, b) => {
    const [yearA, monthA] = a.split(",").map((s) => s.trim());
    const [yearB, monthB] = b.split(",").map((s) => s.trim());
    return yearA === yearB ? Number(monthA) - Number(monthB) : Number(yearA) - Number(yearB);
  });
  combinedDataRows.forEach((row) => combinedStream.write(`${row}\n`));
  combinedStream.end();
  archive.file(combinedCsvPath, { name: `${prefix}${jobName}_combined.csv` });

  const yearlyCsv = buildYearlyCombinedCsv(runDir, key, jobName, units, area);
  const yearlyCombinedCsvPath = path.join(csvDir, yearlyCsv.filename);
  fs.writeFileSync(yearlyCombinedCsvPath, yearlyCsv.content);
  archive.file(yearlyCombinedCsvPath, { name: `${prefix}${yearlyCsv.filename}` });
};

module.exports = {
  OPENET_TRANSITION_DATE,
  ANNUAL_ARCHIVE_DIR,
  processFigureFiles,
  processReportFiles,
  processMonthlyNanFiles,
  processLandsatPassCounts,
  appendJobCsvsToArchive,
  buildMonthlyCombinedCsv,
  buildYearlyCombinedCsv,
};
