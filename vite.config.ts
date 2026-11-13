import { defineConfig } from "vite";

// Client build. Rapier's -compat package inlines its WASM, so no extra plugin is needed.
export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
