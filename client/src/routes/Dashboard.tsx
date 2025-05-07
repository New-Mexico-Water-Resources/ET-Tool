import { Alert, Button, Snackbar, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo } from "react";
import { MapContainer, ScaleControl, ZoomControl } from "react-leaflet";
import useStore, { MapLayer } from "../utils/store";

import GeoJSONLayer from "../components/GeoJsonLayer";
import "../scss/Dashboard.scss";
import NavToolbar from "../components/NavToolbar";
import CurrentJobChip from "../components/CurrentJobChip";
import JobQueue from "../components/JobQueue";
import MultiGeoJSONLayer from "../components/MultiGeoJsonLayer";
import LayersControl from "../components/LayersControl";
import { useAuth0 } from "@auth0/auth0-react";
import LoginButton from "../components/LoginButton";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import UsersList from "../components/UsersList";
import MapLayersPanel from "../components/MapLayersPanel";
import { MAP_LAYER_OPTIONS, ET_COLORMAP, DIFF_COLORMAP, REFERENCE_GEOJSONS } from "../utils/constants";
import ActiveMapLayer from "../components/ActiveMapLayer";
import { CRS, Tooltip } from "leaflet";
import DrawControls from "../components/DrawControls";
import ActiveMonthlyMapLayer from "../components/ActiveMonthlyMapLayer";
import ColorScale from "../components/ColorScale";
import useCurrentJobStore from "../utils/currentJobStore";
import { atom } from "jotai";

export const tooltipAtom = atom<Tooltip | null>(null);

