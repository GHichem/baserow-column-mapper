import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "0.0.0.0", // Allow external connections (needed for Docker)
    port: 8080,
    watch: {
      usePolling: true, // Needed for file watching in Docker
    },
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  logLevel: 'warn' as const, // Only show warnings and errors, not info
  clearScreen: false, // Don't clear screen on restart
}));
