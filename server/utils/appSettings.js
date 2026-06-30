const constants = require("../constants");

const APP_SETTINGS_COLLECTION = "app_settings";
const GLOBAL_SETTINGS_ID = "global";

const DEFAULT_APP_FEATURES = {
  jobNotificationsEnabled: false,
};

async function getAppSettingsDocument() {
  const db = await constants.connectToDatabase();
  if (!db) {
    return null;
  }

  return db.collection(APP_SETTINGS_COLLECTION).findOne({ _id: GLOBAL_SETTINGS_ID });
}

async function getAppFeatures() {
  const document = await getAppSettingsDocument();

  return {
    jobNotificationsEnabled:
      document?.job_notifications_enabled !== undefined
        ? Boolean(document.job_notifications_enabled)
        : DEFAULT_APP_FEATURES.jobNotificationsEnabled,
  };
}

async function updateAppFeatures(sub, features) {
  const db = await constants.connectToDatabase();
  if (!db) {
    throw new Error("Database unavailable");
  }

  const collection = db.collection(APP_SETTINGS_COLLECTION);
  const update = {
    updated_at: Date.now(),
    updated_by: sub,
  };

  if (features.jobNotificationsEnabled !== undefined) {
    update.job_notifications_enabled = Boolean(features.jobNotificationsEnabled);
  }

  await collection.updateOne({ _id: GLOBAL_SETTINGS_ID }, { $set: update }, { upsert: true });

  return getAppFeatures();
}

function isJobNotificationsEnabledInEnvironment() {
  return process.env.JOB_NOTIFICATIONS_ENABLED === "true";
}

async function areJobNotificationsActive() {
  if (!isJobNotificationsEnabledInEnvironment()) {
    return false;
  }

  const features = await getAppFeatures();
  return features.jobNotificationsEnabled;
}

module.exports = {
  APP_SETTINGS_COLLECTION,
  GLOBAL_SETTINGS_ID,
  DEFAULT_APP_FEATURES,
  getAppFeatures,
  updateAppFeatures,
  isJobNotificationsEnabledInEnvironment,
  areJobNotificationsActive,
};
