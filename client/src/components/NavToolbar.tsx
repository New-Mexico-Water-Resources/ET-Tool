import {
  AppBar,
  Avatar,
  Badge,
  Box,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Modal,
  Skeleton,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { useAuth0 } from "@auth0/auth0-react";
import ViewStreamIcon from "@mui/icons-material/ViewStream";
import PendingActionsIcon from "@mui/icons-material/PendingActions";
import AddIcon from "@mui/icons-material/Add";
import Logout from "@mui/icons-material/Logout";
import GroupIcon from "@mui/icons-material/Group";
import CloseIcon from "@mui/icons-material/Close";
import LayersIcon from "@mui/icons-material/Layers";

import Markdown from "react-markdown";

import useStore from "../utils/store";
import { FC, useEffect, useMemo, useState } from "react";
import LoginButton from "./LoginButton";
import { ROLES } from "../utils/constants";

import changelog from "../../CHANGELOG.md?raw";
import { useNavigate } from "react-router";

const Profile = () => {
  const { user, isAuthenticated, isLoading, logout } = useAuth0();
  const fetchQueue = useStore((state) => state.fetchQueue);
  const fetchUserInfo = useStore((state) => state.fetchUserInfo);

  useEffect(() => {
    if (isAuthenticated) {
      fetchQueue();
      fetchUserInfo();
    }
  }, [user, isAuthenticated]);

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  if (isLoading) {
    return <Skeleton variant="circular" width={32} height={32} sx={{ marginRight: "8px" }} />;
  }

  return isAuthenticated ? (
    <div>
      <Avatar
        sx={{ width: 32, height: 32, marginRight: "8px", cursor: "pointer" }}
        onClick={(event: React.MouseEvent<HTMLElement>) => {
          setAnchorEl(event.currentTarget);
        }}
      >
        <img style={{ width: "32px", borderRadius: "50%" }} src={user?.picture} alt={user?.name} />
      </Avatar>
      <Menu
        anchorEl={anchorEl}
        id="account-menu"
        open={open}
        onClose={() => setAnchorEl(null)}
        onClick={() => setAnchorEl(null)}
        sx={{
          "& .MuiPaper-root": {
            background: "var(--st-gray-100)",
            overflow: "visible",
            filter: "drop-shadow(0px 2px 8px rgba(0,0,0,0.32))",
            mt: 1.5,
            "&::before": {
              content: '""',
              display: "block",
              position: "absolute",
              top: 0,
              right: 14,
              width: 10,
              height: 10,
              bgcolor: "var(--st-gray-100)",
              transform: "translateY(-50%) rotate(45deg)",
              zIndex: 0,
            },
          },
        }}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <MenuItem onClick={() => setAnchorEl(null)}>
          <Avatar sx={{ width: 32, height: 32, marginRight: "8px", cursor: "pointer" }}>
            <img style={{ width: "32px", borderRadius: "50%" }} src={user?.picture} alt={user?.name} />
          </Avatar>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span className="name">{user?.name}</span>
            <div
              className="info"
              style={{ display: "flex", flexDirection: "column", fontSize: "12px", color: "var(--st-gray-30)" }}
            >
              <span className="email">{user?.email}</span>
              <span className="role">{user?.role}</span>
            </div>
          </div>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            logout({
              logoutParams: {
                returnTo: window.location.origin,
              },
            });
          }}
        >
          <ListItemIcon>
            <Logout fontSize="small" />
          </ListItemIcon>
          Logout
        </MenuItem>
      </Menu>
    </div>
  ) : (
    <LoginButton />
  );
};

