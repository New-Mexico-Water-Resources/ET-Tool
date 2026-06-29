import { Box, IconButton, Modal, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { useEffect, useMemo, useState } from "react";
import useStore from "../utils/store";
import { JobLogWarning, fetchJobLogWarnings } from "../utils/jobLogErrors";

const TOOLTIP_PREVIEW_COUNT = 3;

const WARNING_TOOLTIP_INTRO =
  "Errors were detected during the run that could cause unexpected results. Please verify the data before using.";

function formatWarningsTooltipPreview(warnings: JobLogWarning[]): string {
  const preview = warnings.slice(0, TOOLTIP_PREVIEW_COUNT);
  const lines = [WARNING_TOOLTIP_INTRO, "", ...preview.map((warning) => `• ${warning.message}`)];

  if (warnings.length > TOOLTIP_PREVIEW_COUNT) {
    lines.push("", `Click to view ${warnings.length - TOOLTIP_PREVIEW_COUNT} more...`);
  } else {
    lines.push("", "Click to view details");
  }

  return lines.join("\n");
}

export function useJobLogWarnings(jobKey: string, status: string): JobLogWarning[] {
  const fetchJobLogs = useStore((state) => state.fetchJobLogs);
  const [warnings, setWarnings] = useState<JobLogWarning[]>([]);

  useEffect(() => {
    if (status !== "Complete") {
      setWarnings([]);
      return;
    }

    let cancelled = false;

    fetchJobLogWarnings(jobKey, fetchJobLogs)
      .then((nextWarnings) => {
        if (!cancelled) {
          setWarnings(nextWarnings);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWarnings([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [jobKey, status, fetchJobLogs]);

  return warnings;
}

export function JobLogWarningsModal({
  open,
  onClose,
  warnings,
  jobName,
}: {
  open: boolean;
  onClose: () => void;
  warnings: JobLogWarning[];
  jobName?: string;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(480px, 90vw)",
          maxHeight: "min(60vh, 480px)",
          display: "flex",
          flexDirection: "column",
          bgcolor: "var(--st-gray-90)",
          boxShadow: 24,
          padding: "12px 16px",
          borderRadius: "4px",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0, mb: 1, gap: 1, minWidth: 0 }}>
          <WarningAmberIcon sx={{ color: "var(--st-warning-amber, #ed6c02)", flexShrink: 0 }} />
          <Typography variant="h6" component="h2" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {jobName ? `${jobName} — ` : ""}Result warnings ({warnings.length})
          </Typography>
          <IconButton onClick={onClose} sx={{ marginLeft: "auto", flexShrink: 0 }} aria-label="Close warnings">
            <CloseIcon />
          </IconButton>
        </Box>
        <Typography variant="body2" sx={{ color: "var(--st-gray-40)", mb: 1, flexShrink: 0 }}>
          {WARNING_TOOLTIP_INTRO}
        </Typography>
        <Box
          component="ul"
          sx={{
            m: 0,
            pl: 2.5,
            overflowY: "auto",
            flex: 1,
            minHeight: 0,
            pr: 0.5,
          }}
        >
          {warnings.map((warning, index) => (
            <Typography
              key={`${warning.message}-${index}`}
              component="li"
              variant="body2"
              sx={{ mb: 1, wordBreak: "break-word", whiteSpace: "normal" }}
            >
              {warning.message}
            </Typography>
          ))}
        </Box>
      </Box>
    </Modal>
  );
}

export function JobLogWarningIcon({
  warnings,
  jobName,
  onOpenModal,
  iconSize = "small",
}: {
  warnings: JobLogWarning[];
  jobName?: string;
  onOpenModal?: () => void;
  iconSize?: "small" | "inherit" | "medium" | "large";
}) {
  const [internalModalOpen, setInternalModalOpen] = useState(false);
  const tooltip = useMemo(() => formatWarningsTooltipPreview(warnings), [warnings]);
  const usesInternalModal = !onOpenModal;
  const openModal = onOpenModal ?? (() => setInternalModalOpen(true));
  const closeModal = () => setInternalModalOpen(false);

  if (warnings.length === 0) {
    return null;
  }

  return (
    <>
      <Tooltip
        title={tooltip}
        slotProps={{ tooltip: { sx: { whiteSpace: "pre-line", maxWidth: 320 } } }}
      >
        <IconButton
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            openModal();
          }}
          aria-label="View job result warnings"
          sx={{ p: 0, flexShrink: 0 }}
        >
          <WarningAmberIcon
            sx={{ color: "var(--st-warning-amber, #ed6c02)", fontSize: iconSize === "small" ? 18 : undefined }}
          />
        </IconButton>
      </Tooltip>
      {usesInternalModal && (
        <JobLogWarningsModal
          open={internalModalOpen}
          onClose={closeModal}
          warnings={warnings}
          jobName={jobName}
        />
      )}
    </>
  );
}

const JobLogWarnings = ({
  jobKey,
  jobName,
  status,
  iconSize = "small",
}: {
  jobKey: string;
  jobName?: string;
  status: string;
  iconSize?: "small" | "inherit" | "medium" | "large";
}) => {
  const warnings = useJobLogWarnings(jobKey, status);

  if (status !== "Complete" || warnings.length === 0) {
    return null;
  }

  return <JobLogWarningIcon warnings={warnings} jobName={jobName} iconSize={iconSize} />;
};

export default JobLogWarnings;
