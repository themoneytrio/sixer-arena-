import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Proxy API calls to the backend so the app works from any device (phone,
    // LAN) without hardcoding the PC's IP, opening the backend port in the
    // firewall, or dealing with CORS — the browser only ever talks to :5173.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