const NavToolbar: FC<{ publicMode?: boolean }> = ({ publicMode }) => {
  const [isQueueOpen, setIsQueueOpen] = useStore((state) => [state.isQueueOpen, state.setIsQueueOpen]);
  const [isBacklogOpen, setIsBacklogOpen] = useStore((state) => [state.isBacklogOpen, state.setIsBacklogOpen]);
  const [isUsersPanelOpen, setIsUsersPanelOpen] = useStore((state) => [state.isUsersPanelOpen, state.setIsUsersPanelOpen]);
  const [isMapLayersPanelOpen, setIsMapLayersPanelOpen] = useStore((state) => [
    state.isMapLayersPanelOpen,
    state.setIsMapLayersPanelOpen,
  ]);

  const startNewJob = useStore((state) => state.startNewJob);
  const queue = useStore((state) => state.queue);
  const { isAuthenticated } = useAuth0();
  const userInfo = useStore((state) => state.userInfo);
  const version = useStore((state) => state.version);
  const lastSeenVersion = useStore((state) => state.lastSeenVersion);

  const markVersionSeen = useStore((state) => state.markVersionSeen);
  const hasSeenLatestVersion = useMemo(() => lastSeenVersion === version, [lastSeenVersion, version]);

  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);

  const canSubmitJobs = useMemo(
    () => userInfo?.permissions.includes("submit:jobs") || userInfo?.permissions.includes("write:jobs"),
    [userInfo?.permissions]
  );
  const canReadJobs = useMemo(() => userInfo?.permissions.includes("read:jobs"), [userInfo?.permissions]);
  const isAdmin = useMemo(() => userInfo?.permissions.includes("write:admin"), [userInfo?.permissions]);

  const users = useStore((state) => state.users);
  const newUsers = useMemo(
    () => users.filter((user) => user.roles.length <= 1 && user.roles.find((role) => role.id === ROLES.NEW_USER)),
    [users]
  );

  const navigate = useNavigate();

  return (
    <AppBar className="nav-area" position="static">
      <Toolbar
        variant="dense"
        style={{
          display: "flex",
          width: "100%",
          minHeight: "45px",
          gap: "8px",
          paddingLeft: "8px",
          paddingRight: 0,
          borderBottom: "1px solid #1b1d1e",
        }}
      >
        <img src="/favicon.png" alt="New Mexico ET Reporting Tool" style={{ height: "32px" }} />
        <Typography
          variant="h6"
          noWrap
          component="div"
          sx={{
            display: { xs: "none", md: "flex" },
            color: "var(--st-gray-20)",
            textDecoration: "none",
            cursor: publicMode ? "pointer" : "default",
          }}
          onClick={() => {
            if (publicMode) {
              navigate("/");
            }
          }}
        >
          New Mexico ET Reporting Tool
        </Typography>
        <Modal
          sx={{ ":focus": { outline: "none" } }}
          open={releaseNotesOpen}
          onClose={() => setReleaseNotesOpen(false)}
          aria-labelledby="release-notes-title"
          aria-describedby="release-notes"
        >
          <Box
            sx={{
              ":focus": { outline: "none" },
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 600,
              height: 600,
              bgcolor: "var(--st-gray-90)",
              border: "2px solid var(--st-gray-100)",
              borderRadius: "4px",
              boxShadow: 24,
            }}
          >
            <IconButton
              sx={{ position: "absolute", right: 12, top: 12, cursor: "pointer" }}
              onClick={() => setReleaseNotesOpen(false)}
            >
              <CloseIcon />
            </IconButton>
            <Box sx={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "16px" }}>
              <Typography id="release-notes-title" variant="h6" component="h2">
                Release Notes
              </Typography>
              <Typography
                id="release-notes"
                sx={{
                  mt: 2,
                  maxHeight: 516,
                  overflowY: "auto",
                  border: "1px solid var(--st-gray-80)",
                  background: "var(--st-gray-100)",
                  borderRadius: "4px",
                  padding: "8px",
                }}
              >
                <Markdown>{changelog}</Markdown>
              </Typography>
            </Box>
          </Box>
        </Modal>
        <Typography
          noWrap
          component="div"
          sx={{
            fontSize: "12px",
            display: "flex",
            color: hasSeenLatestVersion ? "var(--st-gray-30)" : "yellow",
            textDecoration: "none",
            fontWeight: hasSeenLatestVersion ? "normal" : 800,
            cursor: "pointer",
            padding: "0 8px",
            borderRadius: "4px",
            backgroundColor: hasSeenLatestVersion ? "var(--st-gray-80)" : "rgba(255, 255, 0, 0.1)",
            ":hover": { backgroundColor: "var(--st-gray-70)", color: "var(--st-gray-10)" },
          }}
          onClick={() => {
            if (!hasSeenLatestVersion) {
              markVersionSeen();
            }
            setReleaseNotesOpen(true);
          }}
        >
          v{version}
        </Typography>
        {!publicMode && (
          <Tooltip
            title={
              isAuthenticated
                ? canSubmitJobs
                  ? "Configure a new job"
                  : "You don't have permission to create jobs"
                : "You must be logged in to start a job"
            }
          >
            <Typography
              color="inherit"
              component="div"
              sx={{
                display: "flex",
                alignItems: "center",
                color: "var(--st-gray-30)",
                cursor: "pointer",
                padding: "0 8px",
                height: "100%",
                userSelect: "none",
                ":hover":
                  isAuthenticated && canSubmitJobs
                    ? { color: "var(--st-gray-10)", backgroundColor: "var(--st-gray-80)" }
                    : {},
              }}
              onClick={() => {
                if (isAuthenticated && canSubmitJobs) {
                  startNewJob();
                }
              }}
            >
              <AddIcon />
              New
            </Typography>
          </Tooltip>
        )}

        {/* Branding */}
        {/* <div
          style={{
            display: "flex",
            alignItems: "center",
            height: "calc(100% - 8px)",
            borderLeft: "1px solid var(--st-gray-70)",
            paddingLeft: "8px",
            marginTop: "auto",
            marginBottom: "auto",
          }}
        >
          <img
            src="/src/assets/logos/jpl-white.png"
            alt="NASA Jet Propulsion Laboratory/California Institute of Technology"
            style={{ height: "100%" }}
          />
          <img
            src="/src/assets/logos/chapman-white-on-black-transparent.png"
            alt="Chapman University"
            style={{ height: "calc(100% - 8px)" }}
          />
        </div> */}
        {!publicMode && (
          <Box sx={{ ml: "auto", display: "flex", height: "100%", alignItems: "center" }}>
            <Tooltip title={canReadJobs ? "View in progress jobs" : "You don't have permission to view the job queue"}>
              <Box
                className={`nav-item ${isQueueOpen ? "active" : ""}`}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  height: "100%",
                  cursor: "pointer",
                  ":hover": { backgroundColor: "var(--st-gray-80)", color: "var(--st-gray-10)" },
                }}
                onClick={() => {
                  setIsQueueOpen(!isQueueOpen);
                }}
              >
                <Badge badgeContent={queue.length} color="primary">
                  <Typography
                    color="inherit"
                    component="div"
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      padding: "0 8px",
                      height: "fit-content",
                      gap: "4px",
                    }}
                  >
                    <PendingActionsIcon />
                    In Progress
                  </Typography>
                </Badge>
              </Box>
            </Tooltip>
            <Tooltip title={canReadJobs ? "View completed jobs" : "You don't have permission to view completed jobs"}>
              <Box
                className={`nav-item ${isBacklogOpen ? "active" : ""}`}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  height: "100%",
                  cursor: "pointer",
                  ":hover": { backgroundColor: "var(--st-gray-80)", color: "var(--st-gray-10)" },
                }}
                onClick={() => {
                  setIsBacklogOpen(!isBacklogOpen);
                }}
              >
                <Typography
                  color="inherit"
                  component="div"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    padding: "0 8px",
                    height: "fit-content",
                    gap: "4px",
                  }}
                >
                  <ViewStreamIcon />
                  Completed
                </Typography>
              </Box>
            </Tooltip>
            <Divider orientation="vertical" flexItem sx={{ margin: "0 8px" }} />
            <Box
              className={`nav-item ${isMapLayersPanelOpen ? "active" : ""}`}
              sx={{
                display: "flex",
                alignItems: "center",
                height: "100%",
                cursor: "pointer",
                ":hover": { backgroundColor: "var(--st-gray-80)", color: "var(--st-gray-10)" },
              }}
              onClick={() => {
                setIsMapLayersPanelOpen(!isMapLayersPanelOpen);
              }}
            >
              <Typography
                color="inherit"
                component="div"
                sx={{
                  display: "flex",
                  alignItems: "center",
                  padding: "0 8px",
                  height: "fit-content",
                  gap: "4px",
                }}
              >
                <LayersIcon />
                Map Layers
              </Typography>
            </Box>
            <Divider orientation="vertical" flexItem sx={{ margin: "0 8px" }} />
            {isAdmin && (
              <Tooltip title="View Users">
                <Box
                  className={`nav-item ${isUsersPanelOpen ? "active" : ""}`}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    height: "100%",
                    cursor: "pointer",
                    ":hover": { backgroundColor: "var(--st-gray-80)", color: "var(--st-gray-10)" },
                  }}
                  onClick={() => {
                    setIsUsersPanelOpen(!isUsersPanelOpen);
                  }}
                >
                  <Badge badgeContent={newUsers.length} color="primary">
                    <Typography
                      color="inherit"
                      component="div"
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        padding: "0 8px",
                        height: "fit-content",
                        gap: "4px",
                      }}
                    >
                      <GroupIcon />
                      Users
                    </Typography>
                  </Badge>
                </Box>
              </Tooltip>
            )}
            <Divider orientation="vertical" flexItem sx={{ marginLeft: "8px" }} />
          </Box>
        )}
        {!publicMode && <Profile />}
      </Toolbar>
    </AppBar>
  );
};

export default NavToolbar;
