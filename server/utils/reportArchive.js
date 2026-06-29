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
        if (row[col] === "") {
          continue;
        }
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

const getOverlapYears = (primaryJob, comparisonJob) => {
  const startYear = Math.max(Number(primaryJob.start_year), Number(comparisonJob.start_year));
  const endYear = Math.min(Number(primaryJob.end_year), Number(comparisonJob.end_year));
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || startYear > endYear) {
    throw new Error("Selected jobs do not have overlapping years");
  }
  return { startYear, endYear };
};

const parseCombinedDataRow = (row, hasPostTransitionData) => {
  const cols = row.split(",").map((s) => s.trim());
  const values = {
    year: cols[0],
    month: cols[1],
    et: cols[2] ?? "",
    pet: cols[3] ?? "",
    ppt: cols[4] ?? "",
    cloudCover: cols[5] ?? "",
    passCount: "",
  };
  if (hasPostTransitionData) {
    values.passCount = cols[6] ?? "";
  }
  return values;
};

const parseYearlyCombinedRow = (row, hasPostTransitionData) => {
  const cols = row.split(",").map((s) => s.trim());
  const values = {
    year: cols[0],
    et: cols[1] ?? "",
    pet: cols[2] ?? "",
    ppt: cols[3] ?? "",
    cloudCover: cols[4] ?? "",
    passCount: "",
  };
  if (hasPostTransitionData) {
    values.passCount = cols[5] ?? "";
  }
  return values;
};

const comparisonMetricDefinitions = (unitsAbbreviation, period, includePassCounts) => {
  const periodLabel = period === "month" ? "month" : "year";
  const metrics = [
    { key: "et", label: `ET (${unitsAbbreviation}/${periodLabel})` },
    { key: "pet", label: `ETo (${unitsAbbreviation}/${periodLabel})` },
    { key: "ppt", label: `Precipitation (${unitsAbbreviation}/${periodLabel})` },
    { key: "cloudCover", label: "Cloud Coverage + Missing Data (%)" },
  ];
  if (includePassCounts) {
    metrics.push({ key: "passCount", label: "Days with Landsat Passes" });
  }
  return metrics;
};

const buildInterleavedComparisonHeader = (
  primaryName,
  comparisonName,
  unitsAbbreviation,
  period,
  primaryHasPostTransitionData,
  comparisonHasPostTransitionData,
) => {
  const metrics = comparisonMetricDefinitions(
    unitsAbbreviation,
    period,
    primaryHasPostTransitionData || comparisonHasPostTransitionData,
  );
  const headers = period === "month" ? ["Year", "Month"] : ["Year"];
  metrics.forEach((metric) => {
    headers.push(`${metric.label} - ${primaryName}`);
    headers.push(`${metric.label} - ${comparisonName}`);
  });
  return headers;
};

const buildInterleavedComparisonValues = (
  primaryValues,
  comparisonValues,
  primaryHasPostTransitionData,
  comparisonHasPostTransitionData,
  period,
  unitsAbbreviation,
) => {
  const metrics = comparisonMetricDefinitions(
    unitsAbbreviation,
    period,
    primaryHasPostTransitionData || comparisonHasPostTransitionData,
  );
  const values = [];
  metrics.forEach((metric) => {
    values.push(primaryValues[metric.key] ?? "");
    values.push(comparisonValues[metric.key] ?? "");
  });
  return values;
};

const indexMonthlyRows = (combinedDataRows, hasPostTransitionData, startYear, endYear) => {
  const indexed = new Map();
  combinedDataRows.forEach((row) => {
    const values = parseCombinedDataRow(row, hasPostTransitionData);
    const year = Number(values.year);
    if (!Number.isFinite(year) || year < startYear || year > endYear) {
      return;
    }
    indexed.set(`${values.year}-${values.month}`, values);
  });
  return indexed;
};

const indexYearlyRows = (yearlyRows, hasPostTransitionData, startYear, endYear) => {
  const indexed = new Map();
  yearlyRows.forEach((row) => {
    const values = parseYearlyCombinedRow(row, hasPostTransitionData);
    const year = Number(values.year);
    if (!Number.isFinite(year) || year < startYear || year > endYear) {
      return;
    }
    indexed.set(values.year, values);
  });
  return indexed;
};

const emptyRegionValues = () => ({
  et: "",
  pet: "",
  ppt: "",
  cloudCover: "",
  passCount: "",
});

