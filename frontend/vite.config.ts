import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
// `vitest/config` re-exports Vite's `defineConfig` with the extra `test` block
// typed, so unit-test settings live beside the build they run against.
import { defineConfig } from "vitest/config";

export default defineConfig(() => {
  return {
    plugins: [react({ compiler: true }), tailwindcss()],
    test: {
      // `e2e/` holds Playwright specs. They import `@playwright/test` and need a
      // live browser and servers, so the unit runner must not pick them up.
      exclude: ["node_modules/**", "dist/**", "e2e/**"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== "true",
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === "true" ? null : {},
    },
  };
});
