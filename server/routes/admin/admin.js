const express = require("express");
const router = express.Router();
const constants = require("../../constants");
const { ManagementClient } = require("auth0");
const { sendTestJobNotificationEmail } = require("../../utils/jobNotificationEmail");
const { getAppFeatures, updateAppFeatures, areJobNotificationsActive } = require("../../utils/appSettings");
const { ensureUserProfile } = require("../../utils/userPreferences");

const cachedUsers = {
  data: [],
  lastUpdated: 0,
  page: 0,
  total: 0,
};

const DEEP_CACHE_DURATION = 2 * 60000; // 2 minutes
const SHALLOW_CACHE_DURATION = 600000; // 10 minutes

function hasManagementApiCredentials() {
  return Boolean(
    constants.auth0_domain &&
      constants.auth0_management_client_id &&
      constants.auth0_management_client_secret
  );
}

function createManagementClient() {
  return new ManagementClient({
    domain: constants.auth0_domain,
    clientId: constants.auth0_management_client_id,
    clientSecret: constants.auth0_management_client_secret,
    scope: "read:users read:roles write:admin",
    audience: `https://${constants.auth0_domain}/api/v2/`,
    grantType: "client_credentials",
  });
}

let managementClient = null;

function getManagementClient() {
  if (!hasManagementApiCredentials()) {
    throw new Error("Auth0 Management API credentials are not configured");
  }

  if (!managementClient) {
    managementClient = createManagementClient();
  }

  return managementClient;
}

if (!hasManagementApiCredentials()) {
  console.warn(
    "Auth0 Management API credentials are missing. Set AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET."
  );
}

async function fetchUsers(requestedPage, client) {
  try {
    const {
      data: { users, total },
    } = await client.users.getAll({
      include_totals: true,
      page: requestedPage,
      per_page: 25,
    });

    const usersWithPermissions = await Promise.all(
      users.map(async (user) => {
        const permissionsResponse = await client.users.getPermissions({ id: user.user_id });
        user.permissions = (permissionsResponse?.data || []).map((permission) => permission.permission_name);

        const rolesResponse = await client.users.getRoles({ id: user.user_id });
        user.roles = (rolesResponse?.data || []).map((role) => ({ name: role.name, id: role.id }));
        return user;
      })
    );

    return { users: usersWithPermissions, total };
  } catch (error) {
    console.error("Error fetching users from Auth0:", error);
    throw error;
  }
}

function sendUsersResponse(res, users, total, page) {
  res.status(200).send({ users, total, page });
}

router.get("/users", async (req, res) => {
  let canReadUsers = req.auth?.payload?.permissions?.includes("read:users") || false;
  if (!canReadUsers) {
    res.status(401).send({ error: "Unauthorized: missing read:users permission" });
    return;
  }

  if (!hasManagementApiCredentials()) {
    res.status(503).send({ error: "Auth0 Management API is not configured on this server" });
    return;
  }

  const page = Number.parseInt(req.query.page, 10) || 0;

  try {
    const client = getManagementClient();
    const lastUpdateTimeString = new Date(cachedUsers?.lastUpdated || 0).toLocaleString();

    if (cachedUsers.lastUpdated > Date.now() - DEEP_CACHE_DURATION && cachedUsers.page === page) {
      console.log("Returning cached users, last updated", `\x1b[32m${lastUpdateTimeString}\x1b[0m`);
      sendUsersResponse(res, cachedUsers.data, cachedUsers.total, page);
      return;
    }

    const allUsers = await client.users.getAll({ include_totals: true, per_page: 1 });
    const totalUsers = allUsers.data.total;

    if (
      cachedUsers.lastUpdated > Date.now() - SHALLOW_CACHE_DURATION &&
      cachedUsers.total === totalUsers &&
      cachedUsers.page === page
    ) {
      console.log("Returning cached users, count is the same, last updated", `\x1b[32m${lastUpdateTimeString}\x1b[0m`);
      sendUsersResponse(res, cachedUsers.data, cachedUsers.total, page);
      return;
    }

    const { users, total } = await fetchUsers(page, client);
    cachedUsers.data = users;
    cachedUsers.total = total;
    cachedUsers.page = page;
    cachedUsers.lastUpdated = Date.now();
    sendUsersResponse(res, users, total, page);
  } catch (error) {
    if (error?.errorCode === "too_many_requests") {
      console.log("Too many requests to Auth0:", error);
      res.status(429).send({ error: "Too many requests to Auth0, rate limit reached." });
      return;
    }

    console.error("Failed to fetch users:", error?.message || error);
    res.status(500).send({ error: "Failed to fetch users" });
  }
});

router.delete("/delete_user", async (req, res) => {
  let canDeleteUsers = req.auth?.payload?.permissions?.includes("write:admin") || false;
  if (!canDeleteUsers) {
    res.status(401).send("Unauthorized: missing write:admin permission");
    return;
  }

  let userId = req.query.userId;
  if (!userId) {
    res.status(400).send({ error: "Missing userId" });
    return;
  }

  try {
    await getManagementClient().users.delete({ id: userId });
    res.status(200).send("User deleted");
  } catch (error) {
    console.error("Failed to delete user from Auth0:", error);
    res.status(500).send({ error: "Failed to delete user" });
  }
});

