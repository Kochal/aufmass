import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// React + TypeScript PWA (directive 10). Installable, camera-capable,
// offline-tolerant — chosen for field capture on phones at the Baustelle (07).
// The dev server is bound to 0.0.0.0 in docker-compose.yml so HMR works in the
// browser against the container.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Aufmaß",
        short_name: "Aufmaß",
        description: "Aufmaß capture, quotation and operations",
        theme_color: "#1f2937",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
