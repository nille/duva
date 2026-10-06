import { defineConfig, type Plugin } from "vite";

/**
 * Preloads the serif's latin face, which every view sets mail in, so the browser fetches it with the
 * page rather than once the first mail shows. Its name carries a hash only the build knows.
 */
const preloadSerif: Plugin = {
  name: "preload-serif",
  transformIndexHtml: {
    order: "post",
    handler(_html, { bundle }) {
      const font = Object.keys(bundle ?? {}).find((name) => /source-serif-4-latin-opsz-normal-[^/]*\.woff2$/.test(name));
      return font === undefined ? [] : [{ tag: "link", attrs: { rel: "preload", href: `/${font}`, as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head" }];
    },
  },
};

// The web app builds into dist, which the CLI's pack step bundles for duva deploy to upload.
export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [preloadSerif],
});
