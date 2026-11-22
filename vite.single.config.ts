import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds ONE html file with all code and the database engine inside it.
export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist-single",
    target: "es2019",
    assetsInlineLimit: 100_000_000, // puts the SQLite wasm inside the file
    cssCodeSplit: false,
    chunkSizeWarningLimit: 5000,
  },
});
