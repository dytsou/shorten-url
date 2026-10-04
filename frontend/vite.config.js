import { readFile } from "node:fs/promises";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiDocsDirectory = new URL("../docs/api/", import.meta.url);

function apiDocsAssets() {
  return {
    name: "api-docs-assets",
    apply: "build",
    async generateBundle() {
      const [indexHtml, openApiSpec] = await Promise.all([
        readFile(new URL("index.html", apiDocsDirectory), "utf8"),
        readFile(new URL("openapi.yaml", apiDocsDirectory), "utf8"),
      ]);

      this.emitFile({ type: "asset", fileName: "api/index.html", source: indexHtml });
      this.emitFile({ type: "asset", fileName: "api/openapi.yaml", source: openApiSpec });
    },
  };
}

export default defineConfig({
  base: "/",
  publicDir: "static",
  plugins: [react(), apiDocsAssets()],
});
