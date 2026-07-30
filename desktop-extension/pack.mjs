#!/usr/bin/env node
/**
 * Pack the Claude Desktop .mcpb using company values from a gitignored config.
 *
 * Usage:
 *   cp desktop-extension/company.config.example.json desktop-extension/company.config.json
 *   # edit company.config.json
 *   node desktop-extension/pack.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const CONFIG_PATH = path.join(HERE, "company.config.json");
const EXAMPLE_PATH = path.join(HERE, "company.config.example.json");
const STAGING = path.join(HERE, ".staging");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    fail(`Failed to read ${filePath}: ${err.message}`);
  }
}

function rmrf(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__" || entry.name === ".venv") continue;
      copyDir(from, to);
    } else if (entry.isFile()) {
      copyFile(from, to);
    }
  }
}

if (!fs.existsSync(CONFIG_PATH)) {
  fail(
    [
      `Missing ${CONFIG_PATH}`,
      `Copy the example and fill in company values:`,
      `  cp ${path.relative(process.cwd(), EXAMPLE_PATH)} ${path.relative(process.cwd(), CONFIG_PATH)}`,
    ].join("\n")
  );
}

const config = readJson(CONFIG_PATH);
const ext = config.extension || {};
const env = config.env || {};

for (const key of [
  "CREDENTIALS_SECRET_NAME",
  "SERVICE_ACCOUNT_EMAIL",
  "TOKEN_PATH",
]) {
  if (!env[key] || String(env[key]).includes("YOUR_PROJECT")) {
    fail(
      `company.config.json env.${key} is missing or still a placeholder. Update it before packing.`
    );
  }
}

const version = ext.version || "0.0.0";
const displayName = ext.display_name || "Google Sheets";
const saEmail = env.SERVICE_ACCOUNT_EMAIL;

const longDescription = [
  "## What this does",
  "",
  `Connects Claude Desktop to Google Sheets for ${ext.author_name || "your organization"}.`,
  "",
  "- Fetches the Desktop OAuth client from Google Secret Manager (no `credentials.json` to distribute)",
  "- Uses your Google Application Default Credentials (`gcloud auth application-default login`)",
  "- Only operates on spreadsheets shared with the company service account",
  "",
  "Company settings are baked into this extension — no config form required at install.",
  "",
  "## Before first use",
  "",
  "1. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) (`brew install uv` on macOS)",
  "2. Run: `gcloud auth application-default login` as your company Google account",
  `3. Share any target Google Sheet with \`${saEmail}\` (Viewer or Editor)`,
  "4. Restart Claude Desktop after installing this extension",
  "",
  "## First Claude prompt tip",
  "",
  "Ask Claude to list sheet tools (initialize must succeed immediately). The first real spreadsheet tool call may open a browser once for Google OAuth; the token is then saved under your configured TOKEN_PATH.",
  "",
  "## If uvx is not found",
  "",
  "Install uv via Homebrew (`brew install uv`) so it lands at `/opt/homebrew/bin/uvx` or `/usr/local/bin/uvx`, then restart Claude. The launcher checks those paths even when GUI apps do not inherit your shell PATH.",
].join("\n");

const manifest = {
  manifest_version: "0.3",
  name: ext.name || "company-google-sheets",
  display_name: displayName,
  version,
  description: ext.description || displayName,
  long_description: longDescription,
  author: {
    name: ext.author_name || "Company",
    url: ext.author_url,
  },
  repository: {
    type: "git",
    url: ext.repository_url,
  },
  homepage: ext.homepage,
  documentation: ext.documentation,
  support: ext.support,
  server: {
    type: "node",
    entry_point: "server/launch.mjs",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/launch.mjs"],
      env: {
        CREDENTIALS_SECRET_NAME: env.CREDENTIALS_SECRET_NAME,
        SERVICE_ACCOUNT_EMAIL: env.SERVICE_ACCOUNT_EMAIL,
        TOKEN_PATH: env.TOKEN_PATH,
      },
    },
  },
  tools_generated: true,
  keywords: ["google-sheets", "spreadsheet", "secret-manager", "oauth"],
  license: ext.license || "MIT",
  compatibility: {
    platforms: ["darwin", "win32", "linux"],
    runtimes: { node: ">=18.0.0" },
  },
};

const companyRuntime = {
  env: {
    CREDENTIALS_SECRET_NAME: env.CREDENTIALS_SECRET_NAME,
    SERVICE_ACCOUNT_EMAIL: env.SERVICE_ACCOUNT_EMAIL,
    TOKEN_PATH: env.TOKEN_PATH,
  },
  git_source: config.git_source,
  mcp_pin: config.mcp_pin || "mcp>=1.8.0,<2",
};

const readme = `# ${displayName}

Double-click the packed \`.mcpb\` (or install via Claude Desktop → Settings → Extensions).

## Prerequisites (once per machine)

1. Install uv (\`brew install uv\` on macOS)
2. \`gcloud auth application-default login\` as your company user
3. Share sheets with \`${saEmail}\`

## Notes

Company settings are baked in at pack time from \`company.config.json\` (not committed to git).
Auth is deferred until the first spreadsheet tool call.
`;

console.log(`Packing ${manifest.name}@${version} ...`);

rmrf(STAGING);
fs.mkdirSync(path.join(STAGING, "server"), { recursive: true });
fs.mkdirSync(path.join(STAGING, "python", "src"), { recursive: true });

fs.writeFileSync(path.join(STAGING, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
fs.writeFileSync(path.join(STAGING, "README.md"), readme);
fs.writeFileSync(
  path.join(STAGING, "package.json"),
  JSON.stringify(
    {
      name: `${manifest.name}-mcpb`,
      version,
      private: true,
      type: "module",
      description: `Claude Desktop launcher for ${displayName}`,
    },
    null,
    2
  ) + "\n"
);
fs.writeFileSync(
  path.join(STAGING, ".mcpbignore"),
  ["__pycache__/", "*.pyc", ".venv/", "dist/", "*.egg-info/", "uv.lock"].join("\n") +
    "\n"
);

copyFile(path.join(HERE, "server", "launch.mjs"), path.join(STAGING, "server", "launch.mjs"));
fs.writeFileSync(
  path.join(STAGING, "server", "company.json"),
  JSON.stringify(companyRuntime, null, 2) + "\n"
);

copyFile(path.join(REPO_ROOT, "pyproject.toml"), path.join(STAGING, "python", "pyproject.toml"));
copyFile(path.join(REPO_ROOT, "README.md"), path.join(STAGING, "python", "README.md"));
fs.writeFileSync(
  path.join(STAGING, "python", "BUNDLE.md"),
  "Bundled package snapshot for Claude Desktop mcpb. Generated by pack.mjs.\n"
);
copyDir(
  path.join(REPO_ROOT, "src", "mcp_google_sheets"),
  path.join(STAGING, "python", "src", "mcp_google_sheets")
);

const outputRel = config.output || `dist/${manifest.name}.mcpb`;
const outputPath = path.isAbsolute(outputRel)
  ? outputRel
  : path.join(REPO_ROOT, outputRel);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });

const pack = spawnSync(
  "npx",
  ["--yes", "@anthropic-ai/mcpb", "pack", STAGING, outputPath],
  { stdio: "inherit", cwd: REPO_ROOT, shell: process.platform === "win32" }
);

if (pack.status !== 0) {
  fail(`mcpb pack failed with exit code ${pack.status}`);
}

rmrf(STAGING);
console.log(`Wrote ${outputPath}`);
