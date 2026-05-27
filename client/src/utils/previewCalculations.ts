import { BASE_VARIABLE_DISPLAY_NAMES, DIFF_COLORMAP, ET_COLORMAP } from "./constants";
import { computeBinaryRasterOperation, PreviewGeoRaster } from "./previewGeoraster";

export type SourcePreviewVariable = "ET" | "PET" | "PPT" | "ET_MIN" | "ET_MAX" | "COUNT";

export type PreviewColormapKey = "et" | "diff";

const PREVIEW_COLORMAPS: Record<PreviewColormapKey, string[]> = {
  et: ET_COLORMAP,
  diff: DIFF_COLORMAP,
};

export interface PreviewCalculationDefinition<S extends readonly SourcePreviewVariable[]> {
  label: string;
  sources: S;
  colormap: PreviewColormapKey;
  compute: (sources: CalculationSources<S>) => PreviewGeoRaster;
}

type CalculationSources<S extends readonly SourcePreviewVariable[]> = {
  [K in S[number]]: PreviewGeoRaster;
};

const definePreviewCalculation = <S extends readonly SourcePreviewVariable[]>(
  definition: PreviewCalculationDefinition<S>
) => definition;

export const PREVIEW_CALCULATIONS = {
  ET_MINUS_PPT: definePreviewCalculation({
    label: "ET - PPT",
    sources: ["ET", "PPT"] as const,
    colormap: "diff",
    compute: ({ ET, PPT }) => computeBinaryRasterOperation(ET, PPT, (et, ppt) => et - ppt),
  }),
};

export type CalculatedPreviewVariable = keyof typeof PREVIEW_CALCULATIONS;

export type PreviewVariableType = SourcePreviewVariable | CalculatedPreviewVariable;

export const CALCULATED_PREVIEW_VARIABLES = Object.keys(
  PREVIEW_CALCULATIONS
) as CalculatedPreviewVariable[];

export const PRE_OPENET_VARIABLE_OPTIONS = ["ET", "PET", "PPT", ...CALCULATED_PREVIEW_VARIABLES] as const;
export const POST_OPENET_VARIABLE_OPTIONS = [
  "ET",
  "PET",
  "PPT",
  "ET_MIN",
  "ET_MAX",
  ...CALCULATED_PREVIEW_VARIABLES,
] as const;

export const VARIABLE_DISPLAY_NAMES = {
  ...BASE_VARIABLE_DISPLAY_NAMES,
  ...Object.fromEntries(
    CALCULATED_PREVIEW_VARIABLES.map((variable) => [variable, PREVIEW_CALCULATIONS[variable].label])
  ),
};

export const isCalculatedPreviewVariable = (
  variable: string | null | undefined
): variable is CalculatedPreviewVariable => !!variable && variable in PREVIEW_CALCULATIONS;

export const isSourcePreviewVariable = (
  variable: string | null | undefined
): variable is SourcePreviewVariable => !!variable && !isCalculatedPreviewVariable(variable);

export const getPreviewCalculation = (variable: CalculatedPreviewVariable) => PREVIEW_CALCULATIONS[variable];

export const getPreviewColormap = (variable: PreviewVariableType): string[] => {
  if (isCalculatedPreviewVariable(variable)) {
    return PREVIEW_COLORMAPS[getPreviewCalculation(variable).colormap];
  }
  return ET_COLORMAP;
};

export const getPreviewDisplayName = (variable: PreviewVariableType): string => {
  if (isCalculatedPreviewVariable(variable)) {
    return getPreviewCalculation(variable).label;
  }
  return BASE_VARIABLE_DISPLAY_NAMES[variable as keyof typeof BASE_VARIABLE_DISPLAY_NAMES] ?? variable;
};

export const computeCalculatedPreview = (
  variable: CalculatedPreviewVariable,
  sources: Partial<Record<SourcePreviewVariable, PreviewGeoRaster>>
): PreviewGeoRaster => {
  const calculation = getPreviewCalculation(variable);
  const inputs = Object.fromEntries(
    calculation.sources.map((source) => [source, sources[source]!])
  ) as CalculationSources<typeof calculation.sources>;

  return calculation.compute(inputs);
};
