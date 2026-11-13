import { defineConfig } from "vite";

// Client build. Rapier's -compat package inlines its WASM, so no extra plugin is needed.
export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
    // three and Rapier (WASM inlined as base64, about 4.3 MB) are large by nature; both load lazily.
    chunkSizeWarningLimit: 5000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "three", test: /node_modules[\\/]three[\\/]/ },
            { name: "rapier", test: /node_modules[\\/]@dimforge[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
