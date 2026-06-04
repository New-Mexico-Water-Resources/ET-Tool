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
    proxy: {
      "/cdl-wms": {
        target: "https://nassgeodata.gmu.edu",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/cdl-wms/, ""),
      },
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
