const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const parseGeoraster = require("georaster");
const { applyPreviewPolygonClip, isNoData, NODATA_THRESHOLD } = require("./previewClip");

const WRITE_SCRIPT = path.join(__dirname, "writeGeotiff.py");
const MM_PER_INCH = 25.4;

const MONTHLY_VARIABLES = ["ET", "PET"];
const SOURCE_VARIABLES = ["ET", "ET_MIN", "ET_MAX", "PET", "COUNT", "PPT"];
const CLIP_MODES = ["inclusive", "exclusive", "inverse"];

const CALCULATED_VARIABLES = {
  ET_MINUS_PPT: {
    sources: ["ET", "PPT"],
    compute: (sources) => computeDifference(sources.ET, sources.PPT),
  },
};

const ALL_VARIABLES = [...SOURCE_VARIABLES, ...Object.keys(CALCULATED_VARIABLES)];

const isCalculatedVariable = (variable) => Object.hasOwn(CALCULATED_VARIABLES, variable);

const parseExportOptions = (query) => {
  const clip = query.clip === "true" || query.clipToPolygon === "true";
  const clipMode = CLIP_MODES.includes(query.clipMode) ? query.clipMode : "inclusive";
  const units = query.units === "inches" ? "inches" : "mm";

  return { clip, clipMode, units };
};

const needsExport = ({ variable, clip, units }) =>
  isCalculatedVariable(variable) || clip || units === "inches";

const getGeotiffPath = (runDirectoryBase, job, month, year, variable) => {
  const monthNum = parseInt(month, 10);
  const yearNum = parseInt(year, 10);
  const runDirectory = path.join(runDirectoryBase, job.key);
  const monthlyJobDir = path.join(runDirectory, "output", "monthly", job.name);
  const subsetJobDir = path.join(runDirectory, "output", "subset", job.name);

  if (MONTHLY_VARIABLES.includes(variable)) {
    const date = `${yearNum}_${String(monthNum).padStart(2, "0")}`;
    return path.join(monthlyJobDir, `${date}_${job.name}_${variable}_monthly_sum.tif`);
  }

  const date = `${yearNum}.${String(monthNum).padStart(2, "0")}.01`;
  return path.join(subsetJobDir, `${date}_${job.name}_${variable}_subset.tif`);
};

const geotiffExists = (runDirectoryBase, job, month, year, variable) => {
  const filePath = getGeotiffPath(runDirectoryBase, job, month, year, variable);
  return fs.existsSync(filePath) ? filePath : null;
};

const listJobGeotiffs = (runDirectoryBase, job) => {
  const runDirectory = path.join(runDirectoryBase, job.key);
  const monthlyJobDir = path.join(runDirectory, "output", "monthly", job.name);
  const subsetJobDir = path.join(runDirectory, "output", "subset", job.name);

  const collect = (directory, postfix, variables) => {
    if (!fs.existsSync(directory)) {
      return [];
    }

    return fs.readdirSync(directory).flatMap((file) => {
      const variable = variables.find((name) => file.endsWith(`${name}_${postfix}.tif`));
      if (!variable) {
        return [];
      }
      return [{ filePath: path.join(directory, file), archiveName: `${variable}/${file}` }];
    });
  };

  return [
    ...collect(monthlyJobDir, "monthly_sum", ["ET", "PET"]),
    ...collect(subsetJobDir, "subset", ["ET_MIN", "ET_MAX", "PPT"]),
  ];
};

