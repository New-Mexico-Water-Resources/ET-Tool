import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  root: "./",
  server: {
    fs: {
      allow: [".."],
    },
  },
  build: {
    rollupOptions: {
      input: {
        app: "./index.html",
        changelog: "./CHANGELOG.md",
      },
    },
    minify: "esbuild",
    sourcemap: true,
    commonjsOptions: {
      include: [/node_modules/],
      requireReturnsDefault: "auto",
    },
  },
  optimizeDeps: {
    include: ["georaster-layer-for-leaflet", "proj4-fully-loaded"],
    esbuildOptions: {
      target: "es2020",
    },
  },
  assetsInclude: ["**/*.md"],
});