const Dashboard = () => {
  const loadedGeoJSON = useStore((state) => state.loadedGeoJSON);
  const multipolygons = useStore((state) => state.multipolygons);
  const locations = useStore((state) => state.locations);
  const showUploadDialog = useStore((state) => state.showUploadDialog);
  const [successMessage, setSuccessMessage] = useStore((state) => [state.successMessage, state.setSuccessMessage]);
  const [errorMessage, setErrorMessage] = useStore((state) => [state.errorMessage, state.setErrorMessage]);

  const setIsQueueOpen = useStore((state) => state.setIsQueueOpen);
  const setIsBacklogOpen = useStore((state) => state.setIsBacklogOpen);
  const setIsUsersPanelOpen = useStore((state) => state.setIsUsersPanelOpen);
  const setIsMapLayersPanelOpen = useStore((state) => state.setIsMapLayersPanelOpen);
  const isRightPanelOpen = useStore((state) => state.isRightPanelOpen);

  const [pollCount, increasePollCount] = useStore((state) => [state.pollCount, state.increasePollCount]);
  const fetchQueue = useStore((state) => state.fetchQueue);
  const reverifyEmail = useStore((state) => state.reverifyEmail);

  const { isAuthenticated, user, loginWithRedirect } = useAuth0();
  const userInfo = useStore((state) => state.userInfo);
  const canReadJobs = useMemo(() => userInfo?.permissions.includes("read:jobs"), [userInfo?.permissions]);
  const isAdmin = useMemo(() => userInfo?.permissions.includes("write:admin"), [userInfo?.permissions]);
  const fetchARDTiles = useStore((state) => state.fetchARDTiles);
  const showARDTiles = useStore((state) => state.showARDTiles);
  const ardTiles = useStore((state) => state.ardTiles);
  const fetchDroughtMonitorData = useStore((state) => state.fetchDroughtMonitorData);
  const droughtMonitorData = useStore((state) => state.droughtMonitorData);

  const visibleReferenceLayers = useStore((state) => state.visibleReferenceLayers);

  const visibleReferenceGeoJSONs = useMemo(() => {
    if (!visibleReferenceLayers || !REFERENCE_GEOJSONS) {
      return [];
    }

    return visibleReferenceLayers.map(
      (layer) => (REFERENCE_GEOJSONS as Record<string, { name: string; data?: any; droughtMonitor?: boolean }>)?.[layer]
    );
  }, [visibleReferenceLayers]);

  useEffect(() => {
    if (visibleReferenceGeoJSONs.some((layer) => layer.droughtMonitor)) {
      fetchDroughtMonitorData();
    }
  }, [fetchDroughtMonitorData, visibleReferenceGeoJSONs]);

  const mapLayerKey = useStore((state) => state.mapLayerKey);
  const tileDate = useStore((state) => state.tileDate);

  const [minBaseColor, maxBaseColor] = useStore((state) => [state.minimumBaseMapColorBound, state.maximumBaseMapColorBound]);
  const refreshType = useStore((state) => state.refreshType);
  const comparisonMode = useStore((state) => state.comparisonMode);

  const showPreview = useCurrentJobStore((state) => state.showPreview);

  const minColor = useMemo(() => {
    if (refreshType === "static") {
      return 0;
    } else {
      return minBaseColor || 0;
    }
  }, [minBaseColor, refreshType]);

  const maxColor = useMemo(() => {
    if (refreshType === "static") {
      return 200;
    } else {
      return maxBaseColor || 200;
    }
  }, [maxBaseColor, refreshType]);

  const colorScale = useMemo(() => {
    return comparisonMode === "absolute" ? ET_COLORMAP : DIFF_COLORMAP;
  }, [comparisonMode]);

  const activeMapLayer = useMemo(() => {
    let mapLayer = (MAP_LAYER_OPTIONS as any)?.[mapLayerKey] as MapLayer;
    if (!mapLayer) {
      mapLayer = MAP_LAYER_OPTIONS["Google Satellite"];
    }

    const layer = JSON.parse(JSON.stringify(mapLayer));
    if (tileDate) {
      layer.url = layer.url.replace("{time}", tileDate);
    } else if (layer.time) {
      layer.url = layer.url.replace("{time}", layer.time);
    }

    return layer;
  }, [mapLayerKey, tileDate]);

  const showColorScale = useMemo(() => {
    return !!activeMapLayer?.showColorScale;
  }, [activeMapLayer?.showColorScale]);

  useEffect(() => {
    if (showARDTiles && !Object.keys(ardTiles).length) {
      fetchARDTiles();
    }
  }, [showARDTiles, ardTiles, fetchARDTiles]);

  const loadVersion = useStore((state) => state.loadVersion);

  const handleKeyPress = useCallback(
    (event: any) => {
      const isMac = navigator.userAgent.includes("Mac");
      const isCmdOrCtrl = isMac ? event.metaKey : event.ctrlKey;

      if (isCmdOrCtrl && event.key === "b") {
        event.preventDefault();
        if (isRightPanelOpen) {
          setIsBacklogOpen(false);
          setIsQueueOpen(false);
          setIsUsersPanelOpen(false);
          setIsMapLayersPanelOpen(false);
        } else {
          setIsBacklogOpen(false);
          setIsUsersPanelOpen(false);
          setIsMapLayersPanelOpen(false);
          setIsQueueOpen(true);
        }
      }
    },
    [isRightPanelOpen, setIsBacklogOpen, setIsQueueOpen, setIsUsersPanelOpen, setIsMapLayersPanelOpen]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyPress);

    return () => {
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, [handleKeyPress]);

  useEffect(() => {
    fetchQueue();
  }, [pollCount, isAuthenticated, user?.email_verified]);

  // Poll for email verification
  useEffect(() => {
    const interval = setInterval(() => {
      if (isAuthenticated && !user?.email_verified) {
        loginWithRedirect();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isAuthenticated, user?.email_verified]);

  // Poll for permissions
  useEffect(() => {
    const interval = setInterval(() => {
      if (isAuthenticated && user?.email_verified && !canReadJobs) {
        loginWithRedirect();
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [isAuthenticated, user?.email_verified, canReadJobs]);

  useEffect(() => {
    loadVersion();

    const interval = setInterval(() => {
      increasePollCount();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isRightPanelOpen) {
      const controls = document.querySelectorAll(".leaflet-right .leaflet-control");
      controls.forEach((control) => {
        if (control instanceof HTMLElement && control) {
          control.style.marginRight = "310px";

          const drawActions = document.querySelectorAll(".leaflet-touch .leaflet-right .leaflet-draw-actions");
          drawActions.forEach((action) => {
            if (action instanceof HTMLElement && action) {
              action.style.right = showColorScale ? "78px" : "38px";
            }
          });
        }
      });
    } else {
      const controls = document.querySelectorAll(".leaflet-right .leaflet-control");
      controls.forEach((control) => {
        if (control instanceof HTMLElement && control) {
          control.style.marginRight = "10px";

          const drawActions = document.querySelectorAll(".leaflet-touch .leaflet-right .leaflet-draw-actions");
          drawActions.forEach((action) => {
            if (action instanceof HTMLElement && action) {
              action.style.right = showColorScale ? "78px" : "38px";
            }
          });
        }
      });
    }
  }, [isRightPanelOpen, showColorScale]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden" }}>
      <NavToolbar />
      {isAuthenticated && multipolygons.length <= 1 && <CurrentJobChip />}
      {isAuthenticated && showUploadDialog && <LayersControl />}
      {(!isAuthenticated || (!canReadJobs && userInfo)) && (
        <div
          style={{
            position: "absolute",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            background: "rgb(0 0 0 / 50%)",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: "var(--st-gray-90)",
              padding: "16px",
              borderRadius: "8px",
              display: "flex",
              flexDirection: "column",
              width: "600px",
              gap: "8px",
            }}
          >
            <Typography variant="h4" style={{ lineHeight: "8px", textAlign: "center" }}>
              <WaterDropIcon style={{ color: "var(--st-gray-30)", fontSize: "60px" }} />
            </Typography>
            <Typography
              variant="h4"
              style={{
                color: "white",
                textAlign: "center",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              New Mexico ET Reporting Tool
            </Typography>
            <Typography
              variant="h4"
              style={{ fontSize: "16px", color: "var(--st-gray-30)", textAlign: "center", marginBottom: "32px" }}
            >
              {!isAuthenticated
                ? "Please login or sign up for an account to continue"
                : user?.email_verified
                ? "Thanks for creating an account. Your email address has been verified. NM OSE staff will review your request for access shortly."
                : "Please verify your email address and then log out and back in to continue."}
            </Typography>
            {isAuthenticated && !user?.email_verified && (
              <Button
                variant="contained"
                onClick={() => {
                  if (user?.sub) {
                    reverifyEmail(user?.sub);
                  }
                }}
              >
                Resend Email
              </Button>
            )}
            {!isAuthenticated && <LoginButton title="Login/Sign Up" />}
          </div>
        </div>
      )}
      <JobQueue />
      {<MapLayersPanel />}
      {isAdmin && <UsersList />}
      <MapContainer
        className="map-container"
        center={[34.5199, -105.8701]}
        zoom={7}
        zoomControl={false}
        scrollWheelZoom={true}
        maxZoom={activeMapLayer.maxZoom}
        crs={CRS.EPSG3857}
      >
        <ActiveMonthlyMapLayer />
        <ActiveMapLayer />
        <ZoomControl position="topright" />
        <DrawControls />
        <ScaleControl position="bottomleft" />

        {showColorScale && (
          <ColorScale
            label={`${activeMapLayer?.name} (${
              tileDate
                ? new Date(tileDate).toLocaleString("default", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : new Date(activeMapLayer?.time).toLocaleString("default", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
            })`}
            maxValue={maxColor}
            minValue={minColor}
            colorScale={colorScale}
            style={{ right: isRightPanelOpen ? "350px" : "50px", transition: "right 0.1s ease" }}
          />
        )}
        {ardTiles && showARDTiles && <GeoJSONLayer data={ardTiles} validateBounds={false} fitToBounds={false} />}
        {visibleReferenceGeoJSONs.map((layer) => (
          <GeoJSONLayer
            key={layer.name}
            data={layer.droughtMonitor ? droughtMonitorData : layer.data}
            isDroughtMonitor={layer.droughtMonitor}
            validateBounds={false}
            fitToBounds={false}
            showLabels={true}
          />
        ))}
        <GeoJSONLayer
          data={loadedGeoJSON}
          showLabels={!showPreview}
          showAreaLabel={!showPreview}
          outline={showPreview}
          fitToBounds={!showPreview}
        />
        <MultiGeoJSONLayer data={multipolygons} locations={locations} />
      </MapContainer>
      <Snackbar
        open={successMessage.length > 0}
        autoHideDuration={5000}
        onClose={() => setSuccessMessage("")}
        message={successMessage}
      >
        <Alert onClose={() => setSuccessMessage("")} severity="success" variant="filled" sx={{ width: "100%" }}>
          {successMessage}
        </Alert>
      </Snackbar>
      <Snackbar open={errorMessage.length > 0} autoHideDuration={5000} onClose={() => setErrorMessage("")}>
        <Alert onClose={() => setErrorMessage("")} severity="error" variant="filled" sx={{ width: "100%" }}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </div>
  );
};

export default Dashboard;
