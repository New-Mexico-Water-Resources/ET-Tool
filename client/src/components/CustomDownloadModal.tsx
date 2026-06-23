import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Modal,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import axios from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_URL } from "../utils/constants";
import useStore from "../utils/store";
import "../scss/CustomDownloadModal.scss";

export type ReportUnit = "metric" | "imperial" | "acre-feet";
export type ColorScaleMode = "across_years" | "per_year" | "custom";

type ScaleBounds = {
  across_years: { min: number | null; max: number | null };
  per_year: { min: number | null; max: number | null };
};

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

const formatBound = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(value)) {
    return "";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(2)));
};

const getScaleBoundsForMode = (bounds: ScaleBounds, sourceMode: ColorScaleMode) => {
  if (sourceMode === "per_year") {
    return bounds.per_year;
  }
  return bounds.across_years;
};

const getCustomDefaultsFromBounds = (bounds: ScaleBounds, sourceMode: ColorScaleMode) => {
  const source = getScaleBoundsForMode(bounds, sourceMode);
  if (source.min == null || source.max == null) {
    return null;
  }
  return {
    min: formatBound(source.min),
    max: formatBound(source.max),
  };
};

const buildPreviewRequestKey = ({
  previewPage,
  etUnits,
  pptUnits,
  colorScale,
  etCustomMin,
  etCustomMax,
  showMonthlyAverages,
}: {
  previewPage: string;
  etUnits: ReportUnit;
  pptUnits: ReportUnit;
  colorScale: ColorScaleMode;
  etCustomMin: string;
  etCustomMax: string;
  showMonthlyAverages: boolean;
}) =>
  JSON.stringify({
    previewPage,
    etUnits,
    pptUnits,
    colorScale,
    etCustomMin: colorScale === "custom" ? etCustomMin.trim() : "",
    etCustomMax: colorScale === "custom" ? etCustomMax.trim() : "",
    showMonthlyAverages,
  });

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
  showMonthlyAverages,
}: {
  jobKey: string;
  previewPage: string;
  etUnits: ReportUnit;
  pptUnits: ReportUnit;
  colorScale: ColorScaleMode;
  etCustomMin: string;
  etCustomMax: string;
  showMonthlyAverages: boolean;
}) => {
  const params = new URLSearchParams({
    key: jobKey,
    etUnits,
    pptUnits,
    colorScale,
    showMonthlyAverages: String(showMonthlyAverages),
  });

  if (colorScale === "custom") {
    if (etCustomMin.trim()) {
      params.set("etCustomMin", etCustomMin.trim());
    }
    if (etCustomMax.trim()) {
      params.set("etCustomMax", etCustomMax.trim());
    }
  }

  if (previewPage.startsWith("year:")) {
    params.set("previewKind", "year");
    params.set("year", previewPage.replace("year:", ""));
  } else if (previewPage === "summary") {
    params.set("previewKind", "summary");
  } else if (previewPage.startsWith("documentation:")) {
    params.set("previewKind", "documentation");
    params.set("previewPage", previewPage.replace("documentation:", ""));
  }

  return params;
};

const getPreviewAspectClass = (previewPage: string) => {
  if (previewPage === "summary") {
    return "custom-download-modal__preview-frame--landscape";
  }
  return "custom-download-modal__preview-frame--portrait";
};

