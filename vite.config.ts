import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  // GitHub Pages serves the site under /ghost-leg/ (set by the deploy workflow)
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), nodePolyfills({ include: ["buffer", "crypto", "stream", "util"], globals: { Buffer: true } })],
  server: { host: true, port: 5173 },
});
