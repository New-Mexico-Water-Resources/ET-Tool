import { FC, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import AddIcon from "@mui/icons-material/Add";
import useStore from "../utils/store";
import { collectExistingUploadShapes } from "../utils/uploadShapes";

const AddUploadShapes: FC = () => {
  const ingestUploadFile = useStore((state) => state.ingestUploadFile);
  const hasShapes = useStore((state) => collectExistingUploadShapes(state).length > 0);

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      acceptedFiles.forEach((file) => {
        void ingestUploadFile(file);
      });
    },
    [ingestUploadFile]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    accept: {
      "application/zip": [".zip"],
      "application/json": [".geojson"],
      "application/vnd.google-earth.kml+xml": [".kml"],
    },
  });

  if (!hasShapes) {
    return null;
  }

  return (
    <div className="dropzone-container dropzone-container--compact add-shapes-dropzone-container">
      <div className={`dropzone-area ${isDragActive ? "drag-active" : ""}`} {...getRootProps()}>
        <input {...getInputProps()} />
        <p style={{ color: "var(--st-gray-40)", textAlign: "center", margin: 0, fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <AddIcon style={{ color: "var(--st-gray-40)", marginRight: "4px" }} />
          Drag & drop or draw to add another shape
        </p>
      </div>
    </div>
  );
};

export default AddUploadShapes;
