import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Czas builda: jedna chwila na cały build, wstrzykiwana do apki.
const buildTime = new Date().toISOString();

export default defineConfig({
  // GitHub Pages (project site): https://dasiuss.github.io/Szusownik/
  base: "/Szusownik/",
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Szusownik",
        short_name: "Szusownik",
        lang: "pl",
        start_url: ".",
        display: "standalone",
        background_color: "#eef5f3",
        theme_color: "#17363b",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        // STABILNY cache (nie per build): Workbox precache używa rewizji
        // pojedynczych plików, więc aktualizacja apki dociąga tylko zmienione
        // zasoby. Wcześniej `cacheId` per build wymuszał ponowne pobranie całej
        // paczki mapy (~12 MB) przy każdym wydaniu.
        cacheId: "szusownik",
        // Precache całej mapy offline: podkład (pmtiles), DEM (png), glify
        // (pbf), sprity i snapshot tras (json).
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,pbf,json,pmtiles}"],
        // `solden.pmtiles` ma ~3 MB, a domyślny limit Workbox to 2 MB.
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
