const MAX_NAME_LENGTH = 100;

function capitalizeWord(word) {
  if (!word) {
    return "";
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function capitalizeName(name) {
  return name
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map(capitalizeWord)
    .join(" ");
}

function sanitizeNamePart(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9' -]/g, "")
    .slice(0, MAX_NAME_LENGTH);
}

function parseNameFromEmail(email) {
  if (!email || typeof email !== "string") {
    return null;
  }

  const localPart = email.split("@")[0];
  if (!localPart || !localPart.includes(".")) {
    return null;
  }

  const parts = localPart.split(".").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const firstName = sanitizeNamePart(capitalizeWord(parts[0]));
  const lastName = sanitizeNamePart(capitalizeName(parts.slice(1).join(" ")));

  if (!firstName || !lastName) {
    return null;
  }

  return { firstName, lastName };
}

function parseLocalPartAsFirstName(email) {
  if (!email || typeof email !== "string") {
    return null;
  }

  const localPart = email.split("@")[0];
  if (!localPart) {
    return null;
  }

  const firstName = sanitizeNamePart(localPart);
  if (!firstName) {
    return null;
  }

  return {
    firstName: capitalizeWord(firstName),
    lastName: "",
  };
}

function parseDefaultNameFromEmail(email) {
  return parseNameFromEmail(email) || parseLocalPartAsFirstName(email);
}

function parseNameFromAuth0Name(auth0Name) {
  if (!auth0Name || typeof auth0Name !== "string" || auth0Name.includes("@")) {
    return null;
  }

  const parts = auth0Name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  const firstName = sanitizeNamePart(capitalizeWord(parts[0]));
  const lastName = sanitizeNamePart(capitalizeName(parts.slice(1).join(" ")));

  if (!firstName) {
    return null;
  }

  return { firstName, lastName };
}

function formatDisplayName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

module.exports = {
  MAX_NAME_LENGTH,
  capitalizeWord,
  capitalizeName,
  sanitizeNamePart,
  parseNameFromEmail,
  parseLocalPartAsFirstName,
  parseDefaultNameFromEmail,
  parseNameFromAuth0Name,
  formatDisplayName,
};
