import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? "/pungafighters/" : "/",
  plugins: [react(), mode === "github-pages" ? githubPagesSpaFallback() : undefined],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/phaser")) {
            return "phaser";
          }
          if (id.includes("node_modules/@mediapipe")) {
            return "mediapipe";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react";
          }
        },
      },
    },
  },
}));

function githubPagesSpaFallback(): Plugin {
  return {
    name: "github-pages-spa-fallback",
    writeBundle(outputOptions) {
      const outputDir = typeof outputOptions.dir === "string" ? outputOptions.dir : "dist";
      const indexPath = resolve(outputDir, "index.html");
      if (existsSync(indexPath)) {
        copyFileSync(indexPath, resolve(outputDir, "404.html"));
      }
    },
  };
}
