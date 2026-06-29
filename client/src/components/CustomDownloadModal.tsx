import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  Menu,
  MenuItem,
  Modal,
  Radio,
  RadioGroup,
  Select,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import RefreshIcon from "@mui/icons-material/Refresh";
import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type MouseEvent } from "react";
import { API_URL } from "../utils/constants";
import { COMPARISON_REPORT_PREVIEW_VERSION, CUSTOM_REPORT_PREVIEW_VERSION } from "../utils/customReportPreview";
import useStore from "../utils/store";
import { type QueueJob } from "../utils/jobGroups";
import ComparisonJobPicker from "./ComparisonJobPicker";
import "../scss/CustomDownloadModal.scss";

export type ReportUnit = "metric" | "imperial" | "acre-feet";
export type ColorScaleMode = "across_years" | "per_year" | "custom";
export type MapTileMode = "yearly_total" | "month" | "winter" | "spring" | "summer" | "fall";
export type CustomDownloadModalMode = "custom" | "comparison";

type ComparisonScaleBounds = ReportScaleBounds;

type ScaleBoundsGroup = {
  across_years: { min: number | null; max: number | null };
  per_year: { min: number | null; max: number | null };
};

type ReportScaleBounds = {
  map: ScaleBoundsGroup;
  et_eto: ScaleBoundsGroup;
  ppt: ScaleBoundsGroup;
};

const SCALE_RADIO_OPTIONS: { value: ColorScaleMode; label: string }[] = [
  { value: "across_years", label: "Same scale across all years" },
  { value: "per_year", label: "Dynamic scale per year" },
  { value: "custom", label: "Custom range" },
];

const getScaleModeLabel = (scale: ColorScaleMode) =>
  SCALE_RADIO_OPTIONS.find((option) => option.value === scale)?.label ?? scale;

const UNIT_OPTIONS: { value: ReportUnit; label: string }[] = [
  { value: "metric", label: "mm/month" },
  { value: "imperial", label: "in/month" },
  { value: "acre-feet", label: "acre-ft/month" },
];

const UNIT_ABBREVIATIONS: Record<ReportUnit, string> = {
  metric: "mm",
  imperial: "in",
  "acre-feet": "AF",
};

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index, 1).toLocaleString("en-US", { month: "long" }),
}));

const formatBound = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) {
    return "";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(2)));
};

const getScaleBoundsForMode = (bounds: ScaleBoundsGroup, sourceMode: ColorScaleMode) => {
  if (sourceMode === "per_year") {
    return bounds.per_year;
  }
  return bounds.across_years;
};

const getCustomDefaultsFromBounds = (bounds: ScaleBoundsGroup, sourceMode: ColorScaleMode) => {
  const source = getScaleBoundsForMode(bounds, sourceMode);
  if (source.min == null || source.max == null) {
    return null;
  }
  return {
    min: formatBound(source.min),
    max: formatBound(source.max),
  };
};

const appendCustomScaleParams = (
  params: URLSearchParams,
  scaleKey: string,
  minKey: string,
  maxKey: string,
  scale: ColorScaleMode,
  customMin: string,
  customMax: string,
) => {
  params.set(scaleKey, scale);
  if (scale === "custom") {
    if (customMin.trim()) {
      params.set(minKey, customMin.trim());
    }
    if (customMax.trim()) {
      params.set(maxKey, customMax.trim());
    }
  }
};

