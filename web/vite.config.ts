import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// React + TypeScript PWA (directive 10). Three surfaces, one design system:
// office (desktop, dense, keyboard-driven), field (mobile-first, camera,
// large tap targets), owner dashboard. See notes/ui/ for library decisions.
export default defineConfig({
  plugins: [
    tailwindcss(), // must come before react() so Tailwind processes CSS first
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
  resolve: {
    alias: {
      // @/ maps to ./src/ — matches the paths entry in tsconfig.json
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://api:8000",
        changeOrigin: true,
      },
    },
  },
});
