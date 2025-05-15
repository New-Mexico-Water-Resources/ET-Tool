import { atom } from "jotai";

export type CountyStat = {
  id: string;
  name: string;
  mean: number;
  std_dev: number;
};

// Use jotai to track modis county stats for given band and time
export const modisCountyStatsAtom = atom<{
  band: string;
  time: string;
  mode: string;
  countyStats: Record<string, CountyStat>;
}>({ band: "", time: "", mode: "", countyStats: {} });