const readAxiosError = async (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error) && error.response?.data) {
    const data = error.response.data;
    if (data instanceof Blob) {
      const text = await data.text();
      return text.trim() || fallback;
    }
    if (typeof data === "string") {
      return data;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
};

const buildPreviewParams = ({
  jobKey,
  previewPage,
  etUnits,
  pptUnits,
  colorScale,
  etCustomMin,
  etCustomMax,
  etEtoScale,
  etEtoCustomMin,
  etEtoCustomMax,
  pptScale,
  pptCustomMin,
  pptCustomMax,
  showMonthlyAverages,
  forceRefresh = false,
}: {
  jobKey: string;
  previewPage: string;
  etUnits: ReportUnit;
  pptUnits: ReportUnit;
  colorScale: ColorScaleMode;
  etCustomMin: string;
  etCustomMax: string;
  etEtoScale: ColorScaleMode;
  etEtoCustomMin: string;
  etEtoCustomMax: string;
  pptScale: ColorScaleMode;
  pptCustomMin: string;
  pptCustomMax: string;
  showMonthlyAverages: boolean;
  forceRefresh?: boolean;
}) => {
  const params = new URLSearchParams({
    key: jobKey,
    etUnits,
    pptUnits,
    showMonthlyAverages: String(showMonthlyAverages),
    previewVersion: String(CUSTOM_REPORT_PREVIEW_VERSION),
  });

  if (forceRefresh) {
    params.set("refresh", "true");
    params.set("_t", String(Date.now()));
  }

  appendCustomScaleParams(params, "colorScale", "etCustomMin", "etCustomMax", colorScale, etCustomMin, etCustomMax);
  appendCustomScaleParams(
    params,
    "etEtoScale",
    "etEtoCustomMin",
    "etEtoCustomMax",
    etEtoScale,
    etEtoCustomMin,
    etEtoCustomMax,
  );
  appendCustomScaleParams(params, "pptScale", "pptCustomMin", "pptCustomMax", pptScale, pptCustomMin, pptCustomMax);

  if (previewPage.startsWith("year:")) {
    params.set("previewKind", "year");
    params.set("year", previewPage.replace("year:", ""));
  } else if (previewPage === "summary") {
    params.set("previewKind", "summary");
  } else if (previewPage === "yearly-combined") {
    params.set("previewKind", "yearly_combined");
  } else if (previewPage.startsWith("documentation:")) {
    params.set("previewKind", "documentation");
    params.set("previewPage", previewPage.replace("documentation:", ""));
  }

  return params;
};

const buildComparisonPreviewParams = ({
  jobKey,
  comparisonJobKey,
  previewPage,
  etUnits,
  pptUnits,
  etEtoScale,
  etEtoCustomMin,
  etEtoCustomMax,
  pptScale,
  pptCustomMin,
  pptCustomMax,
  mapTileMode,
  mapTileMonth,
  colorScale,
  etCustomMin,
  etCustomMax,
  forceRefresh = false,
}: {
  jobKey: string;
  comparisonJobKey: string;
  previewPage: string;
  etUnits: ReportUnit;
  pptUnits: ReportUnit;
  etEtoScale: ColorScaleMode;
  etEtoCustomMin: string;
  etEtoCustomMax: string;
  pptScale: ColorScaleMode;
  pptCustomMin: string;
  pptCustomMax: string;
  mapTileMode: MapTileMode;
  mapTileMonth: number;
  colorScale: ColorScaleMode;
  etCustomMin: string;
  etCustomMax: string;
  forceRefresh?: boolean;
}) => {
  const params = new URLSearchParams({
    key: jobKey,
    comparisonKey: comparisonJobKey,
    etUnits,
    pptUnits,
    mapTileMode,
    mapTileMonth: String(mapTileMonth),
    previewVersion: String(COMPARISON_REPORT_PREVIEW_VERSION),
  });

  if (forceRefresh) {
    params.set("refresh", "true");
    params.set("_t", String(Date.now()));
  }

  appendCustomScaleParams(params, "colorScale", "etCustomMin", "etCustomMax", colorScale, etCustomMin, etCustomMax);
  appendCustomScaleParams(
    params,
    "etEtoScale",
    "etEtoCustomMin",
    "etEtoCustomMax",
    etEtoScale,
    etEtoCustomMin,
    etEtoCustomMax,
  );
  appendCustomScaleParams(params, "pptScale", "pptCustomMin", "pptCustomMax", pptScale, pptCustomMin, pptCustomMax);

  if (previewPage.startsWith("year:")) {
    params.set("previewKind", "year");
    params.set("year", previewPage.replace("year:", ""));
  } else if (previewPage === "summary") {
    params.set("previewKind", "summary");
  } else if (previewPage === "yearly-combined") {
    params.set("previewKind", "yearly_combined");
  }

  return params;
};

const buildComparisonDownloadParams = ({
  jobKey,
  comparisonJobKey,
  etUnits,
  pptUnits,
  etEtoScale,
  etEtoCustomMin,
  etEtoCustomMax,
  pptScale,
  pptCustomMin,
  pptCustomMax,
  includeYearlyCombined,
  previewPage,
  mapTileMode,
  mapTileMonth,
  colorScale,
  etCustomMin,
  etCustomMax,
}: {
  jobKey: string;
  comparisonJobKey: string;
  etUnits: ReportUnit;
  pptUnits: ReportUnit;
  etEtoScale: ColorScaleMode;
  etEtoCustomMin: string;
  etEtoCustomMax: string;
  pptScale: ColorScaleMode;
  pptCustomMin: string;
  pptCustomMax: string;
  includeYearlyCombined: boolean;
  previewPage?: string;
  mapTileMode: MapTileMode;
  mapTileMonth: number;
  colorScale: ColorScaleMode;
  etCustomMin: string;
  etCustomMax: string;
}) => {
  const params = new URLSearchParams({
    key: jobKey,
    comparisonKey: comparisonJobKey,
    etUnits,
    pptUnits,
    includeYearlyCombined: String(includeYearlyCombined),
    mapTileMode,
    mapTileMonth: String(mapTileMonth),
  });

  appendCustomScaleParams(params, "colorScale", "etCustomMin", "etCustomMax", colorScale, etCustomMin, etCustomMax);
  appendCustomScaleParams(
    params,
    "etEtoScale",
    "etEtoCustomMin",
    "etEtoCustomMax",
    etEtoScale,
    etEtoCustomMin,
    etEtoCustomMax,
  );
  appendCustomScaleParams(params, "pptScale", "pptCustomMin", "pptCustomMax", pptScale, pptCustomMin, pptCustomMax);

  if (previewPage) {
    params.set("previewPage", previewPage);
    params.set("previewVersion", String(COMPARISON_REPORT_PREVIEW_VERSION));
  }

  return params;
};

const getComparisonDownloadFilename = (
  primaryName: string,
  comparisonName: string,
  target: CustomDownloadTarget,
  previewPage: string,
) => {
  const slug = `${primaryName}_vs_${comparisonName}`;
  if (target === "pdf") {
    return `${slug}_comparison_report.pdf`;
  }
  if (target === "csv-monthly") {
    return `${slug}_combined.csv`;
  }
  if (target === "csv-yearly") {
    return `${slug}_yearly_combined.csv`;
  }
  if (target === "zip") {
    return `${slug}_comparison_report.zip`;
  }
  if (previewPage.startsWith("year:")) {
    return `${slug}_${previewPage.replace("year:", "")}_comparison.png`;
  }
  if (previewPage === "summary") {
    return `${slug}_summary_comparison.png`;
  }
  if (previewPage === "yearly-combined") {
    return `${slug}_yearly_combined_comparison.png`;
  }
  return `${slug}_comparison_preview.png`;
};

const getOverlappingYears = (primaryJob: QueueJob, comparisonJob: QueueJob | null) => {
  if (
    comparisonJob?.start_year == null ||
    comparisonJob?.end_year == null ||
    primaryJob.start_year == null ||
    primaryJob.end_year == null
  ) {
    return [];
  }
  const startYear = Math.max(primaryJob.start_year, comparisonJob.start_year);
  const endYear = Math.min(primaryJob.end_year, comparisonJob.end_year);
  if (startYear > endYear) {
    return [];
  }
  const years: number[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    years.push(year);
  }
  return years;
};

type CustomDownloadTarget = "pdf" | "page" | "csv-monthly" | "csv-yearly" | "zip";

const getPreviewPageDownloadName = (jobName: string, previewPage: string) => {
  if (previewPage.startsWith("year:")) {
    return `${jobName}_${previewPage.replace("year:", "")}_report.png`;
  }
  if (previewPage === "summary") {
    return `${jobName}_summary.png`;
  }
  if (previewPage === "yearly-combined") {
    return `${jobName}_yearly_combined.png`;
  }
  if (previewPage.startsWith("documentation:")) {
    return `${jobName}_documentation_page_${previewPage.replace("documentation:", "")}.png`;
  }
  return `${jobName}_preview.png`;
};

const buildCustomDownloadParams = ({
  jobKey,
  etUnits,
  pptUnits,
  colorScale,
  etCustomMin,
  etCustomMax,
  etEtoScale,
  etEtoCustomMin,
  etEtoCustomMax,
  pptScale,
  pptCustomMin,
  pptCustomMax,
  showMonthlyAverages,
  includeYearlyCombined,
  previewPage,
}: {
  jobKey: string;
  etUnits: ReportUnit;
  pptUnits: ReportUnit;
  colorScale: ColorScaleMode;
  etCustomMin: string;
  etCustomMax: string;
  etEtoScale: ColorScaleMode;
  etEtoCustomMin: string;
  etEtoCustomMax: string;
  pptScale: ColorScaleMode;
  pptCustomMin: string;
  pptCustomMax: string;
  showMonthlyAverages: boolean;
  includeYearlyCombined: boolean;
  previewPage?: string;
}) => {
  const params = new URLSearchParams({
    key: jobKey,
    etUnits,
    pptUnits,
    showMonthlyAverages: String(showMonthlyAverages),
    includeYearlyCombined: String(includeYearlyCombined),
  });

  appendCustomScaleParams(params, "colorScale", "etCustomMin", "etCustomMax", colorScale, etCustomMin, etCustomMax);
  appendCustomScaleParams(
    params,
    "etEtoScale",
    "etEtoCustomMin",
    "etEtoCustomMax",
    etEtoScale,
    etEtoCustomMin,
    etEtoCustomMax,
  );
  appendCustomScaleParams(params, "pptScale", "pptCustomMin", "pptCustomMax", pptScale, pptCustomMin, pptCustomMax);

  if (previewPage) {
    params.set("previewPage", previewPage);
    params.set("previewVersion", String(CUSTOM_REPORT_PREVIEW_VERSION));
  }

  return params;
};

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
};

