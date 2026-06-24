const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const constants = require("../constants");

const DOCX_FILENAME = "et_tool_data_docs.docx";
const docxPath = path.join(constants.project_directory, "water_rights_visualizer", DOCX_FILENAME);

let cachedContent = null;
let cachedMtimeMs = null;

const loadDataDocs = async () => {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`Data documentation file not found: ${docxPath}`);
  }

  const { mtimeMs } = fs.statSync(docxPath);
  if (cachedContent && cachedMtimeMs === mtimeMs) {
    return cachedContent;
  }

  const result = await mammoth.convertToHtml({ path: docxPath });
  cachedContent = {
    html: result.value,
    source: DOCX_FILENAME,
    updatedAt: new Date(mtimeMs).toISOString(),
  };
  cachedMtimeMs = mtimeMs;

  if (result.messages.length > 0) {
    console.warn("Data docs conversion messages:", result.messages);
  }

  return cachedContent;
};

module.exports = { loadDataDocs };
