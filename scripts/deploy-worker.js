import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseSpecialRedirectRules } from "../src/lib/redirect-rules.js";

const envFile = resolve(".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const rules = process.env.SPECIAL_REDIRECT_RULES;
let deploymentRules;
try {
  parseSpecialRedirectRules(rules);
  deploymentRules = JSON.stringify(JSON.parse(rules));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(
  command,
  [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    "wrangler.toml",
    "--keep-vars",
    "--var",
    `SPECIAL_REDIRECT_RULES:${deploymentRules}`
  ],
  { stdio: "inherit", env: process.env }
);

if (result.error) {
  console.error(`Could not start Wrangler deploy: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