const getPreviewAspectClass = (previewPage: string) => {
  if (previewPage === "summary" || previewPage === "yearly-combined") {
    return "custom-download-modal__preview-frame--landscape";
  }
  return "custom-download-modal__preview-frame--portrait";
};

type ScaleControlsSectionProps = {
  label: string;
  scale: ColorScaleMode;
  customMin: string;
  customMax: string;
  bounds: ScaleBoundsGroup | null;
  unitAbbreviation: string;
  onScaleChange: (nextScale: ColorScaleMode) => void;
  onCustomMinChange: (value: string) => void;
  onCustomMaxChange: (value: string) => void;
};

const ScaleControlsSection = ({
  label,
  scale,
  customMin,
  customMax,
  bounds,
  unitAbbreviation,
  onScaleChange,
  onCustomMinChange,
  onCustomMaxChange,
}: ScaleControlsSectionProps) => {
  const customRangeSelected = scale === "custom";
  const displayedMin = useMemo(() => {
    if (customRangeSelected) {
      return customMin;
    }
    if (!bounds) {
      return "";
    }
    return formatBound(getScaleBoundsForMode(bounds, scale).min);
  }, [bounds, customMin, customRangeSelected, scale]);

  const displayedMax = useMemo(() => {
    if (customRangeSelected) {
      return customMax;
    }
    if (!bounds) {
      return "";
    }
    return formatBound(getScaleBoundsForMode(bounds, scale).max);
  }, [bounds, customMax, customRangeSelected, scale]);

  const summaryValue = useMemo(() => {
    if (!customRangeSelected) {
      return getScaleModeLabel(scale);
    }
    if (displayedMin.trim() && displayedMax.trim()) {
      return `Custom range (min: ${displayedMin.trim()} max: ${displayedMax.trim()})`;
    }
    return "Custom range";
  }, [customRangeSelected, displayedMax, displayedMin, scale]);

  return (
    <Accordion disableGutters elevation={0} className="custom-download-modal__scale-accordion">
      <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />}>
        <Box className="custom-download-modal__scale-accordion-summary">
          <Typography variant="body2" className="custom-download-modal__scale-accordion-title">
            {label}
          </Typography>
          <Typography variant="caption" className="custom-download-modal__scale-accordion-value">
            {summaryValue}
          </Typography>
        </Box>
      </AccordionSummary>
      <AccordionDetails className="custom-download-modal__scale-accordion-details">
        <FormControl>
          <RadioGroup value={scale} onChange={(event) => onScaleChange(event.target.value as ColorScaleMode)}>
            {SCALE_RADIO_OPTIONS.map((option) => (
              <FormControlLabel
                key={option.value}
                value={option.value}
                control={<Radio size="small" />}
                label={option.label}
              />
            ))}
          </RadioGroup>
        </FormControl>

        <Box className="custom-download-modal__custom-range">
          <TextField
            size="small"
            label={`Min (${unitAbbreviation})`}
            value={displayedMin}
            onChange={(event) => onCustomMinChange(event.target.value)}
            disabled={!customRangeSelected}
            fullWidth
          />
          <TextField
            size="small"
            label={`Max (${unitAbbreviation})`}
            value={displayedMax}
            onChange={(event) => onCustomMaxChange(event.target.value)}
            disabled={!customRangeSelected}
            fullWidth
          />
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};

