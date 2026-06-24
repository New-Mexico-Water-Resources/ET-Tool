import type { ColorScaleMode, ReportUnit } from "../components/CustomDownloadModal";

export type DefaultDownloadOption =
  | {
      id: string;
      label: string;
      type: "report";
      units: ReportUnit;
      etUnits: ReportUnit;
      pptUnits: ReportUnit;
      colorScale: ColorScaleMode;
      showMonthlyAverages: boolean;
      combinedYearlyTotals?: boolean;
    }
  | {
      id: string;
      label: string;
      type: "custom";
    };

export type DefaultDownloadOptionsConfig = {
  options: DefaultDownloadOption[];
};

export const FALLBACK_DEFAULT_DOWNLOAD_OPTIONS: DefaultDownloadOptionsConfig = {
  options: [
    {
      id: "metric-mm-month",
      label: "Report (mm/month)",
      type: "report",
      units: "metric",
      etUnits: "metric",
      pptUnits: "metric",
      colorScale: "across_years",
      showMonthlyAverages: false,
      combinedYearlyTotals: false,
    },
    {
      id: "imperial-in-month",
      label: "Report (in/month)",
      type: "report",
      units: "imperial",
      etUnits: "imperial",
      pptUnits: "imperial",
      colorScale: "across_years",
      showMonthlyAverages: false,
      combinedYearlyTotals: false,
    },
    {
      id: "acre-feet-month",
      label: "Report (acre-feet/month)",
      type: "report",
      units: "acre-feet",
      etUnits: "acre-feet",
      pptUnits: "acre-feet",
      colorScale: "across_years",
      showMonthlyAverages: false,
      combinedYearlyTotals: false,
    },
    {
      id: "custom",
      label: "Custom Download",
      type: "custom",
    },
  ],
};

export const getReportDownloadOptions = (config: DefaultDownloadOptionsConfig) =>
  config.options.filter((option): option is Extract<DefaultDownloadOption, { type: "report" }> => option.type === "report");

export const getReportMenuOptions = (config: DefaultDownloadOptionsConfig) =>
  config.options.filter((option) => option.type === "report" || option.type === "custom");
