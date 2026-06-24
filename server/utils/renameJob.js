const fs = require("fs");
const path = require("path");
const constants = require("../constants");

const OUTPUT_SUBDIRS = ["figures", "monthly_nan", "subset", "monthly", "monthly_means"];

const sanitizeJobName = (name) => String(name || "").replace(/[^a-zA-Z0-9_+. -]/g, "").trim();

const renamePathIfExists = (fromPath, toPath) => {
  if (!fs.existsSync(fromPath)) {
    return;
  }
  if (fs.existsSync(toPath)) {
    throw new Error(`Target path already exists: ${toPath}`);
  }
  fs.renameSync(fromPath, toPath);
};

const renameFilesContaining = (directory, oldName, newName) => {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory)) {
    if (!entry.includes(oldName)) {
      continue;
    }
    const fromPath = path.join(directory, entry);
    const toPath = path.join(directory, entry.split(oldName).join(newName));
    if (fromPath !== toPath) {
      renamePathIfExists(fromPath, toPath);
    }
  }
};

const renameJobFilesystem = (job, newName) => {
  const oldName = job.name;
  if (oldName === newName) {
    return;
  }

  const runDirectory = path.join(constants.run_directory_base, job.key);

  renamePathIfExists(
    path.join(runDirectory, `${oldName}.geojson`),
    path.join(runDirectory, `${newName}.geojson`),
  );

  for (const subdir of OUTPUT_SUBDIRS) {
    const parentDirectory = path.join(runDirectory, "output", subdir);
    const oldSubdir = path.join(parentDirectory, oldName);
    const newSubdir = path.join(parentDirectory, newName);
    renamePathIfExists(oldSubdir, newSubdir);
    renameFilesContaining(newSubdir, oldName, newName);
  }

  const configPath = path.join(runDirectory, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      config.name = newName;
      if (config.geojson_filename) {
        config.geojson_filename = config.geojson_filename.split(oldName).join(newName);
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.error(`Failed to update config.json for job ${job.key}`, error);
    }
  }
};

const buildRenamedJobFields = (job, newName) => {
  const runDirectory = path.join(constants.run_directory_base, job.key);
  return {
    name: newName,
    geo_json: path.join(runDirectory, `${newName}.geojson`),
    png_dir: path.join(runDirectory, "output", "figures", newName),
    csv_dir: path.join(runDirectory, "output", "monthly_nan", newName),
    subset_dir: path.join(runDirectory, "output", "subset", newName),
  };
};

module.exports = {
  sanitizeJobName,
  renameJobFilesystem,
  buildRenamedJobFields,
};
