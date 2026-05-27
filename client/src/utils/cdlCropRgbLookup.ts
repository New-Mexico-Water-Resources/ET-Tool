import paletteJson from "../assets/cdl_crop_palette.json";

type PaletteEntry = [string, string];

const entries = paletteJson as PaletteEntry[];

export const cdlPaletteRows = entries.map(([hex, name]) => ({
  r: parseInt(hex.slice(0, 2), 16),
  g: parseInt(hex.slice(2, 4), 16),
  b: parseInt(hex.slice(4, 6), 16),
  name,
}));

export const lookupCdlRgb = (r: number, g: number, b: number, maxDistSq = 2200): string | null => {
  let best = Infinity;
  const names = new Set<string>();
  for (const row of cdlPaletteRows) {
    const d = (r - row.r) ** 2 + (g - row.g) ** 2 + (b - row.b) ** 2;
    if (d < best) {
      best = d;
      names.clear();
      names.add(row.name);
    } else if (d === best) {
      names.add(row.name);
    }
  }

  if (best > maxDistSq) {
    return null;
  }

  return [...names].join("\n");
};