const CustomDownloadModal = () => {
  const job = useStore((state) => state.customDownloadJob);
  const queue = useStore((state) => state.queue);
  const backlog = useStore((state) => state.backlog);
  const onClose = useStore((state) => state.closeCustomDownload);
  const authAxios = useStore((state) => state.authAxios);
  const setErrorMessage = useStore((state) => state.setErrorMessage);

  const [modalMode, setModalMode] = useState<CustomDownloadModalMode>("custom");
  const [comparisonJobKey, setComparisonJobKey] = useState("");

  const [etUnits, setEtUnits] = useState<ReportUnit>("metric");
  const [pptUnits, setPptUnits] = useState<ReportUnit>("metric");
  const [colorScale, setColorScale] = useState<ColorScaleMode>("across_years");
  const [etCustomMin, setEtCustomMin] = useState("");
  const [etCustomMax, setEtCustomMax] = useState("");
  const [etEtoScale, setEtEtoScale] = useState<ColorScaleMode>("across_years");
  const [etEtoCustomMin, setEtEtoCustomMin] = useState("");
  const [etEtoCustomMax, setEtEtoCustomMax] = useState("");
  const [pptScale, setPptScale] = useState<ColorScaleMode>("across_years");
  const [pptCustomMin, setPptCustomMin] = useState("");
  const [pptCustomMax, setPptCustomMax] = useState("");
  const [showMonthlyAverages, setShowMonthlyAverages] = useState(false);
  const [mapTileMode, setMapTileMode] = useState<MapTileMode>("yearly_total");
  const [mapTileMonth, setMapTileMonth] = useState(1);
  const [includeYearlyCombined, setIncludeYearlyCombined] = useState(false);
  const [previewPage, setPreviewPage] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadMenuAnchor, setDownloadMenuAnchor] = useState<null | HTMLElement>(null);
  const [scaleBounds, setScaleBounds] = useState<ReportScaleBounds | null>(null);

  const loadedPreviewKeyRef = useRef<string | null>(null);
  const deferMapCustomPreviewRef = useRef(false);
  const deferEtEtoCustomPreviewRef = useRef(false);
  const deferPptCustomPreviewRef = useRef(false);
  const previousMapScaleRef = useRef<ColorScaleMode>("across_years");
  const previousEtEtoScaleRef = useRef<ColorScaleMode>("across_years");
  const previousPptScaleRef = useRef<ColorScaleMode>("across_years");
  const scaleBoundsRef = useRef<ReportScaleBounds | null>(null);
  const pendingMapCustomDefaultsRef = useRef(false);
  const pendingEtEtoCustomDefaultsRef = useRef(false);
  const pendingPptCustomDefaultsRef = useRef(false);

  const open = job != null;
  const isComparisonMode = modalMode === "comparison";

  const comparisonJobOptions = useMemo(() => {
    if (!job) {
      return [];
    }
    const candidates = [...queue, ...backlog].filter(
      (candidate) =>
        candidate.key !== job.key &&
        candidate.status === "Complete" &&
        candidate.start_year != null &&
        candidate.end_year != null,
    );
    const uniqueJobs = new Map<string, QueueJob>();
    for (const candidate of candidates) {
      uniqueJobs.set(candidate.key, candidate);
    }
    return Array.from(uniqueJobs.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [backlog, job, queue]);

  const selectedComparisonJob = useMemo(
    () => comparisonJobOptions.find((candidate) => candidate.key === comparisonJobKey) ?? null,
    [comparisonJobKey, comparisonJobOptions],
  );

  const yearOptions = useMemo(() => {
    if (!job?.start_year || !job?.end_year) {
      return [];
    }
    if (isComparisonMode) {
      return getOverlappingYears(job, selectedComparisonJob);
    }
    const years: number[] = [];
    for (let year = job.start_year; year <= job.end_year; year += 1) {
      years.push(year);
    }
    return years;
  }, [isComparisonMode, job, selectedComparisonJob]);

  const previewPageOptions = useMemo(() => {
    const options = yearOptions.map((year) => ({
      value: `year:${year}`,
      label: `${year} Report`,
    }));
    options.push({ value: "summary", label: "Summary" });
    if (includeYearlyCombined) {
      options.push({ value: "yearly-combined", label: "Combined Yearly Totals" });
    }
    options.push({ value: "documentation:1", label: "Documentation (Page 1)" });
    options.push({ value: "documentation:2", label: "Documentation (Page 2)" });
    return options;
  }, [includeYearlyCombined, yearOptions]);

  const previewPageIndex = useMemo(
    () => previewPageOptions.findIndex((option) => option.value === previewPage),
    [previewPage, previewPageOptions],
  );

  const previewPageTotal = previewPageOptions.length;
  const canGoToPreviousPreviewPage = previewPageIndex > 0;
  const canGoToNextPreviewPage = previewPageIndex >= 0 && previewPageIndex < previewPageTotal - 1;

  const goToPreviousPreviewPage = () => {
    if (!canGoToPreviousPreviewPage) {
      return;
    }
    setPreviewPage(previewPageOptions[previewPageIndex - 1].value);
  };

  const goToNextPreviewPage = () => {
    if (!canGoToNextPreviewPage) {
      return;
    }
    setPreviewPage(previewPageOptions[previewPageIndex + 1].value);
  };

  const previewNeedsMapOptions = previewPage.startsWith("year:");
  const previewNeedsChartOptions = !previewPage.startsWith("documentation:");
  const comparisonReady =
    !isComparisonMode || previewPage.startsWith("documentation:") || (comparisonJobKey !== "" && yearOptions.length > 0);
  const mapCustomRangeSelected = colorScale === "custom";
  const etEtoCustomRangeSelected = etEtoScale === "custom";
  const pptCustomRangeSelected = pptScale === "custom";

  const previewYear = useMemo(() => {
    if (previewPage.startsWith("year:")) {
      const year = Number(previewPage.replace("year:", ""));
      return Number.isFinite(year) ? year : null;
    }
    return null;
  }, [previewPage]);

  const boundsYear = previewYear ?? job?.end_year ?? job?.start_year ?? null;

  useEffect(() => {
    scaleBoundsRef.current = scaleBounds;
  }, [scaleBounds]);

  const applyCustomDefaultsForScale = useCallback(
    (
      bounds: ScaleBoundsGroup | null | undefined,
      sourceMode: ColorScaleMode,
      setCustomMin: (value: string) => void,
      setCustomMax: (value: string) => void,
    ) => {
      if (!bounds) {
        return false;
      }
      const defaults = getCustomDefaultsFromBounds(bounds, sourceMode);
      if (!defaults) {
        return false;
      }
      setCustomMin(defaults.min);
      setCustomMax(defaults.max);
      return true;
    },
    [],
  );

  useEffect(() => {
    if (!open || !job) {
      return;
    }
    loadedPreviewKeyRef.current = null;
    deferMapCustomPreviewRef.current = false;
    deferEtEtoCustomPreviewRef.current = false;
    deferPptCustomPreviewRef.current = false;
    pendingMapCustomDefaultsRef.current = false;
    pendingEtEtoCustomDefaultsRef.current = false;
    pendingPptCustomDefaultsRef.current = false;
    scaleBoundsRef.current = null;
    setEtUnits("metric");
    setPptUnits("metric");
    setModalMode("custom");
    setComparisonJobKey("");
    setColorScale("across_years");
    setEtCustomMin("");
    setEtCustomMax("");
    setEtEtoScale("across_years");
    setEtEtoCustomMin("");
    setEtEtoCustomMax("");
    setPptScale("across_years");
    setPptCustomMin("");
    setPptCustomMax("");
    setShowMonthlyAverages(false);
    setIncludeYearlyCombined(false);
    setPreviewError(null);
    setPreviewUrl(null);
    setScaleBounds(null);
    const defaultYear = job.end_year ?? job.start_year;
    setPreviewPage(defaultYear != null ? `year:${defaultYear}` : "summary");
  }, [job, open]);

  useEffect(() => {
    if (!isComparisonMode || !job || comparisonJobOptions.length === 0) {
      return;
    }
    if (!comparisonJobKey || !comparisonJobOptions.some((candidate) => candidate.key === comparisonJobKey)) {
      setComparisonJobKey(comparisonJobOptions[0].key);
    }
  }, [comparisonJobKey, comparisonJobOptions, isComparisonMode, job]);

  useEffect(() => {
    if (!isComparisonMode || !job || !selectedComparisonJob) {
      return;
    }
    const overlappingYears = getOverlappingYears(job, selectedComparisonJob);
    if (overlappingYears.length === 0) {
      setPreviewPage("summary");
      return;
    }
    if (previewPage.startsWith("year:")) {
      const previewYear = Number(previewPage.replace("year:", ""));
      if (!overlappingYears.includes(previewYear)) {
        setPreviewPage(`year:${overlappingYears[overlappingYears.length - 1]}`);
      }
    }
  }, [isComparisonMode, job, previewPage, selectedComparisonJob]);

  useEffect(() => {
    if (!includeYearlyCombined && previewPage === "yearly-combined") {
      setPreviewPage("summary");
    }
  }, [includeYearlyCombined, previewPage]);

  useEffect(() => {
    if (!open || !job || boundsYear == null) {
      return;
    }
    if (isComparisonMode && !comparisonJobKey) {
      return;
    }

    const axiosInstance = authAxios();
    if (!axiosInstance) {
      return;
    }

    let cancelled = false;

    const fetchBounds = async () => {
      try {
        const params = new URLSearchParams({
          key: job.key,
          year: String(boundsYear),
          etUnits,
          pptUnits,
        });
        if (isComparisonMode) {
          params.set("comparisonKey", comparisonJobKey);
        }
        const endpoint = isComparisonMode ? "/comparison-report/bounds" : "/custom-report/bounds";
        const response = await axiosInstance.get(`${API_URL}${endpoint}?${params.toString()}`);
        if (cancelled) {
          return;
        }
        const bounds = response.data as ReportScaleBounds | ComparisonScaleBounds;
        scaleBoundsRef.current = bounds as ReportScaleBounds;
        setScaleBounds(bounds as ReportScaleBounds);
        if (pendingMapCustomDefaultsRef.current && scaleBounds?.map) {
          const sourceMode =
            previousMapScaleRef.current === "custom" ? "across_years" : previousMapScaleRef.current;
          if (applyCustomDefaultsForScale(scaleBounds.map, sourceMode, setEtCustomMin, setEtCustomMax)) {
            pendingMapCustomDefaultsRef.current = false;
            deferMapCustomPreviewRef.current = false;
          }
        }
        if (pendingEtEtoCustomDefaultsRef.current) {
          const sourceMode =
            previousEtEtoScaleRef.current === "custom" ? "across_years" : previousEtEtoScaleRef.current;
          if (applyCustomDefaultsForScale(bounds.et_eto, sourceMode, setEtEtoCustomMin, setEtEtoCustomMax)) {
            pendingEtEtoCustomDefaultsRef.current = false;
            deferEtEtoCustomPreviewRef.current = false;
          }
        }
        if (pendingPptCustomDefaultsRef.current) {
          const sourceMode = previousPptScaleRef.current === "custom" ? "across_years" : previousPptScaleRef.current;
          if (applyCustomDefaultsForScale(bounds.ppt, sourceMode, setPptCustomMin, setPptCustomMax)) {
            pendingPptCustomDefaultsRef.current = false;
            deferPptCustomPreviewRef.current = false;
          }
        }
      } catch {
        if (!cancelled) {
          scaleBoundsRef.current = null;
          setScaleBounds(null);
        }
      }
    };

    fetchBounds();

    return () => {
      cancelled = true;
    };
  }, [
    applyCustomDefaultsForScale,
    authAxios,
    boundsYear,
    comparisonJobKey,
    etUnits,
    isComparisonMode,
    job,
    open,
    pptUnits,
  ]);

  const handleScaleModeChange = (
    currentScale: ColorScaleMode,
    nextScale: ColorScaleMode,
    setScale: (value: ColorScaleMode) => void,
    bounds: ScaleBoundsGroup | null | undefined,
    setCustomMin: (value: string) => void,
    setCustomMax: (value: string) => void,
    previousScaleRef: MutableRefObject<ColorScaleMode>,
    pendingDefaultsRef: MutableRefObject<boolean>,
    deferPreviewRef: MutableRefObject<boolean>,
  ) => {
    if (nextScale === "custom") {
      previousScaleRef.current = currentScale;
      pendingDefaultsRef.current = true;
      deferPreviewRef.current = true;
      const appliedDefaults = applyCustomDefaultsForScale(bounds, currentScale, setCustomMin, setCustomMax);
      if (appliedDefaults) {
        pendingDefaultsRef.current = false;
        deferPreviewRef.current = false;
      }
    } else {
      pendingDefaultsRef.current = false;
      deferPreviewRef.current = false;
    }
    setScale(nextScale);
  };

  const handleColorScaleChange = (nextScale: ColorScaleMode) => {
    handleScaleModeChange(
      colorScale,
      nextScale,
      setColorScale,
      scaleBounds?.map,
      setEtCustomMin,
      setEtCustomMax,
      previousMapScaleRef,
      pendingMapCustomDefaultsRef,
      deferMapCustomPreviewRef,
    );
  };

  const handleEtEtoScaleChange = (nextScale: ColorScaleMode) => {
    handleScaleModeChange(
      etEtoScale,
      nextScale,
      setEtEtoScale,
      scaleBounds?.et_eto,
      setEtEtoCustomMin,
      setEtEtoCustomMax,
      previousEtEtoScaleRef,
      pendingEtEtoCustomDefaultsRef,
      deferEtEtoCustomPreviewRef,
    );
  };

  const handlePptScaleChange = (nextScale: ColorScaleMode) => {
    handleScaleModeChange(
      pptScale,
      nextScale,
      setPptScale,
      scaleBounds?.ppt,
      setPptCustomMin,
      setPptCustomMax,
      previousPptScaleRef,
      pendingPptCustomDefaultsRef,
      deferPptCustomPreviewRef,
    );
  };

  const loadPreview = useCallback(async (options: { forceRefresh?: boolean } = {}) => {
    const { forceRefresh = false } = options;

    if (!job || !previewPage || !comparisonReady) {
      return;
    }

    if (previewNeedsMapOptions && mapCustomRangeSelected && (!etCustomMin.trim() || !etCustomMax.trim())) {
      return;
    }
    if (previewNeedsChartOptions && etEtoCustomRangeSelected && (!etEtoCustomMin.trim() || !etEtoCustomMax.trim())) {
      return;
    }
    if (previewNeedsChartOptions && pptCustomRangeSelected && (!pptCustomMin.trim() || !pptCustomMax.trim())) {
      return;
    }

    const requestKey = JSON.stringify({
      modalMode,
      comparisonJobKey: isComparisonMode ? comparisonJobKey : "",
      previewPage,
      etUnits,
      pptUnits,
      colorScale,
      etCustomMin: colorScale !== "custom" ? "" : etCustomMin.trim(),
      etCustomMax: colorScale !== "custom" ? "" : etCustomMax.trim(),
      etEtoScale,
      etEtoCustomMin: etEtoScale === "custom" ? etEtoCustomMin.trim() : "",
      etEtoCustomMax: etEtoScale === "custom" ? etEtoCustomMax.trim() : "",
      pptScale,
      pptCustomMin: pptScale === "custom" ? pptCustomMin.trim() : "",
      pptCustomMax: pptScale === "custom" ? pptCustomMax.trim() : "",
      showMonthlyAverages: isComparisonMode ? false : showMonthlyAverages,
      mapTileMode: isComparisonMode ? mapTileMode : "",
      mapTileMonth: isComparisonMode ? mapTileMonth : "",
      previewVersion: isComparisonMode ? COMPARISON_REPORT_PREVIEW_VERSION : CUSTOM_REPORT_PREVIEW_VERSION,
    });

    if (!forceRefresh && requestKey === loadedPreviewKeyRef.current && previewUrl) {
      return;
    }

    const axiosInstance = authAxios();
    if (!axiosInstance) {
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const isDocumentationPreview = previewPage.startsWith("documentation:");
      const params = isDocumentationPreview
        ? buildPreviewParams({
          jobKey: job.key,
          previewPage,
          etUnits,
          pptUnits,
          colorScale,
          etCustomMin,
          etCustomMax,
          etEtoScale,
          etEtoCustomMin,
          etEtoCustomMax,
          pptScale,
          pptCustomMin,
          pptCustomMax,
          showMonthlyAverages,
          forceRefresh,
        })
        : isComparisonMode
          ? buildComparisonPreviewParams({
            jobKey: job.key,
            comparisonJobKey,
            previewPage,
            etUnits,
            pptUnits,
            etEtoScale,
            etEtoCustomMin,
            etEtoCustomMax,
            pptScale,
            pptCustomMin,
            pptCustomMax,
            mapTileMode,
            mapTileMonth,
            colorScale,
            etCustomMin,
            etCustomMax,
            forceRefresh,
          })
          : buildPreviewParams({
            jobKey: job.key,
            previewPage,
            etUnits,
            pptUnits,
            colorScale,
            etCustomMin,
            etCustomMax,
            etEtoScale,
            etEtoCustomMin,
            etEtoCustomMax,
            pptScale,
            pptCustomMin,
            pptCustomMax,
            showMonthlyAverages,
            forceRefresh,
          });

      const endpoint =
        isDocumentationPreview || !isComparisonMode ? "/custom-report/preview" : "/comparison-report/preview";
      const response = await axiosInstance.get(`${API_URL}${endpoint}?${params.toString()}`, {
        responseType: "blob",
        headers: forceRefresh ? { "Cache-Control": "no-cache" } : undefined,
      });

      const objectUrl = URL.createObjectURL(new Blob([response.data], { type: "image/png" }));
      setPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return objectUrl;
      });
      loadedPreviewKeyRef.current = requestKey;
    } catch (error: unknown) {
      setPreviewError(await readAxiosError(error, "Failed to generate preview"));
    } finally {
      setPreviewLoading(false);
    }
  }, [
    authAxios,
    colorScale,
    comparisonJobKey,
    comparisonReady,
    etCustomMax,
    etCustomMin,
    etEtoCustomMax,
    etEtoCustomMin,
    etEtoCustomRangeSelected,
    etEtoScale,
    etUnits,
    isComparisonMode,
    job,
    mapCustomRangeSelected,
    mapTileMode,
    mapTileMonth,
    modalMode,
    pptCustomMax,
    pptCustomMin,
    pptCustomRangeSelected,
    pptScale,
    pptUnits,
    previewNeedsChartOptions,
    previewNeedsMapOptions,
    previewPage,
    previewUrl,
    showMonthlyAverages,
  ]);

  useEffect(() => {
    deferMapCustomPreviewRef.current = false;
    deferEtEtoCustomPreviewRef.current = false;
    deferPptCustomPreviewRef.current = false;
  }, [etUnits, pptUnits, previewPage, showMonthlyAverages, mapTileMode, mapTileMonth]);

  useEffect(() => {
    if (mapCustomRangeSelected && etCustomMin.trim() && etCustomMax.trim()) {
      deferMapCustomPreviewRef.current = false;
    }
    if (etEtoCustomRangeSelected && etEtoCustomMin.trim() && etEtoCustomMax.trim()) {
      deferEtEtoCustomPreviewRef.current = false;
    }
    if (pptCustomRangeSelected && pptCustomMin.trim() && pptCustomMax.trim()) {
      deferPptCustomPreviewRef.current = false;
    }
  }, [
    etCustomMax,
    etCustomMin,
    etEtoCustomMax,
    etEtoCustomMin,
    etEtoCustomRangeSelected,
    mapCustomRangeSelected,
    pptCustomMax,
    pptCustomMin,
    pptCustomRangeSelected,
  ]);

  useEffect(() => {
    if (!open || !job || !previewPage || !comparisonReady) {
      return;
    }

    const shouldDeferPreview =
      (mapCustomRangeSelected && deferMapCustomPreviewRef.current) ||
      (etEtoCustomRangeSelected && deferEtEtoCustomPreviewRef.current) ||
      (pptCustomRangeSelected && deferPptCustomPreviewRef.current);
    if (shouldDeferPreview) {
      return;
    }

    const timeout = setTimeout(() => {
      loadPreview();
    }, 400);

    return () => clearTimeout(timeout);
  }, [
    open,
    job,
    previewPage,
    etUnits,
    pptUnits,
    colorScale,
    etCustomMin,
    etCustomMax,
    etEtoScale,
    etEtoCustomMin,
    etEtoCustomMax,
    pptScale,
    pptCustomMin,
    pptCustomMax,
    showMonthlyAverages,
    mapTileMode,
    mapTileMonth,
    loadPreview,
    mapCustomRangeSelected,
    etEtoCustomRangeSelected,
    pptCustomRangeSelected,
    modalMode,
    comparisonJobKey,
    comparisonReady,
  ]);

  useEffect(() => {
    loadedPreviewKeyRef.current = null;
    setPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setPreviewError(null);
  }, [modalMode, comparisonJobKey]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleRefreshPreview = () => {
    loadedPreviewKeyRef.current = null;
    void loadPreview({ forceRefresh: true });
  };

  const validateCustomDownload = () => {
    if (!job) {
      return false;
    }
    if (isComparisonMode) {
      if (!comparisonJobKey) {
        setErrorMessage("Select a comparison job before downloading.");
        return false;
      }
      if (yearOptions.length === 0) {
        setErrorMessage("Selected jobs do not have overlapping years.");
        return false;
      }
    }
    if (previewPage.startsWith("year:") && mapCustomRangeSelected && (!etCustomMin.trim() || !etCustomMax.trim())) {
      setErrorMessage("Enter custom map color scale min and max values before downloading.");
      return false;
    }
    if (etEtoCustomRangeSelected && (!etEtoCustomMin.trim() || !etEtoCustomMax.trim())) {
      setErrorMessage("Enter custom ET/ETo scale min and max values before downloading.");
      return false;
    }
    if (pptCustomRangeSelected && (!pptCustomMin.trim() || !pptCustomMax.trim())) {
      setErrorMessage("Enter custom precipitation scale min and max values before downloading.");
      return false;
    }
    return true;
  };

  const downloadCustomReport = async (target: CustomDownloadTarget) => {
    if (!validateCustomDownload()) {
      return;
    }

    const axiosInstance = authAxios();
    if (!axiosInstance || !job) {
      return;
    }

    setDownloading(true);
    try {
      const params = isComparisonMode
        ? buildComparisonDownloadParams({
          jobKey: job.key,
          comparisonJobKey,
          etUnits,
          pptUnits,
          etEtoScale,
          etEtoCustomMin,
          etEtoCustomMax,
          pptScale,
          pptCustomMin,
          pptCustomMax,
          includeYearlyCombined,
          previewPage: target === "page" ? previewPage : undefined,
          mapTileMode,
          mapTileMonth,
          colorScale,
          etCustomMin,
          etCustomMax,
        })
        : buildCustomDownloadParams({
          jobKey: job.key,
          etUnits,
          pptUnits,
          colorScale,
          etCustomMin,
          etCustomMax,
          etEtoScale,
          etEtoCustomMin,
          etEtoCustomMax,
          pptScale,
          pptCustomMin,
          pptCustomMax,
          showMonthlyAverages,
          includeYearlyCombined,
          previewPage: target === "page" ? previewPage : undefined,
        });

      if (target === "csv-monthly") {
        params.set("csvKind", "monthly");
      } else if (target === "csv-yearly") {
        params.set("csvKind", "yearly");
      }

      const endpoints: Record<CustomDownloadTarget, string> = isComparisonMode
        ? {
          pdf: "/comparison-report/download",
          page: "/comparison-report/download/page",
          "csv-monthly": "/comparison-report/download/csv",
          "csv-yearly": "/comparison-report/download/csv",
          zip: "/comparison-report/download/zip",
        }
        : {
          pdf: "/custom-report/download",
          page: "/custom-report/download/page",
          "csv-monthly": "/custom-report/download/csv",
          "csv-yearly": "/custom-report/download/csv",
          zip: "/custom-report/download/zip",
        };

      const mimeTypes: Record<CustomDownloadTarget, string> = {
        pdf: "application/pdf",
        page: "image/png",
        "csv-monthly": "text/csv",
        "csv-yearly": "text/csv",
        zip: "application/zip",
      };

      const comparisonName = selectedComparisonJob?.name ?? "comparison";
      const filenames: Record<CustomDownloadTarget, string> = isComparisonMode
        ? {
          pdf: getComparisonDownloadFilename(job.name, comparisonName, "pdf", previewPage),
          page: getComparisonDownloadFilename(job.name, comparisonName, "page", previewPage),
          "csv-monthly": getComparisonDownloadFilename(job.name, comparisonName, "csv-monthly", previewPage),
          "csv-yearly": getComparisonDownloadFilename(job.name, comparisonName, "csv-yearly", previewPage),
          zip: getComparisonDownloadFilename(job.name, comparisonName, "zip", previewPage),
        }
        : {
          pdf: `${job.name}_custom_report.pdf`,
          page: getPreviewPageDownloadName(job.name, previewPage),
          "csv-monthly": `${job.name}_combined.csv`,
          "csv-yearly": `${job.name}_yearly_combined.csv`,
          zip: `${job.name}_custom_report.zip`,
        };

      const response = await axiosInstance.get(`${API_URL}${endpoints[target]}?${params.toString()}`, {
        responseType: "arraybuffer",
      });

      triggerBlobDownload(new Blob([response.data], { type: mimeTypes[target] }), filenames[target]);
    } catch (error: unknown) {
      const fallback =
        target === "pdf"
          ? isComparisonMode
            ? "Failed to download comparison report"
            : "Failed to download custom report"
          : target === "page"
            ? "Failed to download preview page"
            : target === "csv-monthly" || target === "csv-yearly"
              ? "Failed to download CSV"
              : "Failed to download full report";
      setErrorMessage(await readAxiosError(error, fallback));
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadPdf = () => {
    void downloadCustomReport("pdf");
  };

  const handleDownloadMenuOpen = (event: MouseEvent<HTMLButtonElement>) => {
    setDownloadMenuAnchor(event.currentTarget);
  };

  const handleDownloadMenuClose = () => {
    setDownloadMenuAnchor(null);
  };

  const handleDownloadMenuSelect = (target: Exclude<CustomDownloadTarget, "pdf">) => {
    handleDownloadMenuClose();
    void downloadCustomReport(target);
  };

  if (!job) {
    return null;
  }

  const selectedPreviewLabel = previewPageOptions.find((option) => option.value === previewPage)?.label ?? "Preview";
  const comparisonOverlapMissing = isComparisonMode && comparisonJobKey !== "" && yearOptions.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      disableEnforceFocus
      slotProps={{
        backdrop: {
          sx: { backgroundColor: "rgb(0 0 0 / 50%)" },
        },
      }}
    >
      <Box className="custom-download-modal">
        <Box className="custom-download-modal__header">
          <Box>
            <Typography variant="h6" sx={{ color: "var(--st-gray-20)", fontSize: "1rem", fontWeight: 600 }}>
              Custom Download
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--st-gray-50)", mt: 0.25 }}>
              {job.name}
              {isComparisonMode && selectedComparisonJob ? ` vs ${selectedComparisonJob.name}` : ""}
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close custom download" size="small" sx={{ color: "var(--st-gray-50)" }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Tabs
          value={modalMode}
          onChange={(_event, value: CustomDownloadModalMode) => setModalMode(value)}
          className="custom-download-modal__tabs"
        >
          <Tab label="Custom Report" value="custom" disableRipple />
          <Tab label="Comparison Report" value="comparison" disableRipple />
        </Tabs>

        <Box className="custom-download-modal__body">
          <Box className="custom-download-modal__controls">
            {isComparisonMode && job && (
              <ComparisonJobPicker
                primaryJob={job}
                jobs={comparisonJobOptions}
                selectedJobKey={comparisonJobKey}
                onSelect={setComparisonJobKey}
                disabled={comparisonJobOptions.length === 0}
                authAxios={authAxios}
              />
            )}

            {comparisonOverlapMissing && (
              <Typography variant="body2" sx={{ color: "var(--st-red)" }}>
                Selected jobs do not have overlapping years.
              </Typography>
            )}

            {comparisonJobOptions.length === 0 && isComparisonMode && (
              <Typography variant="body2" sx={{ color: "var(--st-gray-50)" }}>
                No other completed jobs are available for comparison.
              </Typography>
            )}

            <FormControl size="small" fullWidth>
              <InputLabel id="custom-et-units-label">ET units</InputLabel>
              <Select
                labelId="custom-et-units-label"
                label="ET units"
                value={etUnits}
                onChange={(event) => setEtUnits(event.target.value as ReportUnit)}
              >
                {UNIT_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
              <InputLabel id="custom-ppt-units-label">Precipitation units</InputLabel>
              <Select
                labelId="custom-ppt-units-label"
                label="Precipitation units"
                value={pptUnits}
                onChange={(event) => setPptUnits(event.target.value as ReportUnit)}
              >
                {UNIT_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
              <InputLabel id="custom-preview-page-label">Preview page</InputLabel>
              <Select
                labelId="custom-preview-page-label"
                label="Preview page"
                value={previewPage}
                onChange={(event) => setPreviewPage(event.target.value)}
              >
                {previewPageOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {isComparisonMode && previewPage.startsWith("year:") && (
              <>
                <FormControl size="small" fullWidth>
                  <InputLabel id="comparison-map-tile-mode-label">Map thumbnail</InputLabel>
                  <Select
                    labelId="comparison-map-tile-mode-label"
                    label="Map thumbnail"
                    value={mapTileMode}
                    onChange={(event) => setMapTileMode(event.target.value as MapTileMode)}
                  >
                    <MenuItem value="yearly_total">Yearly total</MenuItem>
                    <MenuItem value="spring">Spring total</MenuItem>
                    <MenuItem value="summer">Summer total</MenuItem>
                    <MenuItem value="fall">Fall total</MenuItem>
                    <MenuItem value="winter">Winter total</MenuItem>
                    <MenuItem value="month">Specific month</MenuItem>
                  </Select>
                </FormControl>

                {mapTileMode === "month" && (
                  <FormControl size="small" fullWidth>
                    <InputLabel id="comparison-map-tile-month-label">Thumbnail month</InputLabel>
                    <Select
                      labelId="comparison-map-tile-month-label"
                      label="Thumbnail month"
                      value={String(mapTileMonth)}
                      onChange={(event) => setMapTileMonth(Number(event.target.value))}
                    >
                      {MONTH_OPTIONS.map((option) => (
                        <MenuItem key={option.value} value={String(option.value)}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </>
            )}

            {!isComparisonMode && (
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={showMonthlyAverages}
                    onChange={(event) => setShowMonthlyAverages(event.target.checked)}
                  />
                }
                label="Show monthly ET labels"
              />
            )}

            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={includeYearlyCombined}
                  onChange={(event) => setIncludeYearlyCombined(event.target.checked)}
                />
              }
              label="Combined yearly totals"
            />

            <Box className="custom-download-modal__scale-accordions">
              <ScaleControlsSection
                label="Map color scale"
                scale={colorScale}
                customMin={etCustomMin}
                customMax={etCustomMax}
                bounds={scaleBounds?.map ?? null}
                unitAbbreviation={UNIT_ABBREVIATIONS[etUnits]}
                onScaleChange={handleColorScaleChange}
                onCustomMinChange={(value) => {
                  deferMapCustomPreviewRef.current = false;
                  setEtCustomMin(value);
                }}
                onCustomMaxChange={(value) => {
                  deferMapCustomPreviewRef.current = false;
                  setEtCustomMax(value);
                }}
              />

              <ScaleControlsSection
                label="ET/ETo scale"
                scale={etEtoScale}
                customMin={etEtoCustomMin}
                customMax={etEtoCustomMax}
                bounds={scaleBounds?.et_eto ?? null}
                unitAbbreviation={UNIT_ABBREVIATIONS[etUnits]}
                onScaleChange={handleEtEtoScaleChange}
                onCustomMinChange={(value) => {
                  deferEtEtoCustomPreviewRef.current = false;
                  setEtEtoCustomMin(value);
                }}
                onCustomMaxChange={(value) => {
                  deferEtEtoCustomPreviewRef.current = false;
                  setEtEtoCustomMax(value);
                }}
              />

              <ScaleControlsSection
                label="PPT scale"
                scale={pptScale}
                customMin={pptCustomMin}
                customMax={pptCustomMax}
                bounds={scaleBounds?.ppt ?? null}
                unitAbbreviation={UNIT_ABBREVIATIONS[pptUnits]}
                onScaleChange={handlePptScaleChange}
                onCustomMinChange={(value) => {
                  deferPptCustomPreviewRef.current = false;
                  setPptCustomMin(value);
                }}
                onCustomMaxChange={(value) => {
                  deferPptCustomPreviewRef.current = false;
                  setPptCustomMax(value);
                }}
              />
            </Box>
          </Box>

          <Box className="custom-download-modal__preview">
            <Box className="custom-download-modal__preview-stage">
              <Box className="custom-download-modal__preview-panel">
                <Typography variant="body2" className="custom-download-modal__preview-label">
                  Preview: {selectedPreviewLabel}
                </Typography>
                <Box
                  className={[
                    "custom-download-modal__preview-frame",
                    getPreviewAspectClass(previewPage),
                  ].join(" ")}
                  aria-label="Report page preview"
                >
                  <IconButton
                    size="small"
                    className="custom-download-modal__preview-refresh"
                    onClick={handleRefreshPreview}
                    disabled={previewLoading || !previewPage}
                    aria-label="Regenerate preview"
                    title="Regenerate preview"
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                  {previewLoading && (
                    <Box className="custom-download-modal__preview-placeholder">
                      <CircularProgress size={28} sx={{ color: "var(--st-gray-50)" }} />
                      <Typography variant="body2" sx={{ color: "var(--st-gray-50)", mt: 1 }}>
                        Generating preview...
                      </Typography>
                    </Box>
                  )}
                  {!previewLoading && previewError && (
                    <Box className="custom-download-modal__preview-placeholder">
                      <Typography variant="body2" sx={{ color: "var(--st-red)" }}>
                        {previewError}
                      </Typography>
                    </Box>
                  )}
                  {!previewLoading && !previewError && previewUrl && (
                    <img
                      src={previewUrl}
                      alt={`${job.name} ${selectedPreviewLabel} preview`}
                      className="custom-download-modal__preview-image"
                    />
                  )}
                  {previewPageTotal > 1 && previewPageIndex >= 0 && (
                    <Box className="custom-download-modal__preview-nav" aria-label="Preview page navigation">
                      <IconButton
                        size="small"
                        className="custom-download-modal__preview-nav-btn"
                        onClick={goToPreviousPreviewPage}
                        disabled={!canGoToPreviousPreviewPage}
                        aria-label="Previous preview page"
                      >
                        <ChevronLeftIcon fontSize="small" />
                      </IconButton>
                      <Typography variant="body2" className="custom-download-modal__preview-nav-count">
                        {previewPageIndex + 1}/{previewPageTotal}
                      </Typography>
                      <IconButton
                        size="small"
                        className="custom-download-modal__preview-nav-btn"
                        onClick={goToNextPreviewPage}
                        disabled={!canGoToNextPreviewPage}
                        aria-label="Next preview page"
                      >
                        <ChevronRightIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          </Box>
        </Box>

        <Box className="custom-download-modal__footer">
          <Button onClick={onClose} size="small" sx={{ color: "var(--st-gray-50)" }}>
            Cancel
          </Button>
          <ButtonGroup variant="contained" size="small" className="custom-download-modal__download-group">
            <Button
              onClick={handleDownloadPdf}
              disabled={downloading || previewLoading || comparisonOverlapMissing || !comparisonReady}
              startIcon={downloading ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {downloading ? "Generating..." : "Download report"}
            </Button>
            <Button
              size="small"
              onClick={handleDownloadMenuOpen}
              disabled={downloading || previewLoading || comparisonOverlapMissing || !comparisonReady}
              aria-label="More download options"
            >
              <ArrowDropDownIcon />
            </Button>
          </ButtonGroup>
          <Menu
            anchorEl={downloadMenuAnchor}
            open={Boolean(downloadMenuAnchor)}
            onClose={handleDownloadMenuClose}
            anchorOrigin={{ vertical: "top", horizontal: "right" }}
            transformOrigin={{ vertical: "bottom", horizontal: "right" }}
          >
            <MenuItem onClick={() => handleDownloadMenuSelect("page")} disabled={!previewPage}>
              {selectedPreviewLabel} (PNG)
            </MenuItem>
            <MenuItem onClick={() => handleDownloadMenuSelect("csv-monthly")}>Monthly Totals (CSV)</MenuItem>
            <MenuItem onClick={() => handleDownloadMenuSelect("csv-yearly")}>Annual Totals (CSV)</MenuItem>
            <MenuItem onClick={() => handleDownloadMenuSelect("zip")}>Full Report (ZIP)</MenuItem>
          </Menu>
        </Box>
      </Box>
    </Modal>
  );
};

export default CustomDownloadModal;
