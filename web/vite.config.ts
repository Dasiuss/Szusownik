import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Czas builda: jedna chwila na cały build, wstrzykiwana do apki i do cacheId.
const buildTime = new Date().toISOString();
const cacheId = `szusownik-${buildTime.replace(/[:.]/g, "-")}`;

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
        // Wersja cache = wersja apki. Czas builda wymusza świeży cache przy
        // każdym wydaniu; przy zmianie formatu danych / query podbij też klucze
        // cache (docs/ustalenia-z-projektow-testowych.md §6).
        cacheId,
      },
    }),
  ],
});