const CustomDownloadModal = () => {
  const job = useStore((state) => state.customDownloadJob);
  const onClose = useStore((state) => state.closeCustomDownload);
  const authAxios = useStore((state) => state.authAxios);
  const setErrorMessage = useStore((state) => state.setErrorMessage);

  const [etUnits, setEtUnits] = useState<ReportUnit>("metric");
  const [pptUnits, setPptUnits] = useState<ReportUnit>("metric");
  const [colorScale, setColorScale] = useState<ColorScaleMode>("across_years");
  const [etCustomMin, setEtCustomMin] = useState("");
  const [etCustomMax, setEtCustomMax] = useState("");
  const [showMonthlyAverages, setShowMonthlyAverages] = useState(false);
  const [previewPage, setPreviewPage] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [scaleBounds, setScaleBounds] = useState<ScaleBounds | null>(null);

  const loadedPreviewKeyRef = useRef<string | null>(null);
  const deferCustomPreviewRef = useRef(false);
  const previousColorScaleRef = useRef<ColorScaleMode>("across_years");
  const scaleBoundsRef = useRef<ScaleBounds | null>(null);
  const pendingCustomDefaultsRef = useRef(false);

  const open = job != null;

  const yearOptions = useMemo(() => {
    if (!job?.start_year || !job?.end_year) {
      return [];
    }
    const years: number[] = [];
    for (let year = job.start_year; year <= job.end_year; year += 1) {
      years.push(year);
    }
    return years;
  }, [job?.end_year, job?.start_year]);

  const previewPageOptions = useMemo(() => {
    const options = yearOptions.map((year) => ({
      value: `year:${year}`,
      label: `${year} Report`,
    }));
    options.push({ value: "summary", label: "Summary" });
    options.push({ value: "documentation:1", label: "Documentation (Page 1)" });
    options.push({ value: "documentation:2", label: "Documentation (Page 2)" });
    return options;
  }, [yearOptions]);

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

  const previewNeedsReportOptions = previewPage.startsWith("year:");
  const customRangeSelected = colorScale === "custom";

  const displayedScaleMin = useMemo(() => {
    if (customRangeSelected) {
      return etCustomMin;
    }
    if (!scaleBounds) {
      return "";
    }
    return formatBound(getScaleBoundsForMode(scaleBounds, colorScale).min);
  }, [colorScale, customRangeSelected, etCustomMin, scaleBounds]);

  const displayedScaleMax = useMemo(() => {
    if (customRangeSelected) {
      return etCustomMax;
    }
    if (!scaleBounds) {
      return "";
    }
    return formatBound(getScaleBoundsForMode(scaleBounds, colorScale).max);
  }, [colorScale, customRangeSelected, etCustomMax, scaleBounds]);

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

  const applyCustomDefaults = useCallback((sourceMode: ColorScaleMode, bounds: ScaleBounds | null = scaleBoundsRef.current) => {
    if (!bounds) {
      return false;
    }
    const defaults = getCustomDefaultsFromBounds(bounds, sourceMode);
    if (!defaults) {
      return false;
    }
    setEtCustomMin(defaults.min);
    setEtCustomMax(defaults.max);
    pendingCustomDefaultsRef.current = false;
    return true;
  }, []);

  useEffect(() => {
    if (!open || !job) {
      return;
    }
    loadedPreviewKeyRef.current = null;
    deferCustomPreviewRef.current = false;
    pendingCustomDefaultsRef.current = false;
    scaleBoundsRef.current = null;
    setEtUnits("metric");
    setPptUnits("metric");
    setColorScale("across_years");
    setEtCustomMin("");
    setEtCustomMax("");
    setShowMonthlyAverages(false);
    setPreviewError(null);
    setPreviewUrl(null);
    setScaleBounds(null);
    const defaultYear = job.end_year ?? job.start_year;
    setPreviewPage(defaultYear != null ? `year:${defaultYear}` : "summary");
  }, [job, open]);

  useEffect(() => {
    if (!open || !job || boundsYear == null) {
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
        });
        const response = await axiosInstance.get(`${API_URL}/custom-report/bounds?${params.toString()}`);
        if (cancelled) {
          return;
        }
        const bounds = response.data as ScaleBounds;
        scaleBoundsRef.current = bounds;
        setScaleBounds(bounds);
        if (pendingCustomDefaultsRef.current) {
          const sourceMode =
            previousColorScaleRef.current === "custom" ? "across_years" : previousColorScaleRef.current;
          applyCustomDefaults(sourceMode, bounds);
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
  }, [applyCustomDefaults, authAxios, boundsYear, etUnits, job, open]);

  const handleColorScaleChange = (nextScale: ColorScaleMode) => {
    if (nextScale === "custom") {
      previousColorScaleRef.current = colorScale;
      pendingCustomDefaultsRef.current = true;
      deferCustomPreviewRef.current = true;
      applyCustomDefaults(colorScale);
    } else {
      pendingCustomDefaultsRef.current = false;
      deferCustomPreviewRef.current = false;
    }
    setColorScale(nextScale);
  };

  const loadPreview = useCallback(async () => {
    if (!job || !previewPage) {
      return;
    }

    if (customRangeSelected && previewNeedsReportOptions && (!etCustomMin.trim() || !etCustomMax.trim())) {
      return;
    }

    const requestKey = buildPreviewRequestKey({
      previewPage,
      etUnits,
      pptUnits,
      colorScale,
      etCustomMin,
      etCustomMax,
      showMonthlyAverages,
    });

    if (requestKey === loadedPreviewKeyRef.current && previewUrl) {
      return;
    }

    const axiosInstance = authAxios();
    if (!axiosInstance) {
      return;
    }

    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const params = buildPreviewParams({
        jobKey: job.key,
        previewPage,
        etUnits,
        pptUnits,
        colorScale,
        etCustomMin,
        etCustomMax,
        showMonthlyAverages,
      });

      const response = await axiosInstance.get(`${API_URL}/custom-report/preview?${params.toString()}`, {
        responseType: "blob",
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
    customRangeSelected,
    etCustomMax,
    etCustomMin,
    etUnits,
    job,
    pptUnits,
    previewNeedsReportOptions,
    previewPage,
    previewUrl,
    showMonthlyAverages,
  ]);

  useEffect(() => {
    deferCustomPreviewRef.current = false;
  }, [etUnits, pptUnits, previewPage, showMonthlyAverages]);

  useEffect(() => {
    if (!open || !job || !previewPage) {
      return;
    }

    if (colorScale === "custom" && deferCustomPreviewRef.current) {
      return;
    }

    const timeout = setTimeout(() => {
      loadPreview();
    }, 400);

    return () => clearTimeout(timeout);
  }, [open, job, previewPage, etUnits, pptUnits, colorScale, etCustomMin, etCustomMax, showMonthlyAverages, loadPreview]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleDownload = async () => {
    if (!job) {
      return;
    }

    if (customRangeSelected && (!etCustomMin.trim() || !etCustomMax.trim())) {
      setErrorMessage("Enter custom min and max values before downloading.");
      return;
    }

    const axiosInstance = authAxios();
    if (!axiosInstance) {
      return;
    }

    setDownloading(true);
    try {
      const params = new URLSearchParams({
        key: job.key,
        etUnits,
        pptUnits,
        colorScale,
        showMonthlyAverages: String(showMonthlyAverages),
      });

      if (customRangeSelected) {
        params.set("etCustomMin", etCustomMin.trim());
        params.set("etCustomMax", etCustomMax.trim());
      }

      const response = await axiosInstance.get(`${API_URL}/custom-report/download?${params.toString()}`, {
        responseType: "arraybuffer",
      });

      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${job.name}_custom_report.pdf`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setErrorMessage(await readAxiosError(error, "Failed to download custom report"));
    } finally {
      setDownloading(false);
    }
  };

  if (!job) {
    return null;
  }

  const selectedPreviewLabel = previewPageOptions.find((option) => option.value === previewPage)?.label ?? "Preview";

  return (
    <Modal
      open={open}
      onClose={onClose}
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
            </Typography>
          </Box>
          <IconButton onClick={onClose} aria-label="Close custom download" size="small" sx={{ color: "var(--st-gray-50)" }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Box className="custom-download-modal__body">
          <Box className="custom-download-modal__controls">
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

            <FormControl>
              <Typography variant="body2" sx={{ color: "var(--st-gray-30)", mb: 0.5, fontWeight: 600 }}>
                Map color scale
              </Typography>
              <RadioGroup
                value={colorScale}
                onChange={(event) => handleColorScaleChange(event.target.value as ColorScaleMode)}
              >
                <FormControlLabel
                  value="across_years"
                  control={<Radio size="small" />}
                  label="Same scale across all years"
                />
                <FormControlLabel value="per_year" control={<Radio size="small" />} label="Dynamic scale per year" />
                <FormControlLabel value="custom" control={<Radio size="small" />} label="Custom range" />
              </RadioGroup>
            </FormControl>

            <Box className="custom-download-modal__custom-range">
              <TextField
                size="small"
                label={`Min (${UNIT_ABBREVIATIONS[etUnits]})`}
                value={displayedScaleMin}
                onChange={(event) => {
                  deferCustomPreviewRef.current = false;
                  setEtCustomMin(event.target.value);
                }}
                disabled={!customRangeSelected}
                fullWidth
              />
              <TextField
                size="small"
                label={`Max (${UNIT_ABBREVIATIONS[etUnits]})`}
                value={displayedScaleMax}
                onChange={(event) => {
                  deferCustomPreviewRef.current = false;
                  setEtCustomMax(event.target.value);
                }}
                disabled={!customRangeSelected}
                fullWidth
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
                  {previewLoading && (
                    <Box className="custom-download-modal__preview-placeholder">
                      <CircularProgress size={28} sx={{ color: "var(--st-gray-50)" }} />
                      <Typography variant="body2" sx={{ color: "var(--st-gray-50)", mt: 1 }}>
                        Generating preview…
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
          <Button
            variant="contained"
            size="small"
            onClick={handleDownload}
            disabled={downloading || previewLoading}
            startIcon={downloading ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {downloading ? "Generating report…" : "Download report"}
          </Button>
        </Box>
      </Box>
    </Modal>
  );
};

export default CustomDownloadModal;
