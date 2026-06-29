const express = require("express");
const router = express.Router();
const { getAppFeatures, areJobNotificationsActive } = require("../utils/appSettings");
const { ensureUserProfile, updateUserSettings, enrichUserInfo } = require("../utils/userPreferences");
const { sanitizeNamePart } = require("../utils/userName");

router.get("/user_info", async (req, res) => {
  let userInfoEndpoint = req.auth?.payload?.aud?.find((aud) => aud.endsWith("/userinfo"));
  if (!userInfoEndpoint) {
    res.status(401).send("Unauthorized: missing userinfo endpoint");
    return;
  }

  try {
    let userInfo = await fetch(userInfoEndpoint, {
      headers: {
        Authorization: req.headers.authorization,
      },
    }).then((res) => res.json());

    if (!userInfo) {
      res.status(401).send("Unauthorized: missing userinfo");
      return;
    }

    userInfo.permissions = req.auth?.payload?.permissions || [];
    const settings = await ensureUserProfile(userInfo.sub, {
      email: userInfo.email,
      auth0Name: userInfo.name,
    });
    enrichUserInfo(userInfo, settings);
    userInfo.appFeatures = await getAppFeatures();
    res.status(200).send(userInfo);
  } catch (error) {
    console.error("Error fetching userinfo:", error);
    res.status(500).send("Error fetching userinfo");
    return;
  }
});

router.patch("/user/settings", async (req, res) => {
  const sub = req.auth?.payload?.sub;
  if (!sub) {
    res.status(401).send({ error: "Unauthorized: missing user id" });
    return;
  }

  const { jobCompletionEmails, firstName, lastName } = req.body || {};

  if (jobCompletionEmails !== undefined && typeof jobCompletionEmails !== "boolean") {
    res.status(400).send({ error: "jobCompletionEmails must be a boolean" });
    return;
  }

  if (firstName !== undefined && typeof firstName !== "string") {
    res.status(400).send({ error: "firstName must be a string" });
    return;
  }

  if (lastName !== undefined && typeof lastName !== "string") {
    res.status(400).send({ error: "lastName must be a string" });
    return;
  }

  if (firstName !== undefined && !sanitizeNamePart(firstName)) {
    res.status(400).send({ error: "firstName is required" });
    return;
  }

  if (lastName !== undefined && !sanitizeNamePart(lastName)) {
    res.status(400).send({ error: "lastName is required" });
    return;
  }

  if (jobCompletionEmails !== undefined && !(await areJobNotificationsActive())) {
    res.status(400).send({ error: "Job notifications are disabled by an administrator" });
    return;
  }

  try {
    const settings = await updateUserSettings(sub, { jobCompletionEmails, firstName, lastName });
    res.status(200).send({ settings });
  } catch (error) {
    console.error("Error updating user settings:", error);
    res.status(500).send({ error: "Failed to update user settings" });
  }
});

module.exports = router;
