import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    port: 5173,
    proxy: {
      // WMTS map proxy → Express proxy on port 3001
      "/api/map-proxy": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Agent RL inference service on port 8008
      "/agent": {
        target: "http://localhost:8008",
        changeOrigin: true,
      },
      // All /api/* requests → FastAPI backend on port 3002
      "/api": {
        target: "http://localhost:3002",
        changeOrigin: true,
      },
      // Non-prefixed routes → FastAPI backend on port 3002
      "/units": {
        target: "http://localhost:3002",
        changeOrigin: true,
      },
      "/simulation": {
        target: "http://localhost:3002",
        changeOrigin: true,
      },
      "/rules": {
        target: "http://localhost:3002",
        changeOrigin: true,
      },
      "/map": {
        target: "http://localhost:3002",
        changeOrigin: true,
      },
    },
  },
});
