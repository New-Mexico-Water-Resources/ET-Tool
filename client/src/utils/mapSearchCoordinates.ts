import proj4 from "proj4";

export type ParsedSearchCoordinates = {
  lat: number;
  lng: number;
  label: string;
};

const WGS84 = "EPSG:4326";
const SOUTHERN_LATITUDE_BANDS = "CDEFGHJKLM";

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

export function parseLatLon(raw: string): { lat: number; lng: number } | null {
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

  if (parts.length === 3) {
    const zone = parseInt(parts[0], 10);
    const a = parseFloat(parts[1]);
    const b = parseFloat(parts[2]);
    if (Number.isFinite(zone) && zone >= 1 && zone <= 60 && Number.isFinite(a) && Number.isFinite(b)) {
      const latLon = normalizeLatLngPair(a, b);
      if (latLon && looksLikeLatLonValues(a, b)) {
        return latLon;
      }
    }
  }

  return null;
}

function looksLikeLatLonValues(a: number, b: number): boolean {
  return Math.abs(a) <= 90 && Math.abs(b) <= 180 && (Math.abs(a) < 1000 || Math.abs(b) < 1000);
}

function looksLikeUtmValues(easting: number, northing: number): boolean {
  return easting >= 10000 && easting <= 900000 && northing >= 100000 && northing <= 10000000;
}

type ParsedUtmToken = {
  value: number;
  suffix?: string;
};

function parseNumericToken(token: string): ParsedUtmToken | null {
  const match = token.match(/^(\d+(?:\.\d+)?)([nesw])?$/i);
  if (!match) {
    return null;
  }

  const value = parseFloat(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }

  return { value, suffix: match[2]?.toUpperCase() };
}

function isNorthingSuffix(suffix?: string): boolean {
  return suffix === "N" || suffix === "S";
}

function isEastingSuffix(suffix?: string): boolean {
  return suffix === "E" || suffix === "W";
}

function northernFromNorthingSuffix(suffix?: string): boolean | undefined {
  if (suffix === "N") {
    return true;
  }
  if (suffix === "S") {
    return false;
  }
  return undefined;
}

function assignEastingNorthingFromTokens(
  a: ParsedUtmToken,
  b: ParsedUtmToken
): { easting: number; northing: number; northern?: boolean } | null {
  const aNorthing = isNorthingSuffix(a.suffix);
  const aEasting = isEastingSuffix(a.suffix);
  const bNorthing = isNorthingSuffix(b.suffix);
  const bEasting = isEastingSuffix(b.suffix);

  if (aNorthing && (bEasting || !bNorthing)) {
    return {
      northing: a.value,
      easting: b.value,
      northern: northernFromNorthingSuffix(a.suffix),
    };
  }

  if (bNorthing && (aEasting || !aNorthing)) {
    return {
      northing: b.value,
      easting: a.value,
      northern: northernFromNorthingSuffix(b.suffix),
    };
  }

  if (aEasting && !aNorthing && !bNorthing) {
    return { easting: a.value, northing: b.value };
  }

  if (bEasting && !aNorthing && !bNorthing) {
    return { easting: b.value, northing: a.value };
  }

  return null;
}

function assignEastingNorthingByMagnitude(
  a: ParsedUtmToken,
  b: ParsedUtmToken
): { easting: number; northing: number; northern?: boolean } | null {
  const easting = a.value < b.value ? a.value : b.value;
  const northing = a.value >= b.value ? a.value : b.value;
  if (!looksLikeUtmValues(easting, northing)) {
    return null;
  }

  return {
    easting,
    northing,
    northern: northernFromNorthingSuffix(a.suffix) ?? northernFromNorthingSuffix(b.suffix),
  };
}

function northernFromBandLetter(letter?: string): boolean {
  if (!letter) {
    return true;
  }

  const band = letter.toUpperCase();
  if (band === "N") {
    return true;
  }
  if (band === "S") {
    return false;
  }
  if (SOUTHERN_LATITUDE_BANDS.includes(band)) {
    return false;
  }
  return true;
}

function utmProjString(zone: number, northern: boolean): string {
  return `+proj=utm +zone=${zone} ${northern ? "+north" : "+south"} +ellps=WGS84 +datum=WGS84 +units=m +no_defs`;
}

