import { FC, useMemo } from "react";
import chroma from "chroma-js";
import { Tooltip } from "@mui/material";

interface ColorScaleProps {
  maxValue: number;
  minValue: number;
  colorScale: string[];
  label?: string;
  style?: React.CSSProperties;
}

const ColorScale: FC<ColorScaleProps> = ({ maxValue, minValue, colorScale, label, style }) => {
  const numberOfSteps = 100;
  const colors = useMemo(() => {
    return chroma.scale(colorScale).colors(numberOfSteps).reverse();
  }, [numberOfSteps, colorScale]);

  const formattedMaxValue = useMemo(() => {
    if (maxValue > 9999) {
      return maxValue.toExponential(2).toLocaleString();
    } else if (maxValue > 1) {
      return Math.round(maxValue).toLocaleString();
    } else if (Math.abs(maxValue) < 1) {
      return maxValue.toFixed(2).toLocaleString();
    } else {
      return maxValue.toLocaleString();
    }
  }, [maxValue]);
  const formattedMinValue = useMemo(() => {
    if (minValue > 9999) {
      return minValue.toExponential(2).toLocaleString();
    } else if (minValue > 1) {
      return Math.round(minValue).toLocaleString();
    } else if (Math.abs(minValue) < 1) {
      return minValue.toFixed(2).toLocaleString();
    } else {
      return minValue.toLocaleString();
    }
  }, [minValue]);

  const minScaleWidth = useMemo(() => {
    const maxCharacterLength = Math.max(Math.max(formattedMaxValue.length, formattedMinValue.length), 3);

    return `${maxCharacterLength}ch`;
  }, [formattedMaxValue, formattedMinValue]);

  return (
    <Tooltip title={label}>
      <div
        style={{
          position: "absolute",
          top: "12px",
          right: "50px",
          zIndex: 1000,
          borderRadius: "8px",
          overflow: "hidden",
          border: "4px solid white",
          background: "white",
          cursor: "default",
          ...style,
        }}
      >
        <div
          style={{
            display: "flex",
            width: minScaleWidth,
            justifyContent: "center",
            padding: "4px 8px",
            background: "white",
            color: "var(--st-gray-80)",
            fontWeight: "bold",
          }}
        >
          {formattedMaxValue}
        </div>
        <div style={{ borderRadius: "8px", overflow: "hidden", background: "white" }}>
          {colors.map((value, index) => (
            <div
              key={index}
              style={{
                width: minScaleWidth,
                height: `calc(200px / ${colors.length})`,
                backgroundColor: value,
              }}
            ></div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            width: minScaleWidth,
            justifyContent: "center",
            padding: "4px 8px",
            background: "white",
            color: "var(--st-gray-80)",
            fontWeight: "bold",
          }}
        >
          {formattedMinValue}
        </div>
      </div>
    </Tooltip>
  );
};

export default ColorScale;
