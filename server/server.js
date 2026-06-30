require("log-timestamp");
const express = require("express");
const cors = require("cors");
const status = require("./routes/status");
const logs = require("./routes/logs");
const start_year = require("./routes/start_year");
const end_year = require("./routes/end_year");
const years_available = require("./routes/years_available");
const geojson = require("./routes/geojson");
const result = require("./routes/result");
const result_base64 = require("./routes/result_base64");
const download = require("./routes/download");
const start_run = require("./routes/start_run/start_run");
const runs = require("./routes/runs");
const prepare_geojson = require("./routes/prepare_geojson/prepare_geojson");
const queue = require("./routes/queue/queue");
const user = require("./routes/user");
const constants = require("./constants");
const admin = require("./routes/admin/admin");
const monthly_geojson = require("./routes/historical/monthly_geojson");
const drought_monitor = require("./routes/auxiliary/drought_monitor");
const cdl_year = require("./routes/auxiliary/cdl_year");
const custom_report = require("./routes/custom_report/custom_report");
const comparison_report = require("./routes/comparison_report/comparison_report");
const config = require("./routes/config");
const dataSourcesDocs = require("./routes/docs/data_sources");

const { auth } = require("express-oauth2-jwt-bearer");

const working_directory = process.cwd();
const run_directory_base = constants.run_directory_base;
const port = constants.port;

console.log(`starting server on port ${port}`);
console.log(`run directory: ${run_directory_base}`);
console.log(`working directory: ${working_directory}`);

const app = express();

app.use(cors());
app.use(express.json());

const basePath = "/api";

const verifyAuthToken = auth({
  audience: constants.auth0_audience,
  issuerBaseURL: constants.issuer_base_url,
  tokenSigningAlg: "RS256",
});

// Health check
app.get(`${basePath}/`, (req, res) => {
  res.status(200).send({
    message: "New Mexico Water Rights Visualizer API is running",
  });
});

app.use(`${basePath}/docs`, dataSourcesDocs);

app.use(`${basePath}/`, verifyAuthToken, user);
app.use(`${basePath}/`, verifyAuthToken, status);
app.use(`${basePath}/`, verifyAuthToken, logs);
app.use(`${basePath}/`, verifyAuthToken, start_year);
app.use(`${basePath}/`, verifyAuthToken, end_year);
app.use(`${basePath}/`, verifyAuthToken, years_available);
app.use(`${basePath}/`, verifyAuthToken, geojson);
app.use(`${basePath}/`, verifyAuthToken, result);
app.use(`${basePath}/`, verifyAuthToken, result_base64);
app.use(`${basePath}/`, verifyAuthToken, start_run);
app.use(`${basePath}/`, verifyAuthToken, runs);
app.use(`${basePath}/`, verifyAuthToken, download);
app.use(`${basePath}/custom-report`, verifyAuthToken, custom_report);
app.use(`${basePath}/comparison-report`, verifyAuthToken, comparison_report);
app.use(`${basePath}/historical`, verifyAuthToken, monthly_geojson);
app.use(`${basePath}/auxiliary`, verifyAuthToken, drought_monitor);
app.use(`${basePath}/auxiliary`, verifyAuthToken, cdl_year);
app.use(`${basePath}/queue`, verifyAuthToken, queue);
app.use(`${basePath}/config`, verifyAuthToken, config);
app.post(`${basePath}/prepare_geojson`, prepare_geojson.upload.single("file"), prepare_geojson.prepareGeojson);

app.use(`${basePath}/admin`, verifyAuthToken, admin);

app.use((err, req, res, next) => {
  console.error("Error:", err.message, "Endpoint:", req.originalUrl);
  if (err.status === 401 || err.status === 403) {
    res.status(err.status).json({ error: "Unauthorized access" });
  } else {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}${basePath}`);
});
