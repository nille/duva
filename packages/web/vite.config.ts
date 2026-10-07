import { defineConfig, type Plugin } from "vite";

/**
 * Preloads the latin faces every view sets its text and headings in, JetBrains Mono's and Familjen
 * Grotesk's, so the browser fetches them with the page rather than once the first view shows. Their
 * names carry a hash only the build knows.
 */
const preloadFonts: Plugin = {
  name: "preload-fonts",
  transformIndexHtml: {
    order: "post",
    handler(_html, { bundle }) {
      const fonts = Object.keys(bundle ?? {}).filter((name) => /(jetbrains-mono|familjen-grotesk)-latin-wght-normal-[^/]*\.woff2$/.test(name));
      return fonts.map((font) => ({ tag: "link", attrs: { rel: "preload", href: `/${font}`, as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head" as const }));
    },
  },
};

// The web app builds into dist, which the CLI's pack step bundles for duva deploy to upload.
export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [preloadFonts],
});