function convertUtmToLatLng(
  zone: number,
  easting: number,
  northing: number,
  northern: boolean
): { lat: number; lng: number } | null {
  if (zone < 1 || zone > 60 || !Number.isFinite(easting) || !Number.isFinite(northing)) {
    return null;
  }

  if (!looksLikeUtmValues(easting, northing)) {
    return null;
  }

  try {
    const [lng, lat] = proj4(utmProjString(zone, northern), WGS84, [easting, northing]) as [number, number];
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return null;
    }
    return { lat, lng };
  } catch {
    return null;
  }
}

function formatUtmLabel(zone: number, easting: number, northing: number, band?: string): string {
  const zoneLabel = band ? `${zone}${band.toUpperCase()}` : String(zone);
  return `UTM ${zoneLabel}: ${easting}, ${northing}`;
}

function parseUtmComponents(
  zone: number,
  easting: number,
  northing: number,
  options?: { band?: string; northern?: boolean }
): ParsedSearchCoordinates | null {
  const northern = options?.northern ?? northernFromBandLetter(options?.band);
  const latLng = convertUtmToLatLng(zone, easting, northing, northern);
  if (!latLng) {
    return null;
  }

  const utmLabel = formatUtmLabel(zone, easting, northing, options?.band);
  return {
    ...latLng,
    label: `${utmLabel}\n${latLng.lat.toFixed(6)}, ${latLng.lng.toFixed(6)}`,
  };
}

export function parseUtm(raw: string): ParsedSearchCoordinates | null {
  const t = raw.trim();
  if (!t) {
    return null;
  }

  const zoneFirstMatch = t.match(
    /^(?:utm\s+)?(\d{1,2})\s*([a-hj-np-z])?\s*[,;\s]\s*(\d+(?:\.\d+)?)\s*[,;\s]\s*(\d+(?:\.\d+)?)$/i
  );
  if (zoneFirstMatch) {
    return parseUtmComponents(
      parseInt(zoneFirstMatch[1], 10),
      parseFloat(zoneFirstMatch[3]),
      parseFloat(zoneFirstMatch[4]),
      { band: zoneFirstMatch[2] }
    );
  }

  const eastingFirstMatch = t.match(
    /^(\d+(?:\.\d+)?)\s*[,;\s]\s*(\d+(?:\.\d+)?)\s*[,;\s]+(?:zone\s*)?(\d{1,2})\s*([a-hj-np-z])?$/i
  );
  if (eastingFirstMatch) {
    return parseUtmComponents(
      parseInt(eastingFirstMatch[3], 10),
      parseFloat(eastingFirstMatch[1]),
      parseFloat(eastingFirstMatch[2]),
      { band: eastingFirstMatch[4] }
    );
  }

  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 3) {
    const zone = parseInt(parts[0], 10);
    if (!Number.isFinite(zone) || zone < 1 || zone > 60) {
      return null;
    }

    const first = parseNumericToken(parts[1]);
    const second = parseNumericToken(parts[2]);
    if (!first || !second) {
      return null;
    }

    const fromSuffixes = assignEastingNorthingFromTokens(first, second);
    if (fromSuffixes) {
      return parseUtmComponents(zone, fromSuffixes.easting, fromSuffixes.northing, {
        northern: fromSuffixes.northern,
      });
    }

    const fromMagnitude = assignEastingNorthingByMagnitude(first, second);
    if (fromMagnitude) {
      return parseUtmComponents(zone, fromMagnitude.easting, fromMagnitude.northing, {
        northern: fromMagnitude.northern,
      });
    }
  }

  return null;
}

export function parseSearchCoordinates(raw: string): ParsedSearchCoordinates | null {
  const latLon = parseLatLon(raw);
  if (latLon) {
    return {
      ...latLon,
      label: `${latLon.lat.toFixed(6)}, ${latLon.lng.toFixed(6)}`,
    };
  }

  return parseUtm(raw);
}

export function isCoordinateSearchQuery(raw: string): boolean {
  return parseSearchCoordinates(raw.trim()) !== null;
}