const buildComparisonMonthlyCsv = (runDir, primaryJob, comparisonJob, units, primaryArea, comparisonArea) => {
  const primaryNan = processMonthlyNanFiles(runDir, primaryJob.key, primaryJob.name);
  const primaryPasses = processLandsatPassCounts(runDir, primaryJob.key, primaryJob.name);
  const comparisonNan = processMonthlyNanFiles(runDir, comparisonJob.key, comparisonJob.name);
  const comparisonPasses = processLandsatPassCounts(runDir, comparisonJob.key, comparisonJob.name);

  const primaryData = collectCombinedDataRows(
    runDir,
    primaryJob.key,
    primaryJob.name,
    primaryNan,
    primaryPasses,
    units,
    primaryArea,
  );
  const comparisonData = collectCombinedDataRows(
    runDir,
    comparisonJob.key,
    comparisonJob.name,
    comparisonNan,
    comparisonPasses,
    units,
    comparisonArea,
  );

  const { startYear, endYear } = getOverlapYears(primaryJob, comparisonJob);
  const primaryRows = indexMonthlyRows(
    primaryData.combinedDataRows,
    primaryData.hasPostTransitionData,
    startYear,
    endYear,
  );
  const comparisonRows = indexMonthlyRows(
    comparisonData.combinedDataRows,
    comparisonData.hasPostTransitionData,
    startYear,
    endYear,
  );

  const monthKeys = Array.from(new Set([...primaryRows.keys(), ...comparisonRows.keys()])).sort((a, b) => {
    const [yearA, monthA] = a.split("-").map(Number);
    const [yearB, monthB] = b.split("-").map(Number);
    return yearA === yearB ? monthA - monthB : yearA - yearB;
  });

  const unitsAbbreviation = unitsToAbbreviation(units);
  const slug = `${primaryJob.name}_vs_${comparisonJob.name}`;
  const header = buildInterleavedComparisonHeader(
    primaryJob.name,
    comparisonJob.name,
    unitsAbbreviation,
    "month",
    primaryData.hasPostTransitionData,
    comparisonData.hasPostTransitionData,
  ).join(",");

  const rows = monthKeys.map((key) => {
    const [year, month] = key.split("-");
    const primaryValues = primaryRows.get(key) || emptyRegionValues();
    const comparisonValues = comparisonRows.get(key) || emptyRegionValues();
    return [
      year,
      month,
      ...buildInterleavedComparisonValues(
        primaryValues,
        comparisonValues,
        primaryData.hasPostTransitionData,
        comparisonData.hasPostTransitionData,
        "month",
        unitsAbbreviation,
      ),
    ].join(",");
  });

  return {
    filename: `${slug}_combined.csv`,
    content: [header, ...rows].join("\n"),
  };
};

const buildComparisonYearlyCsv = (runDir, primaryJob, comparisonJob, units, primaryArea, comparisonArea) => {
  const primaryNan = processMonthlyNanFiles(runDir, primaryJob.key, primaryJob.name);
  const primaryPasses = processLandsatPassCounts(runDir, primaryJob.key, primaryJob.name);
  const comparisonNan = processMonthlyNanFiles(runDir, comparisonJob.key, comparisonJob.name);
  const comparisonPasses = processLandsatPassCounts(runDir, comparisonJob.key, comparisonJob.name);

  const primaryData = collectCombinedDataRows(
    runDir,
    primaryJob.key,
    primaryJob.name,
    primaryNan,
    primaryPasses,
    units,
    primaryArea,
  );
  const comparisonData = collectCombinedDataRows(
    runDir,
    comparisonJob.key,
    comparisonJob.name,
    comparisonNan,
    comparisonPasses,
    units,
    comparisonArea,
  );

  const { startYear, endYear } = getOverlapYears(primaryJob, comparisonJob);
  const primaryYearly = indexYearlyRows(
    aggregateYearlyCombinedRows(primaryData.combinedDataRows, primaryData.hasPostTransitionData),
    primaryData.hasPostTransitionData,
    startYear,
    endYear,
  );
  const comparisonYearly = indexYearlyRows(
    aggregateYearlyCombinedRows(comparisonData.combinedDataRows, comparisonData.hasPostTransitionData),
    comparisonData.hasPostTransitionData,
    startYear,
    endYear,
  );

  const years = Array.from(new Set([...primaryYearly.keys(), ...comparisonYearly.keys()])).sort(
    (a, b) => Number(a) - Number(b),
  );

  const unitsAbbreviation = unitsToAbbreviation(units);
  const slug = `${primaryJob.name}_vs_${comparisonJob.name}`;
  const header = buildInterleavedComparisonHeader(
    primaryJob.name,
    comparisonJob.name,
    unitsAbbreviation,
    "year",
    primaryData.hasPostTransitionData,
    comparisonData.hasPostTransitionData,
  ).join(",");

  const rows = years.map((year) => {
    const primaryValues = primaryYearly.get(year) || emptyRegionValues();
    const comparisonValues = comparisonYearly.get(year) || emptyRegionValues();
    return [
      year,
      ...buildInterleavedComparisonValues(
        primaryValues,
        comparisonValues,
        primaryData.hasPostTransitionData,
        comparisonData.hasPostTransitionData,
        "year",
        unitsAbbreviation,
      ),
    ].join(",");
  });

  return {
    filename: `${slug}_yearly_combined.csv`,
    content: [header, ...rows].join("\n"),
  };
};

const processComparisonFigureFiles = (archive, figureDirectory, pathPrefix = "", includeYearlyCombined = true) => {
  const prefix = pathPrefix ? `${pathPrefix}/` : "";
  const figureFiles = glob.sync(path.join(figureDirectory, "*.png"));
  figureFiles.forEach((file) => {
    const basename = path.basename(file);
    if (!includeYearlyCombined && basename.startsWith("yearly_combined_")) {
      return;
    }
    const archiveName = /^\d{4}_/.test(basename) ? `${prefix}${ANNUAL_ARCHIVE_DIR}/${basename}` : `${prefix}${basename}`;
    archive.file(file, { name: archiveName });
  });
};

const processComparisonReportFiles = (archive, figureDirectory, slug, pathPrefix = "") => {
  const prefix = pathPrefix ? `${pathPrefix}/` : "";
  const reportPath = path.join(figureDirectory, `${slug}_Report.pdf`);
  if (fs.existsSync(reportPath)) {
    archive.file(reportPath, { name: `${prefix}${slug}_Report.pdf` });
  }
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
  processComparisonFigureFiles,
  processComparisonReportFiles,
  processMonthlyNanFiles,
  processLandsatPassCounts,
  appendJobCsvsToArchive,
  buildMonthlyCombinedCsv,
  buildYearlyCombinedCsv,
  buildComparisonMonthlyCsv,
  buildComparisonYearlyCsv,
};
