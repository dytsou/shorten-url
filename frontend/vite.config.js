import { readFile } from "node:fs/promises";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { marked } from "marked";

const docsDirectory = new URL("../docs/", import.meta.url);

function siteDocsAssets() {
  return {
    name: "site-docs-assets",
    apply: "build",
    async generateBundle() {
      const [aboutTemplate, aboutMarkdown, apiIndexHtml, openApiSpec] = await Promise.all([
        readFile(new URL("about-template.html", import.meta.url), "utf8"),
        readFile(new URL("about.md", docsDirectory), "utf8"),
        readFile(new URL("api/index.html", docsDirectory), "utf8"),
        readFile(new URL("api/openapi.yaml", docsDirectory), "utf8"),
      ]);

      const projectGuide = aboutMarkdown.replace(/^# URL Shortener$/m, "## URL Shortener");
      const aboutHtml = aboutTemplate.replace("<!-- ABOUT_CONTENT -->", marked.parse(projectGuide));

      this.emitFile({ type: "asset", fileName: "about.html", source: aboutHtml });
      this.emitFile({ type: "asset", fileName: "api/index.html", source: apiIndexHtml });
      this.emitFile({ type: "asset", fileName: "api/openapi.yaml", source: openApiSpec });
    },
  };
}

export default defineConfig({
  base: "/",
  publicDir: "static",
  plugins: [react(), siteDocsAssets()],
});
