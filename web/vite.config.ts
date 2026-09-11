import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // GitHub Pages (project site): https://dasiuss.github.io/Szusownik/
  base: "/Szusownik/",
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
        background_color: "#0b1220",
        theme_color: "#0ea5e9",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        // Wersja cache = wersja apki. Przy zmianie formatu danych / query
        // podbij też klucze cache (docs/ustalenia-z-projektow-testowych.md §6).
        cacheId: "szusownik-v1",
      },
    }),
  ],
});