const loadJobGeojson = (runDirectoryBase, job) => {
  const geojsonPath = path.join(runDirectoryBase, job.key, `${job.name}.geojson`);
  if (!fs.existsSync(geojsonPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(geojsonPath, "utf8"));
};

const loadGeoraster = async (filePath) => {
  const nodeBuffer = fs.readFileSync(filePath);
  const buffer = Uint8Array.from(nodeBuffer).buffer;
  return parseGeoraster(buffer.slice(0));
};

const computeDifference = (a, b) => {
  const values = a.values[0].map((row, y) =>
    row.map((left, x) => {
      const right = b.values[0][y][x];
      if (isNoData(left) || isNoData(right)) {
        return NODATA_THRESHOLD;
      }
      return left - right;
    })
  );

  let minValue = Infinity;
  let maxValue = -Infinity;
  for (const row of values) {
    for (const value of row) {
      if (!isNoData(value)) {
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }
    }
  }

  if (!Number.isFinite(minValue)) {
    minValue = 0;
    maxValue = 0;
  }

  return { ...a, values: [values], mins: [minValue], maxs: [maxValue] };
};

const applyUnits = (georaster, units) => {
  if (units !== "inches") {
    return georaster;
  }

  const values = georaster.values[0].map((row) =>
    row.map((value) => (isNoData(value) ? value : value / MM_PER_INCH))
  );

  let minValue = Infinity;
  let maxValue = -Infinity;
  for (const row of values) {
    for (const value of row) {
      if (!isNoData(value)) {
        minValue = Math.min(minValue, value);
        maxValue = Math.max(maxValue, value);
      }
    }
  }

  if (!Number.isFinite(minValue)) {
    return { ...georaster, values: [values] };
  }

  return { ...georaster, values: [values], mins: [minValue], maxs: [maxValue] };
};

const flattenToFloat64Buffer = (georaster) => {
  const rows = georaster.values[0];
  const flat = new Float64Array(georaster.width * georaster.height);
  let index = 0;

  for (let y = 0; y < georaster.height; y++) {
    for (let x = 0; x < georaster.width; x++) {
      flat[index++] = rows[y][x];
    }
  }

  return Buffer.from(flat.buffer);
};

const runWriteGeotiff = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn("python3", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `python3 exited with code ${code}`));
        return;
      }
      resolve();
    });
  });

const writeGeorasterBuffer = async (georaster, sourcePath, { crop }) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "et-geotiff-"));
  const binPath = path.join(tmpDir, "pixels.bin");
  const outPath = path.join(tmpDir, "output.tif");

  try {
    fs.writeFileSync(binPath, flattenToFloat64Buffer(georaster));

    const args = [WRITE_SCRIPT, sourcePath, outPath, binPath, String(georaster.width), String(georaster.height)];
    if (!crop) {
      args.push("full");
    }

    await runWriteGeotiff(args);
    return fs.readFileSync(outPath);
  } catch (error) {
    throw new Error(`Failed to write GeoTIFF (${path.basename(sourcePath)}): ${error.message}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};

const loadVariableGeoraster = async (runDirectoryBase, job, month, year, variable) => {
  if (isCalculatedVariable(variable)) {
    const { sources, compute } = CALCULATED_VARIABLES[variable];
    const loaded = {};

    for (const sourceVariable of sources) {
      const filePath = geotiffExists(runDirectoryBase, job, month, year, sourceVariable);
      if (!filePath) {
        throw new Error(`Geotiff not found for source variable ${sourceVariable}`);
      }
      loaded[sourceVariable] = await loadGeoraster(filePath);
    }

    return {
      georaster: compute(loaded),
      sourcePath: geotiffExists(runDirectoryBase, job, month, year, sources[0]),
    };
  }

  const sourcePath = geotiffExists(runDirectoryBase, job, month, year, variable);
  if (!sourcePath) {
    throw new Error(`Geotiff not found for variable ${variable}`);
  }

  return { georaster: await loadGeoraster(sourcePath), sourcePath };
};

const exportGeotiff = async ({
  runDirectoryBase,
  job,
  month,
  year,
  variable,
  geojson,
  clip,
  clipMode,
  units,
}) => {
  const { georaster, sourcePath } = await loadVariableGeoraster(runDirectoryBase, job, month, year, variable);

  let raster = georaster;
  if (clip && geojson) {
    raster = applyPreviewPolygonClip(raster, geojson, clipMode);
  }

  raster = applyUnits(raster, units);

  return writeGeorasterBuffer(raster, sourcePath, { crop: Boolean(clip && geojson) });
};

const exportGeotiffFromFile = async (filePath, geojson, { clipMode = "inclusive", units = "mm" } = {}) => {
  const raster = await loadGeoraster(filePath);
  const clipped = applyPreviewPolygonClip(raster, geojson, clipMode);
  const converted = applyUnits(clipped, units);
  return writeGeorasterBuffer(converted, filePath, { crop: true });
};

const getVariableSources = (variable) =>
  isCalculatedVariable(variable) ? CALCULATED_VARIABLES[variable].sources : [variable];

module.exports = {
  ALL_VARIABLES,
  SOURCE_VARIABLES,
  isCalculatedVariable,
  getVariableSources,
  parseExportOptions,
  needsExport,
  getGeotiffPath,
  geotiffExists,
  listJobGeotiffs,
  loadJobGeojson,
  exportGeotiff,
  exportGeotiffFromFile,
};
