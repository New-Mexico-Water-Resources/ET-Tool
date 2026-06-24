import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import useStore from "../utils/store";
import { QueueJob } from "../utils/jobGroups";

type RenameJobDialogProps = {
  job: QueueJob | null;
  open: boolean;
  onClose: () => void;
};

const dialogSurfaceSx = {
  backgroundColor: "var(--st-gray-90)",
  color: "var(--st-gray-10)",
};

const RenameJobDialog = ({ job, open, onClose }: RenameJobDialogProps) => {
  const authAxios = useStore((state) => state.authAxios);
  const setErrorMessage = useStore((state) => state.setErrorMessage);
  const setSuccessMessage = useStore((state) => state.setSuccessMessage);
  const renameJob = useStore((state) => state.renameJob);
  const setActiveJob = useStore((state) => state.setActiveJob);
  const activeJob = useStore((state) => state.activeJob);

  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && job) {
      setNewName(job.name);
      setSubmitting(false);
    }
  }, [open, job]);

  const handleClose = () => {
    if (submitting) {
      return;
    }
    onClose();
  };

  const handleConfirm = async () => {
    if (!job) {
      return;
    }

    const trimmedName = newName.trim();
    if (!trimmedName) {
      setErrorMessage("Enter a job name.");
      return;
    }

    if (trimmedName === job.name) {
      setErrorMessage("Enter a different name than the current job name.");
      return;
    }

    const axiosInstance = authAxios();
    if (!axiosInstance) {
      return;
    }

    setSubmitting(true);
    try {
      const updatedJob = await renameJob(job.key, trimmedName);
      if (activeJob?.key === job.key && updatedJob) {
        setActiveJob(updatedJob);
      }
      setSuccessMessage(`Job renamed to "${trimmedName}"`);
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to rename job";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!job) {
    return null;
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={dialogSurfaceSx}>Rename Job</DialogTitle>
      <DialogContent sx={dialogSurfaceSx}>
        <Typography variant="body2" sx={{ marginBottom: "12px" }}>
          Renaming will update job files and regenerate default reports. Are you sure you want to rename "{job.name}"?
        </Typography>
        <TextField
          autoFocus
          fullWidth
          label="New job name"
          value={newName}
          disabled={submitting}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleConfirm();
            }
          }}
        />
        {submitting && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "16px" }}>
            <CircularProgress size={18} />
            <Typography variant="body2">Renaming job and regenerating reports...</Typography>
          </div>
        )}
      </DialogContent>
      <DialogActions sx={dialogSurfaceSx}>
        <Button onClick={handleClose} disabled={submitting} color="secondary" variant="contained">
          Cancel
        </Button>
        <Button onClick={handleConfirm} disabled={submitting} color="primary" variant="contained">
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default RenameJobDialog;
