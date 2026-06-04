import CloseIcon from "@mui/icons-material/Close";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import SearchIcon from "@mui/icons-material/Search";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import L from "leaflet";
import { FC, useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap, useMapEvent } from "react-leaflet";
import { cdlPaletteRows, lookupCdlRgb } from "../utils/cdlCropRgbLookup";

function sampleTopRasterTilePixel(clientX: number, clientY: number, map: L.Map): { r: number; g: number; b: number } | null {
  const mapEl = map.getContainer();
  const imgs = mapEl.querySelectorAll(".leaflet-tile-pane img.leaflet-tile-loaded");
  let picked: HTMLImageElement | null = null;
  let pickedRect: DOMRect | null = null;
  for (const node of imgs) {
    const img = node as HTMLImageElement;
    if (!img.complete || !img.naturalWidth) {
      continue;
    }
    const r = img.getBoundingClientRect();
    if (clientX < r.left || clientX >= r.right || clientY < r.top || clientY >= r.bottom) {
      continue;
    }
    picked = img;
    pickedRect = r;
  }
  if (!picked || !pickedRect) {
    return null;

  }
  const sx = ((clientX - pickedRect.left) / (pickedRect.right - pickedRect.left)) * picked.naturalWidth;
  const sy = ((clientY - pickedRect.top) / (pickedRect.bottom - pickedRect.top)) * picked.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return null;
  }
  try {
    ctx.drawImage(picked, sx, sy, 1, 1, 0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  } catch {
    return null;
  }
}

export const CdlHoverIdentify: FC = () => {
  const map = useMap();
  const [tip, setTip] = useState<{ left: number; top: number; text: string } | null>(null);
  const rafRef = useRef<number>(0);

  const flushMove = useCallback(
    (e: L.LeafletMouseEvent) => {
      const ev = e.originalEvent;
      const rgb = sampleTopRasterTilePixel(ev.clientX, ev.clientY, map);
      if (!rgb) {
        setTip(null);
        return;
      }
      const label = lookupCdlRgb(rgb.r, rgb.g, rgb.b);
      if (!label) {
        setTip(null);
        return;
      }
      setTip({ left: ev.clientX + 14, top: ev.clientY + 14, text: label });
    },
    [map]
  );

  const onMouseMove = useCallback(
    (e: L.LeafletMouseEvent) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = requestAnimationFrame(() => flushMove(e));
    },
    [flushMove]
  );

  const clearTip = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    setTip(null);
  }, []);

  useMapEvent("mousemove", onMouseMove);
  useMapEvent("mouseout", clearTip);
  useMapEvent("zoomstart", clearTip);

  if (!tip) {
    return null;
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: tip.left,
        top: tip.top,
        zIndex: 12000,
        pointerEvents: "none",
        maxWidth: 320,
        padding: "8px 12px",
        background: "var(--st-gray-90)",
        border: "1px solid var(--st-gray-70)",
        borderRadius: 6,
        boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
        fontSize: 13,
        color: "var(--st-gray-20)",
        lineHeight: 1.35,
        whiteSpace: "pre-line",
      }}
    >
      {tip.text}
    </div>,
    document.body
  );
};

interface CdlLegendFabProps {
  title: string;
  rightPx: number;
}

const legendDlgPaperSx = {
  backgroundColor: "var(--st-gray-90)",
  color: "var(--st-gray-20)",
  border: "1px solid var(--st-gray-70)",
  borderRadius: 1,
  maxWidth: 440,
  width: "100%",
  maxHeight: "90vh",
  height: "min(72vh, 620px)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  backgroundImage: "none",
  boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
  "&::before": { display: "none" },
  "&::after": { display: "none" },
};

export const CdlLegendFab: FC<CdlLegendFabProps> = ({ title, rightPx }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const handleClose = useCallback(() => {
    setOpen(false);
    setSearch("");
  }, []);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return cdlPaletteRows;
    }

    return cdlPaletteRows.filter((row) => row.name.toLowerCase().includes(q));
  }, [search]);

  return (
    <>
      <Tooltip title="View Legend">
        <IconButton
          onClick={() => {
            setSearch("");
            setOpen(true);
          }}
          aria-label="Open cropland legend"
          sx={{
            position: "absolute",
            top: 12,
            right: rightPx,
            zIndex: 1000,
            backgroundColor: "var(--st-gray-80)",
            border: "1px solid var(--st-gray-70)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
            "&:hover": { backgroundColor: "var(--st-gray-70)" },
          }}
        >
          <MenuBookIcon sx={{ color: "var(--st-gray-30)" }} />
        </IconButton>
      </Tooltip>
      <Dialog
        open={open}
        onClose={handleClose}
        scroll="paper"
        slotProps={{
          paper: { elevation: 0, sx: legendDlgPaperSx },
        }}
      >
        <DialogTitle
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: 1.25,
            pr: 1,
            pb: 1.25,
            flexShrink: 0,
            borderBottom: "1px solid var(--st-gray-70)",
            color: "var(--st-gray-20)",
            fontWeight: 600,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.25 }}>
              <Typography component="span" sx={{ lineHeight: 1.3 }}>
                {title}
              </Typography>
              <Typography variant="caption" sx={{ color: "var(--st-gray-40)", fontWeight: 400, lineHeight: 1.35 }}>
                Some crops share the same color.
              </Typography>
            </Box>
            <IconButton
              onClick={handleClose}
              aria-label="Close legend"
              size="small"
              sx={{ flexShrink: 0, color: "var(--st-gray-30)" }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
          <TextField
            fullWidth
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search crops…"
            aria-label="Search legend crops"
            autoComplete="off"
            sx={{
              "& .MuiOutlinedInput-root": {
                backgroundColor: "var(--st-gray-80)",
                color: "var(--st-gray-20)",
                fontSize: "0.8125rem",
                "& fieldset": { borderColor: "var(--st-gray-60)" },
                "&:hover fieldset": { borderColor: "var(--st-gray-50)" },
                "&.Mui-focused fieldset": { borderColor: "var(--st-gray-40)" },
              },
            }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: "var(--st-gray-40)", fontSize: 20 }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </DialogTitle>
        <DialogContent
          onWheel={(ev) => ev.stopPropagation()}
          sx={{
            flex: 1,
            minHeight: 0,
            overscrollBehavior: "contain",
            overflowY: "auto",
            py: 1,
            px: 0,
            touchAction: "pan-y",
            color: "var(--st-gray-20)",
            borderColor: "var(--st-gray-70)",
          }}
        >
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {filteredRows.length === 0 ? (
              <Typography variant="body2" sx={{ px: 2, py: 2, color: "var(--st-gray-40)" }}>
                No crops match “{search.trim()}”.
              </Typography>
            ) : (
              filteredRows.map((row, i) => (
                <Box
                  key={`${row.r}-${row.g}-${row.b}-${row.name}-${i}`}
                  component="li"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.25,
                    px: 2,
                    py: 0.5,
                    "&:nth-of-type(even)": { backgroundColor: "rgba(255,255,255,0.06)" },
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      width: 22,
                      height: 22,
                      flexShrink: 0,
                      borderRadius: 0.5,
                      border: "1px solid var(--st-gray-60)",
                      backgroundColor: `rgb(${row.r},${row.g},${row.b})`,
                    }}
                  />
                  <Typography
                    variant="body2"
                    sx={{
                      color: "var(--st-gray-20)",
                      fontSize: "0.8125rem",
                      lineHeight: 1.4,
                      WebkitFontSmoothing: "antialiased",
                    }}
                  >
                    {row.name}
                  </Typography>
                </Box>
              ))
            )}
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};
