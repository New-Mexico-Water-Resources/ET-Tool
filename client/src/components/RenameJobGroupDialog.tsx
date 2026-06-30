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

type RenameJobGroupDialogProps = {
  groupId: string;
  groupName: string;
  open: boolean;
  onClose: () => void;
};

const dialogSurfaceSx = {
  backgroundColor: "var(--st-gray-90)",
  color: "var(--st-gray-10)",
};

const RenameJobGroupDialog = ({ groupId, groupName, open, onClose }: RenameJobGroupDialogProps) => {
  const setErrorMessage = useStore((state) => state.setErrorMessage);
  const setSuccessMessage = useStore((state) => state.setSuccessMessage);
  const renameJobGroup = useStore((state) => state.renameJobGroup);

  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setNewName(groupName);
      setSubmitting(false);
    }
  }, [open, groupName]);

  const handleClose = () => {
    if (submitting) {
      return;
    }
    onClose();
  };

  const handleConfirm = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      setErrorMessage("Enter a group name.");
      return;
    }

    if (trimmedName === groupName) {
      setErrorMessage("Enter a different name than the current group name.");
      return;
    }

    setSubmitting(true);
    try {
      await renameJobGroup(groupId, trimmedName);
      setSuccessMessage(`Group renamed to "${trimmedName}"`);
      onClose();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to rename group";
      setErrorMessage(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={dialogSurfaceSx}>Rename Group</DialogTitle>
      <DialogContent sx={dialogSurfaceSx}>
        <Typography variant="body2" sx={{ marginBottom: "12px" }}>
          Rename "{groupName}" for all jobs in this group.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          label="New group name"
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
            <Typography variant="body2">Renaming group...</Typography>
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

export default RenameJobGroupDialog;
