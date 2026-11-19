import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Two entry pages share one code base:
//   index.html      -> disguise Designer plugin (entry declared in public/d3plugin.json)
//   standalone.html -> standalone web app with the full 3D preview
export default defineConfig({
  base: "./",
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { index: "index.html", standalone: "standalone.html" } },
  },
  test: { environment: "node" },
});
