import { defineConfig } from "vite";

// The web app builds into dist, which the CLI's pack step bundles for duva deploy to upload.
export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true },
});
