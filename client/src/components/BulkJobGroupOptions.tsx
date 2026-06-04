import { Box, Checkbox, FormControl, FormControlLabel, Input, InputLabel } from "@mui/material";
import { ChangeEvent } from "react";
import useStore from "../utils/store";

interface BulkJobGroupOptionsProps {
  visible: boolean;
}

const BulkJobGroupOptions = ({ visible }: BulkJobGroupOptionsProps) => {
  const [jobName, groupJobsTogether, setGroupJobsTogether, bulkGroupName, setBulkGroupName] = useStore((state) => [
    state.jobName,
    state.groupJobsTogether,
    state.setGroupJobsTogether,
    state.bulkGroupName,
    state.setBulkGroupName,
  ]);

  if (!visible) {
    return null;
  }

  const defaultGroupName = jobName.trim() || "Untitled Job";

  return (
    <Box
      className="bulk-job-group-options"
      sx={{
        py: 1,
        mb: 1,
        width: "100%",
        boxSizing: "border-box",
        borderRadius: 1,
        border: "1px solid var(--st-gray-80)",
        backgroundColor: "transparent",
      }}
    >
      <FormControlLabel
        control={
          <Checkbox
            checked={groupJobsTogether}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const checked = event.target.checked;
              setGroupJobsTogether(checked);
              if (checked && !bulkGroupName.trim()) {
                setBulkGroupName(defaultGroupName);
              }
            }}
            sx={{
              color: "var(--st-gray-40)",
              "&.Mui-checked": { color: "primary.main" },
            }}
          />
        }
        label="Group jobs together"
        sx={{ color: "var(--st-gray-20)", ml: 0, mb: 0, px: 1 }}
      />
      <FormControl fullWidth size="small" disabled={!groupJobsTogether} sx={{ mt: 1, px: 1 }}>
        <InputLabel htmlFor="bulk-group-name-field" sx={{ color: "var(--st-gray-40)" }}>
          Group name
        </InputLabel>
        <Input
          id="bulk-group-name-field"
          value={bulkGroupName}
          placeholder={defaultGroupName}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            setBulkGroupName(event.target.value);
          }}
          sx={{ color: "var(--st-gray-10)" }}
        />
      </FormControl>
    </Box>
  );
};

export default BulkJobGroupOptions;
