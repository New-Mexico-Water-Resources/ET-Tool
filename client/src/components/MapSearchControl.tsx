import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import Autocomplete from "@mui/material/Autocomplete";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import L from "leaflet";
import { useCallback, useEffect, useRef, useState, type FormEvent, type MutableRefObject, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-leaflet";
import useStore from "../utils/store";

function parseLatLon(raw: string): { lat: number; lng: number } | null {
  const t = raw.trim();
  if (!t) {
    return null;
  }

  const commaMatch = t.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if (commaMatch) {
    const a = parseFloat(commaMatch[1]);
    const b = parseFloat(commaMatch[2]);
    return normalizeLatLngPair(a, b);
  }

  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 2) {
    const a = parseFloat(parts[0]);
    const b = parseFloat(parts[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return null;
    }
    return normalizeLatLngPair(a, b);
  }

  return null;
}

function normalizeLatLngPair(a: number, b: number): { lat: number; lng: number } | null {
  const asLatFirst = Math.abs(a) <= 90 && Math.abs(b) <= 180;
  const asLonFirst = Math.abs(b) <= 90 && Math.abs(a) <= 180 && Math.abs(a) > 90;

  if (asLatFirst && !asLonFirst) {
    return { lat: a, lng: b };
  }
  if (asLonFirst || (!asLatFirst && Math.abs(b) <= 90 && Math.abs(a) <= 180)) {
    return { lat: b, lng: a };
  }
  if (asLatFirst) {
    return { lat: a, lng: b };
  }
  return null;
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const ADDRESS_SUGGEST_DEBOUNCE_MS = 380;
const ADDRESS_SUGGEST_MIN_CHARS = 3;
const ADDRESS_SUGGEST_LIMIT = 8;

type AddressSuggestion = {
  display_name: string;
  lat: number;
  lon: number;
};

async function fetchAddressSuggestions(query: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const params = new URLSearchParams({
    format: "json",
    q: query,
    limit: String(ADDRESS_SUGGEST_LIMIT),
    countrycodes: "us",
    email: "water.nm@ose.nm.gov",
  });
  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
    },
    signal,
  });

  if (!res.ok) {
    return [];
  }

  const data = (await res.json()) as { lat: string; lon: string; display_name?: string }[];
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .map((row) => ({
      display_name: row.display_name?.trim() ?? "",
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
    }))
    .filter((row) => row.display_name.length > 0 && Number.isFinite(row.lat) && Number.isFinite(row.lon));
}

async function geocodeAddress(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const params = new URLSearchParams({
    format: "json",
    q: query,
    limit: "1",
    countrycodes: "us",
    email: "water.nm@ose.nm.gov",
  });
  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
    },
  });

  if (!res.ok) {
    throw new Error(`Geocoding request failed (${res.status})`);
  }

  const data = (await res.json()) as { lat: string; lon: string; display_name?: string }[];
  if (!data?.length) {
    return null;
  }

  const hit = data[0];
  const lat = parseFloat(hit.lat);
  const lng = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng,
    label: hit.display_name ?? query,
  };
}

