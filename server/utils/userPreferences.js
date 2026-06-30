const constants = require("../constants");
const {
  parseDefaultNameFromEmail,
  parseNameFromAuth0Name,
  sanitizeNamePart,
  formatDisplayName,
} = require("./userName");

const USER_PREFERENCES_COLLECTION = "user_preferences";

const DEFAULT_SETTINGS = {
  jobCompletionEmails: true,
  firstName: "",
  lastName: "",
  displayName: "",
};

function buildSettingsFromDocument(document) {
  const firstName = sanitizeNamePart(document?.first_name || "");
  const lastName = sanitizeNamePart(document?.last_name || "");

  return {
    jobCompletionEmails:
      document?.job_completion_emails !== undefined ? Boolean(document.job_completion_emails) : DEFAULT_SETTINGS.jobCompletionEmails,
    firstName,
    lastName,
    displayName: formatDisplayName(firstName, lastName),
  };
}

function hasStoredName(document) {
  return Boolean(sanitizeNamePart(document?.first_name));
}

async function getUserSettings(sub, options = {}) {
  if (!sub) {
    return { ...DEFAULT_SETTINGS };
  }

  const db = await constants.connectToDatabase();
  if (!db) {
    return { ...DEFAULT_SETTINGS };
  }

  const collection = db.collection(USER_PREFERENCES_COLLECTION);
  const document = await collection.findOne({ sub });

  if (!hasStoredName(document) && options.email) {
    return ensureUserProfile(sub, options);
  }

  return buildSettingsFromDocument(document);
}

async function ensureUserProfile(sub, { email, auth0Name } = {}) {
  if (!sub) {
    return { ...DEFAULT_SETTINGS };
  }

  const db = await constants.connectToDatabase();
  if (!db) {
    return { ...DEFAULT_SETTINGS };
  }

  const collection = db.collection(USER_PREFERENCES_COLLECTION);
  const document = (await collection.findOne({ sub })) || {};

  if (hasStoredName(document)) {
    return buildSettingsFromDocument(document);
  }

  const parsedName = parseDefaultNameFromEmail(email) || parseNameFromAuth0Name(auth0Name);
  const firstName = parsedName?.firstName || "";
  const lastName = parsedName?.lastName || "";

  const update = {
    sub,
    updated_at: Date.now(),
  };

  if (firstName) {
    update.first_name = firstName;
  }
  if (lastName) {
    update.last_name = lastName;
  }

  if (update.first_name || update.last_name) {
    await collection.updateOne({ sub }, { $set: update }, { upsert: true });
    const savedDocument = await collection.findOne({ sub });
    return buildSettingsFromDocument(savedDocument);
  }

  return buildSettingsFromDocument(document);
}

async function updateUserSettings(sub, settings) {
  if (!sub) {
    throw new Error("Missing user id");
  }

  const db = await constants.connectToDatabase();
  if (!db) {
    throw new Error("Database unavailable");
  }

  const collection = db.collection(USER_PREFERENCES_COLLECTION);
  const update = {
    sub,
    updated_at: Date.now(),
  };

  if (settings.jobCompletionEmails !== undefined) {
    update.job_completion_emails = Boolean(settings.jobCompletionEmails);
  }

  if (settings.firstName !== undefined) {
    update.first_name = sanitizeNamePart(settings.firstName);
  }

  if (settings.lastName !== undefined) {
    update.last_name = sanitizeNamePart(settings.lastName);
  }

  await collection.updateOne({ sub }, { $set: update }, { upsert: true });

  return getUserSettings(sub);
}

function enrichUserInfo(userInfo, settings) {
  if (!userInfo || !settings) {
    return userInfo;
  }

  userInfo.settings = settings;
  if (settings.displayName) {
    userInfo.name = settings.displayName;
  }

  return userInfo;
}

module.exports = {
  USER_PREFERENCES_COLLECTION,
  DEFAULT_SETTINGS,
  getUserSettings,
  ensureUserProfile,
  updateUserSettings,
  enrichUserInfo,
};
