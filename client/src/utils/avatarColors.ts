const AVATAR_BACKGROUND_COLORS = [
  "#4fa1ff",
  "#7069fa",
  "#50ac34",
  "#fdb462",
  "#ff7760",
  "#5d55fa",
  "#db5139",
  "#3525e6",
  "#0eaf0a",
  "#ffdd5c",
  "#8888fc",
  "#444c50",
] as const;

function getRelativeLuminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((value) => parseInt(value, 16) / 255) ?? [0, 0, 0];

  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function getPaletteIndex(letter: string): number {
  const normalized = letter.toUpperCase().charAt(0);
  if (normalized >= "A" && normalized <= "Z") {
    return normalized.charCodeAt(0) - 65;
  }
  return normalized.charCodeAt(0) % AVATAR_BACKGROUND_COLORS.length;
}

export function getAvatarColorsFromLetter(letter: string): { backgroundColor: string; color: string } {
  const backgroundColor = AVATAR_BACKGROUND_COLORS[getPaletteIndex(letter) % AVATAR_BACKGROUND_COLORS.length];
  const color = getRelativeLuminance(backgroundColor) > 0.55 ? "#1b1d1e" : "#ffffff";

  return { backgroundColor, color };
}
