import { FC, useMemo } from "react";
import chroma from "chroma-js";

interface ColorScaleProps {
  maxValue: number;
  minValue: number;
  colorScale: string[];
  style?: React.CSSProperties;
}

const ColorScale: FC<ColorScaleProps> = ({ maxValue, minValue, colorScale, style }) => {
  const numberOfSteps = 100;
  const colors = useMemo(() => {
    return chroma.scale(colorScale).colors(numberOfSteps).reverse();
  }, [numberOfSteps, colorScale]);

  return (
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
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          width: "26px",
          justifyContent: "center",
          padding: "4px 8px",
          background: "white",
          color: "var(--st-gray-80)",
          fontWeight: "bold",
        }}
      >
        {maxValue}
      </div>
      <div style={{ borderRadius: "8px", overflow: "hidden", background: "white" }}>
        {colors.map((value, index) => (
          <div
            key={index}
            style={{
              width: "26px",
              height: `calc(200px / ${colors.length})`,
              backgroundColor: value,
            }}
          ></div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          width: "26px",
          justifyContent: "center",
          padding: "4px 8px",
          background: "white",
          color: "var(--st-gray-80)",
          fontWeight: "bold",
        }}
      >
        {minValue}
      </div>
    </div>
  );
};

export default ColorScale;