router.post("/update_user", async (req, res) => {
  let canUpdateUsers = req.auth?.payload?.permissions?.includes("write:admin") || false;
  if (!canUpdateUsers) {
    res.status(401).send({ error: "Unauthorized: missing write:admin permission" });
    return;
  }

  let userId = req.body.userId;
  let roles = req.body.roles;
  if (!userId) {
    res.status(400).send({ error: "Missing userId" });
    return;
  }

  try {
    const client = getManagementClient();

    if (!roles || roles.length === 0) {
      roles = [constants.auth0_new_user_role];
    }

    let response = await client.users.getRoles({ id: userId });
    let currentRoles = response.data;
    let currentRoleIds = currentRoles.map((role) => role.id);
    let newRoleIds = roles.filter((roleId) => !currentRoleIds.includes(roleId));
    let oldRoleIds = currentRoleIds.filter((roleId) => !roles.includes(roleId));

    if (newRoleIds.length > 0) {
      await client.users.assignRoles({ id: userId }, { roles: newRoleIds });
    }

    if (oldRoleIds.length > 0) {
      await client.users.deleteRoles({ id: userId }, { roles: oldRoleIds });
    }

    res.status(200).send({ message: "User updated" });
  } catch (error) {
    console.error("Failed to update user from Auth0:", error);
    res.status(500).send({ error: "Failed to update user" });
  }
});

router.get("/app_settings", async (req, res) => {
  let isAdmin = req.auth?.payload?.permissions?.includes("write:admin") || false;
  if (!isAdmin) {
    res.status(401).send({ error: "Unauthorized: missing write:admin permission" });
    return;
  }

  try {
    const appFeatures = await getAppFeatures();
    res.status(200).send({ appFeatures });
  } catch (error) {
    console.error("Failed to fetch app settings:", error);
    res.status(500).send({ error: "Failed to fetch app settings" });
  }
});

router.patch("/app_settings", async (req, res) => {
  let isAdmin = req.auth?.payload?.permissions?.includes("write:admin") || false;
  if (!isAdmin) {
    res.status(401).send({ error: "Unauthorized: missing write:admin permission" });
    return;
  }

  const { jobNotificationsEnabled } = req.body || {};
  if (jobNotificationsEnabled !== undefined && typeof jobNotificationsEnabled !== "boolean") {
    res.status(400).send({ error: "jobNotificationsEnabled must be a boolean" });
    return;
  }

  try {
    const appFeatures = await updateAppFeatures(req.auth.payload.sub, { jobNotificationsEnabled });
    res.status(200).send({ appFeatures });
  } catch (error) {
    console.error("Failed to update app settings:", error);
    res.status(500).send({ error: "Failed to update app settings" });
  }
});

router.post("/test_job_notification_email", async (req, res) => {
  let isAdmin = req.auth?.payload?.permissions?.includes("write:admin") || false;
  if (!isAdmin) {
    res.status(401).send({ error: "Unauthorized: missing write:admin permission" });
    return;
  }

  let userInfoEndpoint = req.auth?.payload?.aud?.find((aud) => aud.endsWith("/userinfo"));
  if (!userInfoEndpoint) {
    res.status(401).send({ error: "Unauthorized: missing userinfo endpoint" });
    return;
  }

  try {
    if (!(await areJobNotificationsActive())) {
      res.status(400).send({ error: "Job notifications are disabled by an administrator" });
      return;
    }

    const userInfo = await fetch(userInfoEndpoint, {
      headers: {
        Authorization: req.headers.authorization,
      },
    }).then((response) => response.json());

    if (!userInfo?.email) {
      res.status(400).send({ error: "No email address found for the current user" });
      return;
    }

    const profile = await ensureUserProfile(userInfo.sub, {
      email: userInfo.email,
      auth0Name: userInfo.name,
    });

    await sendTestJobNotificationEmail({
      name: profile.displayName || userInfo.name || userInfo.nickname,
      email: userInfo.email,
    });

    res.status(200).send({ message: `Test email sent to ${userInfo.email}` });
  } catch (error) {
    console.error("Failed to send test job notification email:", error);
    res.status(500).send({ error: error.message || "Failed to send test email" });
  }
});

router.post("/reverify_email", async (req, res) => {
  let userId = req.body.userId;
  if (!userId) {
    res.status(400).send({ error: "Missing userId" });
    return;
  }

  if (userId !== req.auth.payload.sub) {
    res.status(401).send({ error: "Unauthorized: userId does not match authenticated user" });
    return;
  }

  try {
    await getManagementClient().jobs.verifyEmail({ user_id: userId });
    res.status(200).send({ message: "Verification email sent" });
  } catch (error) {
    console.error("Failed to send verification email from Auth0:", error);
    res.status(500).send({ error: "Failed to send verification email" });
  }
});

module.exports = router;
