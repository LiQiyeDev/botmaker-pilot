import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The app's own version, injected as a build-time constant so the auto-updater can compare it against the
// latest GitHub release tag. Keep web/package.json "version" in step with the APK release tags.
const appVersion = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")).version;

// Relative base so the built assets resolve both when served by Studio at "/" and when loaded from
// file:// inside the Capacitor Android wrapper.
export default defineConfig({
  base: "./",
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