const SearchControlInner = ({ map }: { map: L.Map }) => {
  const setErrorMessage = useStore((s) => s.setErrorMessage);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const markerRef = useRef<L.Marker | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const suggestAbortRef = useRef<AbortController | null>(null);

  const clearMarker = useCallback(() => {
    const current = markerRef.current;
    if (current) {
      const m = current as L.Marker & { _mapSearchSkipPopupClose?: boolean };
      m._mapSearchSkipPopupClose = true;
      map.removeLayer(current);
      markerRef.current = null;
    }
  }, [map]);

  useEffect(() => {
    return () => clearMarker();
  }, [clearMarker]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const onDocPointerDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) {
        return;
      }
      if (wrapRef.current?.contains(el)) {
        return;
      }
      if (el.closest(".MuiAutocomplete-popper")) {
        return;
      }
      setExpanded(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    return () => document.removeEventListener("pointerdown", onDocPointerDown, true);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) {
      suggestAbortRef.current?.abort();
      suggestAbortRef.current = null;
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    const q = query.trim();
    if (q.length < ADDRESS_SUGGEST_MIN_CHARS || parseLatLon(q)) {
      suggestAbortRef.current?.abort();
      suggestAbortRef.current = null;
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      suggestAbortRef.current?.abort();
      const ac = new AbortController();
      suggestAbortRef.current = ac;
      setSuggestionsLoading(true);
      fetchAddressSuggestions(q, ac.signal)
        .then((rows) => {
          if (!ac.signal.aborted) {
            setSuggestions(rows);
          }
        })
        .catch(() => {
          if (!ac.signal.aborted) {
            setSuggestions([]);
          }
        })
        .finally(() => {
          if (!ac.signal.aborted) {
            setSuggestionsLoading(false);
          }
        });
    }, ADDRESS_SUGGEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      suggestAbortRef.current?.abort();
    };
  }, [expanded, query]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  const goTo = useCallback(
    (lat: number, lng: number, title?: string) => {
      clearMarker();
      const z = Math.min(map.getMaxZoom(), 14);
      map.setView([lat, lng], z);
      const marker = L.marker([lat, lng]);
      const label = title ?? `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      const popupBody = document.createElement("div");
      popupBody.className = "map-search-popup-body";
      popupBody.textContent = label;

      marker.bindPopup(popupBody, {
        autoClose: false,
        closeOnClick: false,
      });

      marker.on("popupclose", () => {
        const m = marker as L.Marker & { _mapSearchSkipPopupClose?: boolean };
        if (m._mapSearchSkipPopupClose) {
          return;
        }
        if (markerRef.current === marker) {
          map.removeLayer(marker);
          markerRef.current = null;
        }
      });

      marker.addTo(map);
      markerRef.current = marker;
      marker.openPopup();
    },
    [clearMarker, map]
  );

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || busy) {
      return;
    }

    const coords = parseLatLon(q);
    if (coords) {
      goTo(coords.lat, coords.lng, `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`);
      return;
    }

    setBusy(true);
    try {
      const result = await geocodeAddress(q);
      if (!result) {
        setErrorMessage("No results found for that search.");
        return;
      }
      goTo(result.lat, result.lng, result.label);
    } catch {
      setErrorMessage("Could not reach the geocoding service. Try again later.");
    } finally {
      setBusy(false);
    }
  }, [busy, goTo, query, setErrorMessage]);

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      void runSearch();
    },
    [runSearch]
  );

  const onAutocompleteChange = useCallback(
    (_event: SyntheticEvent, value: string | AddressSuggestion | null) => {
      if (value && typeof value !== "string") {
        goTo(value.lat, value.lon, value.display_name);
        setExpanded(false);
      }
    },
    [goTo]
  );

  return (
    <div
      ref={wrapRef}
      className={expanded ? "map-search-root map-search-root--expanded" : "map-search-root map-search-root--collapsed"}
    >
      {!expanded ? (
        <Tooltip title="Search by address or lat, lon">
          <IconButton
            type="button"
            size="small"
            disableRipple
            onClick={() => setExpanded(true)}
            aria-label="Open map search"
            aria-expanded={false}
            className="map-search-icon-only"
            sx={{
              color: "#333",
              border: "none",
              boxShadow: "none",
              borderRadius: "4px",
              backgroundColor: "#fff",
              "@media (hover: hover)": {
                "&:hover": {
                  backgroundColor: "#e8e8e8 !important",
                },
              },
              "&:focus-visible": { outline: "2px solid rgba(25, 118, 210, 0.5)", outlineOffset: 1 },
              "&.Mui-disabled": { color: "rgba(0, 0, 0, 0.26)" },
            }}
          >
            <SearchIcon sx={{ fontSize: 22 }} />
          </IconButton>
        </Tooltip>
      ) : (
        <form className="map-search-form" onSubmit={onSubmit} aria-expanded>
          <Autocomplete
            freeSolo
            fullWidth
            className="map-search-autocomplete"
            sx={{
              flex: "1 1 0",
              minWidth: 0,
              width: "100%",
              maxWidth: "100%",
              height: "100%",
              "& .MuiFormControl-root": { margin: 0, height: "100%", width: "100%", maxWidth: "100%" },
              "& .MuiTextField-root": { margin: 0, height: "100%", width: "100%", maxWidth: "100%" },
              "& .MuiAutocomplete-inputRoot": {
                paddingTop: "0 !important",
                paddingBottom: "0 !important",
                paddingLeft: "8px !important",
                paddingRight: "6px !important",
                minHeight: "0 !important",
                height: "100% !important",
                maxHeight: "100%",
                width: "100% !important",
                maxWidth: "100%",
                alignItems: "center",
                flexWrap: "nowrap",
                borderRadius: 0,
              },
              "& .MuiAutocomplete-input": {
                flex: "1 1 0",
                minWidth: "0 !important",
                width: "100% !important",
                maxWidth: "100%",
                padding: "0 !important",
                height: "auto",
                minHeight: "0 !important",
                lineHeight: 1.25,
                fontSize: 13,
                boxSizing: "border-box",
              },
              "& .MuiAutocomplete-endAdornment": {
                position: "static",
                marginRight: 0,
                alignSelf: "center",
                transform: "none",
                flexShrink: 0,
              },
            }}
            options={suggestions}
            loading={suggestionsLoading}
            filterOptions={(opts) => opts}
            inputValue={query}
            onInputChange={(_e, value) => setQuery(value)}
            onChange={onAutocompleteChange}
            disabled={busy}
            getOptionLabel={(option) => (typeof option === "string" ? option : option.display_name)}
            isOptionEqualToValue={(a, b) => {
              if (typeof a === "string" || typeof b === "string") {
                return a === b;
              }
              return a.lat === b.lat && a.lon === b.lon && a.display_name === b.display_name;
            }}
            slotProps={{
              popper: {
                className: "map-search-autocomplete-popper",
                sx: {
                  zIndex: 4000,
                  /* Popper content uses dark-theme Paper by default; force light surfaces */
                  "& .MuiPaper-root": {
                    bgcolor: "#fff !important",
                    color: "#333",
                    backgroundImage: "none",
                    border: "1px solid rgba(0, 0, 0, 0.12)",
                    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.12)",
                  },
                  "& .MuiAutocomplete-noOptions": {
                    bgcolor: "#fff",
                    color: "rgba(0, 0, 0, 0.55)",
                  },
                  "& .MuiAutocomplete-loading": {
                    bgcolor: "#fff",
                    color: "rgba(0, 0, 0, 0.55)",
                  },
                  "& .MuiCircularProgress-root": {
                    color: "rgba(0, 0, 0, 0.45)",
                  },
                },
              },
              listbox: {
                sx: {
                  bgcolor: "#fff",
                  color: "#333",
                  py: 0.5,
                  maxHeight: 260,
                  fontSize: 13,
                  "& .MuiAutocomplete-option": {
                    py: 0.75,
                    color: "#333",
                    alignItems: "flex-start",
                    whiteSpace: "normal",
                    "&:hover": {
                      bgcolor: "rgba(0, 0, 0, 0.06)",
                    },
                    '&[aria-selected="true"]': {
                      bgcolor: "rgba(0, 0, 0, 0.08)",
                    },
                    "&.Mui-focused": {
                      bgcolor: "rgba(0, 0, 0, 0.06)",
                    },
                  },
                },
              },
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                fullWidth
                variant="standard"
                hiddenLabel
                placeholder="Address or lat, lon"
                InputProps={{
                  ...params.InputProps,
                  disableUnderline: true,
                }}
                inputProps={{
                  ...params.inputProps,
                  "aria-label": "Search map by address or coordinates",
                  enterKeyHint: "search",
                  ref: (node: HTMLInputElement | null) => {
                    inputRef.current = node;
                    const r = params.inputProps.ref;
                    if (typeof r === "function") {
                      r(node);
                    } else if (r != null && typeof r === "object" && "current" in r) {
                      (r as MutableRefObject<HTMLInputElement | null>).current = node;
                    }
                  },
                }}
                sx={{
                  width: "100%",
                  maxWidth: "100%",
                  height: "100%",
                  "& .MuiInputBase-root": {
                    fontSize: 13,
                    color: "#333",
                    height: "100%",
                    width: "100%",
                    maxWidth: "100%",
                  },
                  "& .MuiInputBase-input": {
                    padding: "0 !important",
                    minWidth: 0,
                    width: "100%",
                    maxWidth: "100%",
                    color: "#333",
                    "&::placeholder": {
                      color: "rgba(0, 0, 0, 0.45)",
                      opacity: 1,
                    },
                  },
                }}
              />
            )}
          />
          <IconButton
            type="submit"
            size="small"
            disableRipple
            disabled={busy || !query.trim()}
            aria-label="Search"
            className="map-search-toolbar-btn"
          >
            <SearchIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton
            type="button"
            size="small"
            disableRipple
            disabled={busy}
            aria-label="Close search"
            onClick={() => setExpanded(false)}
            className="map-search-toolbar-btn"
            sx={{ borderLeft: "1px solid rgba(0, 0, 0, 0.12)" }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </form>
      )}
    </div>
  );
};

function moveSearchControlToBottomOfTopRight(ctrl: L.Control, map: L.Map): void {
  const pane = map.getContainer().querySelector(".leaflet-top.leaflet-right");
  const el = ctrl.getContainer?.();
  if (!pane || !el || el.parentElement !== pane) {
    return;
  }
  pane.appendChild(el);
}

const MapSearchControl = () => {
  const map = useMap();
  const [mountEl, setMountEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const Control = L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const el = L.DomUtil.create("div", "leaflet-control map-search-leaflet-control") as HTMLDivElement;
        L.DomEvent.disableClickPropagation(el);
        L.DomEvent.disableScrollPropagation(el);
        setMountEl(el);
        return el;
      },
      onRemove() {
        setMountEl(null);
      },
    });

    const ctrl = new Control();
    ctrl.addTo(map);

    const bump = () => moveSearchControlToBottomOfTopRight(ctrl, map);
    bump();
    requestAnimationFrame(bump);
    const lateBump = window.setTimeout(bump, 120);

    return () => {
      window.clearTimeout(lateBump);
      ctrl.remove();
    };
  }, [map]);

  if (!mountEl) {
    return null;
  }

  return createPortal(<SearchControlInner map={map} />, mountEl);
};

export default MapSearchControl;
