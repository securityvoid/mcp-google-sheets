#!/usr/bin/env node
/**
 * Claude Desktop MCPB launcher.
 *
 * Company defaults are loaded from company.json (written by pack.mjs from the
 * gitignored company.config.json). Claude Desktop runs extensions in an Electron
 * UtilityProcess — spawn uvx with explicit stdio pipes, not inherit.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_PACKAGE = path.join(HERE, "..", "python");
const COMPANY_PATH = path.join(HERE, "company.json");

function loadCompany() {
  try {
    return JSON.parse(fs.readFileSync(COMPANY_PATH, "utf8"));
  } catch (err) {
    fail(
      `Missing or invalid ${COMPANY_PATH}. Rebuild the mcpb with desktop-extension/pack.mjs.`
    );
  }
}

const company = loadCompany();
const GIT_SOURCE =
  process.env.MCP_GOOGLE_SHEETS_GIT_SOURCE ||
  company.git_source ||
  "git+https://github.com/securityvoid/mcp-google-sheets.git@main";
const MCP_PIN = company.mcp_pin || "mcp>=1.8.0,<2";
const DEFAULTS = {
  CREDENTIALS_SECRET_NAME: company.env?.CREDENTIALS_SECRET_NAME,
  SERVICE_ACCOUNT_EMAIL: company.env?.SERVICE_ACCOUNT_EMAIL,
  TOKEN_PATH:
    company.env?.TOKEN_PATH ||
    path.join(os.homedir(), ".config", "mcp-google-sheets", "token.json"),
};

function packageSource() {
  const marker = path.join(BUNDLED_PACKAGE, "pyproject.toml");
  if (fs.existsSync(marker)) {
    return { label: `bundled:${BUNDLED_PACKAGE}`, fromArg: BUNDLED_PACKAGE };
  }
  return { label: GIT_SOURCE, fromArg: GIT_SOURCE };
}

function usableEnv(value) {
  if (!value) return false;
  if (value.includes("${")) return false;
  return true;
}

function applyCompanyDefaults() {
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    if (!fallback) continue;
    if (!usableEnv(process.env[key])) {
      process.env[key] = fallback;
    }
  }
}

const configuredUvx = usableEnv(process.env.UVX_PATH)
  ? process.env.UVX_PATH
  : null;

const UVX_CANDIDATES = [
  configuredUvx,
  process.env.UV_PATH && path.join(path.dirname(process.env.UV_PATH), "uvx"),
  "/opt/homebrew/bin/uvx",
  "/usr/local/bin/uvx",
  path.join(os.homedir(), ".local", "bin", "uvx"),
  path.join(os.homedir(), ".cargo", "bin", "uvx"),
  "uvx",
].filter(Boolean);

function existsExecutable(candidate) {
  if (!candidate.includes("/") && !candidate.includes("\\")) {
    return true;
  }
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveUvx() {
  for (const candidate of UVX_CANDIDATES) {
    if (existsExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

function expandUserPath(raw) {
  if (!raw) return raw;
  let expanded = raw;
  if (expanded.startsWith("${HOME}")) {
    expanded = path.join(os.homedir(), expanded.slice("${HOME}".length));
  } else if (expanded.startsWith("$HOME")) {
    expanded = path.join(os.homedir(), expanded.slice("$HOME".length));
  } else if (expanded.startsWith("~")) {
    expanded = path.join(os.homedir(), expanded.slice(1));
  }
  return expanded;
}

function ensureTokenDir() {
  const raw = process.env.TOKEN_PATH;
  if (!raw) return;
  const tokenPath = expandUserPath(raw);
  process.env.TOKEN_PATH = tokenPath;
  const dir = path.dirname(tokenPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(
      `Could not create TOKEN_PATH directory '${dir}': ${err.message}`
    );
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function uvxArgs(fromArg) {
  return ["--from", fromArg, "--with", MCP_PIN, "mcp-google-sheets"];
}

function prewarm(uvx, fromArg) {
  console.error("Prewarming mcp-google-sheets install (stdin ignored)...");
  const result = spawnSync(
    uvx,
    [
      "--from",
      fromArg,
      "--with",
      MCP_PIN,
      "python",
      "-c",
      "import mcp_google_sheets; print('prewarm-ok', flush=True)",
    ],
    {
      stdio: ["ignore", "ignore", "inherit"],
      env: process.env,
      shell: process.platform === "win32",
      encoding: "utf8",
    }
  );
  if (result.error) {
    fail(`Failed to prewarm via uvx ('${uvx}'): ${result.error.message}`);
  }
  if (result.status !== 0) {
    console.error(
      `Prewarm exited with code ${result.status}; continuing to launch anyway.`
    );
  }
}

applyCompanyDefaults();

const uvx = resolveUvx();
if (!uvx) {
  fail(
    [
      "uvx was not found on this Mac/PC.",
      "Install uv first, then restart Claude Desktop:",
      "  macOS:  brew install uv",
      "  or:     curl -LsSf https://astral.sh/uv/install.sh | sh",
      "Docs: https://docs.astral.sh/uv/getting-started/installation/",
    ].join("\n")
  );
}

ensureTokenDir();

const source = packageSource();
console.error(`Starting mcp-google-sheets via ${uvx} from ${source.label}`);
prewarm(uvx, source.fromArg);

const child = spawn(uvx, uvxArgs(source.fromArg), {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
  shell: process.platform === "win32",
});

child.on("error", (err) => {
  fail(
    [
      `Failed to start uvx ('${uvx}'): ${err.message}`,
      "If uv is installed but not on PATH for GUI apps, set UVX_PATH to the full",
      "path (e.g. /opt/homebrew/bin/uvx) and restart Claude Desktop.",
    ].join("\n")
  );
});

child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
process.stdin.pipe(child.stdin);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
