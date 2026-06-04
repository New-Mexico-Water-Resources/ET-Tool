/// <reference types="vite/client" />

declare module "proj4" {
  export default function proj4(
    from: string,
    to: string,
    coordinates: [number, number]
  ): [number, number];
}
