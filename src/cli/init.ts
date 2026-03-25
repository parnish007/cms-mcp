// src/cli/init.ts
// `npx cms-mcp init` — full interactive config wizard.
//
// Uses Node.js built-in readline/promises (zero deps).
// Flow:
//   1. Ask for baseUrl → HEAD probe to verify reachability
//   2. Auto-detect CMS type from response headers + JSON probes
//   3. Ask for auth type → token/key/credentials
//   4. Ask which optional features to enable (schemaCache, auditLog, approvals)
//   5. Ask to add custom endpoints (beyond the auto-detected ones)
//   6. Write cms-mcp.config.json
//
// Detected CMS types:
//   Supabase / PostgREST — /rest/v1/ prefix + apikey header
//   Strapi v4/v5         — /api/_health → { data: { status: "UP" } }
//   Directus             — /server/info → { data: { project: ... } }
//   PocketBase           — /api/health → { code: 200 }
//   Payload CMS          — /api/globals or /api/users
//   Generic REST API     — fallback template

import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import * as readline from "readline/promises";
import { stdin as input, stdout as output, stderr as err } from "process";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectResult {
  cms: string;
  /** Confidence: "certain" | "likely" | "unknown" */
  confidence: "certain" | "likely" | "unknown";
  authType: "bearer" | "api-key" | "basic" | "none";
  authNote: string;
  endpoints: Record<string, string>;
  extraConfig?: Record<string, unknown>;
  /** Suggested header name for api-key auth */
  apiKeyHeader?: string;
}

// ─── Terminal helpers ──────────────────────────────────────────────────────────

const BOLD  = "\x1b[1m";
const DIM   = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN  = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED   = "\x1b[31m";
const RESET = "\x1b[0m";

function print(msg: string): void { output.write(msg + "\n"); }
function dim(msg: string): void   { output.write(`${DIM}${msg}${RESET}\n`); }
function ok(msg: string): void    { output.write(`${GREEN}✔${RESET}  ${msg}\n`); }
function warn(msg: string): void  { output.write(`${YELLOW}⚠${RESET}  ${msg}\n`); }
function info(msg: string): void  { output.write(`${CYAN}ℹ${RESET}  ${msg}\n`); }
function fail(msg: string): void  { output.write(`${RED}✖${RESET}  ${msg}\n`); }

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function headCheck(url: string, timeoutMs = 6000): Promise<{
  ok: boolean;
  status: number;
  headers: Headers;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "cms-mcp init wizard" },
    });
    return { ok: res.ok || res.status < 500, status: res.status, headers: res.headers };
  } catch (e: unknown) {
    return { ok: false, status: 0, headers: new Headers() };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url: string, timeoutMs = 5000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { Accept: "application/json", "User-Agent": "cms-mcp init wizard" },
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── CMS detection ────────────────────────────────────────────────────────────

async function detectCms(baseUrl: string): Promise<DetectResult> {
  const base = baseUrl.replace(/\/$/, "");

  // ── Supabase / PostgREST ──────────────────────────────────────────────────
  // PostgREST OpenAPI spec at root — has `paths` and `info.title: "PostgREST API"`
  const pgRoot = await getJson(`${base}/`) as any;
  if (pgRoot && typeof pgRoot === "object" && (pgRoot.paths || pgRoot.openapi)) {
    const isSupabase = base.includes("supabase") || base.includes(".supabase.co");
    return {
      cms: isSupabase ? "Supabase" : "PostgREST",
      confidence: "certain",
      authType: "api-key",
      apiKeyHeader: isSupabase ? "apikey" : "Authorization",
      authNote: isSupabase
        ? 'Set CMS_API_TOKEN to your Supabase anon key (Project Settings → API).'
        : 'Set CMS_API_TOKEN to your PostgREST JWT or API key.',
      endpoints: {
        ...(isSupabase ? {} : {}),
      },
      extraConfig: {
        openapi: { autoDiscover: true, discoveryUrl: `${base}/` },
      },
    };
  }

  // ── Strapi v4 / v5 ────────────────────────────────────────────────────────
  const strapiHealth = await getJson(`${base}/api/_health`) as any;
  if (strapiHealth?.data?.status === "UP" || strapiHealth?.status === "UP") {
    return {
      cms: "Strapi",
      confidence: "certain",
      authType: "bearer",
      authNote: "Set CMS_API_TOKEN to a Strapi API token (Admin → Settings → API Tokens).",
      endpoints: {
        posts:    "/api/posts",
        projects: "/api/projects",
        media:    "/api/upload/files",
      },
      extraConfig: { openapi: { autoDiscover: true } },
    };
  }

  // ── Directus ──────────────────────────────────────────────────────────────
  const directus = await getJson(`${base}/server/info`) as any;
  if (directus?.data?.project || directus?.project_name) {
    return {
      cms: "Directus",
      confidence: "certain",
      authType: "bearer",
      authNote: "Set CMS_API_TOKEN to a Directus static token (User Profile → Token).",
      endpoints: {
        posts:    "/items/posts",
        projects: "/items/projects",
        media:    "/files",
      },
      extraConfig: { openapi: { autoDiscover: true, discoveryUrl: `${base}/server/specs/oas` } },
    };
  }

  // ── PocketBase ────────────────────────────────────────────────────────────
  const pb = await getJson(`${base}/api/health`) as any;
  if (pb?.code === 200 || pb?.message === "API is healthy.") {
    return {
      cms: "PocketBase",
      confidence: "certain",
      authType: "bearer",
      authNote: "Set CMS_API_TOKEN to a PocketBase admin or user token from /api/admins/auth-with-password.",
      endpoints: {
        posts:    "/api/collections/posts/records",
        projects: "/api/collections/projects/records",
        media:    "/api/files",
      },
    };
  }

  // ── Payload CMS ───────────────────────────────────────────────────────────
  const payloadGlobals = await getJson(`${base}/api/globals`) as any;
  const payloadUsers   = await getJson(`${base}/api/users`) as any;
  if (payloadGlobals?.docs !== undefined || payloadUsers?.docs !== undefined) {
    return {
      cms: "Payload CMS",
      confidence: "certain",
      authType: "bearer",
      authNote: "Set CMS_API_TOKEN to a Payload API token from /api/users/login.",
      endpoints: {
        posts:    "/api/posts",
        projects: "/api/projects",
        media:    "/api/media",
      },
    };
  }

  // ── Generic fallback ──────────────────────────────────────────────────────
  return {
    cms: "Generic REST API",
    confidence: "unknown",
    authType: "bearer",
    authNote: "Set CMS_API_TOKEN to your API bearer token.",
    endpoints: {},
  };
}

// ─── Interactive prompts ──────────────────────────────────────────────────────

function createRl(): readline.Interface {
  return readline.createInterface({ input, output, terminal: true });
}

async function ask(rl: readline.Interface, question: string, defaultVal = ""): Promise<string> {
  const prompt = defaultVal
    ? `  ${CYAN}?${RESET} ${question} ${DIM}(${defaultVal})${RESET} › `
    : `  ${CYAN}?${RESET} ${question} › `;
  const answer = await rl.question(prompt);
  return answer.trim() || defaultVal;
}

async function confirm(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const answer = await ask(rl, `${question} ${DIM}[${hint}]${RESET}`);
  if (!answer) return defaultYes;
  return /^y(es)?$/i.test(answer);
}

async function choose(
  rl: readline.Interface,
  question: string,
  choices: string[],
  defaultIdx = 0,
): Promise<string> {
  print(`  ${CYAN}?${RESET} ${question}`);
  choices.forEach((c, i) => {
    const marker = i === defaultIdx ? `${GREEN}›${RESET}` : " ";
    print(`  ${marker} ${i + 1}) ${c}`);
  });
  const answer = await ask(rl, `Enter number`, String(defaultIdx + 1));
  const idx = parseInt(answer, 10) - 1;
  if (idx >= 0 && idx < choices.length) return choices[idx];
  return choices[defaultIdx];
}

// ─── Build config object ──────────────────────────────────────────────────────

interface WizardAnswers {
  baseUrl:       string;
  cms:           string;
  authType:      "bearer" | "api-key" | "basic" | "none";
  apiKeyHeader?: string;
  endpoints:     Record<string, string>;
  legacyMode:    boolean;
  schemaCache:   boolean;
  auditLog:      boolean;
  approvals:     boolean;
  approvalTools: string[];
  readOnly:      boolean;
  extraConfig:   Record<string, unknown>;
}

function buildConfig(answers: WizardAnswers): Record<string, unknown> {
  const authBlock: Record<string, unknown> =
    answers.authType === "api-key"
      ? { type: "api-key", header: answers.apiKeyHeader ?? "X-API-Key", token: "env:CMS_API_TOKEN" }
      : answers.authType === "basic"
        ? { type: "basic", username: "env:CMS_USERNAME", password: "env:CMS_PASSWORD" }
        : answers.authType === "none"
          ? { type: "none" }
          : { type: "bearer", token: "env:CMS_API_TOKEN" };

  const cfg: Record<string, unknown> = {
    name:      answers.cms,
    baseUrl:   answers.baseUrl,
    auth:      authBlock,
    endpoints: answers.endpoints,
  };

  if (answers.legacyMode) {
    cfg["legacyMode"] = true;
  }

  if (answers.readOnly) {
    cfg["readOnly"] = true;
  }

  if (answers.schemaCache) {
    cfg["schemaCache"] = { path: "~/.cms-mcp/schema-cache.db", ttlMinutes: 60 };
  }

  if (answers.auditLog) {
    cfg["auditLog"] = "~/.cms-mcp/audit.log";
  }

  if (answers.approvals && answers.approvalTools.length > 0) {
    cfg["approvals"] = { port: 2323, timeoutMs: 300000, tools: answers.approvalTools };
  }

  // Merge extra config from CMS detection (openapi, etc.)
  for (const [k, v] of Object.entries(answers.extraConfig)) {
    if (!(k in cfg)) cfg[k] = v;
  }

  return cfg;
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

export async function runInit(flags: { config?: string; baseUrl?: string }): Promise<void> {
  const configPath = resolve(flags.config ?? "cms-mcp.config.json");

  // Banner
  print("");
  print(`${BOLD}  cms-mcp init${RESET}  ${DIM}v1.0.0 interactive setup wizard${RESET}`);
  print(`  ${"─".repeat(48)}`);
  print("");

  // Guard against overwrite
  if (existsSync(configPath)) {
    warn(`Config already exists at ${configPath}`);
    dim("  Delete it or use --config <path> for a different location.");
    print("");
    process.exit(1);
  }

  const rl = createRl();

  try {
    // ── Step 1: Base URL ────────────────────────────────────────────────────
    print(`${BOLD}  Step 1/5 — API base URL${RESET}`);
    print("");

    let baseUrl = flags.baseUrl ?? "";

    if (!baseUrl) {
      baseUrl = await ask(rl, "Enter your CMS/API base URL", "https://api.example.com");
    } else {
      info(`Using --base-url: ${baseUrl}`);
    }

    // Validate URL format
    try { new URL(baseUrl); } catch {
      fail(`"${baseUrl}" is not a valid URL.`);
      print("");
      process.exit(1);
    }

    // HEAD probe
    output.write(`  ${DIM}Probing ${baseUrl} …${RESET}\r`);
    const head = await headCheck(baseUrl);
    output.write("                                                          \r");

    if (!head.ok) {
      if (head.status === 0) {
        warn(`Could not reach ${baseUrl} (connection refused or DNS error).`);
      } else {
        warn(`Server responded with HTTP ${head.status}. Proceeding anyway.`);
      }
      const proceed = await confirm(rl, "Continue with this URL?", true);
      if (!proceed) { print(""); process.exit(0); }
    } else {
      ok(`Reachable — HTTP ${head.status}`);
    }

    // ── Step 2: CMS detection ───────────────────────────────────────────────
    print("");
    print(`${BOLD}  Step 2/5 — CMS detection${RESET}`);
    print("");

    output.write(`  ${DIM}Auto-detecting CMS type …${RESET}\r`);
    const detected = await detectCms(baseUrl);
    output.write("                                    \r");

    if (detected.confidence === "certain") {
      ok(`Detected: ${BOLD}${detected.cms}${RESET}`);
    } else if (detected.confidence === "likely") {
      info(`Best guess: ${detected.cms}`);
    } else {
      info("Could not auto-detect CMS type — using generic template.");
    }

    // ── Step 3: Auth ────────────────────────────────────────────────────────
    print("");
    print(`${BOLD}  Step 3/5 — Authentication${RESET}`);
    print("");

    const authChoice = await choose(
      rl,
      "Auth type",
      ["Bearer token (most APIs)", "API key header", "HTTP Basic auth", "No auth (public API)"],
      ["bearer", "api-key", "basic", "none"].indexOf(detected.authType),
    );

    let authType: WizardAnswers["authType"] = detected.authType;
    let apiKeyHeader = detected.apiKeyHeader ?? "X-API-Key";

    if (authChoice.startsWith("Bearer")) {
      authType = "bearer";
      info(`Set the env var:  ${BOLD}export CMS_API_TOKEN=<your-token>${RESET}`);
    } else if (authChoice.startsWith("API key")) {
      authType = "api-key";
      apiKeyHeader = await ask(rl, "Header name for API key", detected.apiKeyHeader ?? "X-API-Key");
      info(`Set the env var:  ${BOLD}export CMS_API_TOKEN=<your-key>${RESET}`);
    } else if (authChoice.startsWith("HTTP Basic")) {
      authType = "basic";
      info(`Set env vars:  ${BOLD}export CMS_USERNAME=<u> CMS_PASSWORD=<p>${RESET}`);
    } else {
      authType = "none";
    }

    if (detected.authNote && authType !== "none") {
      dim(`  Tip: ${detected.authNote}`);
    }

    // ── Step 4: Endpoints ───────────────────────────────────────────────────
    print("");
    print(`${BOLD}  Step 4/5 — Endpoints${RESET}`);
    print("");

    const endpoints: Record<string, string> = { ...detected.endpoints };

    if (Object.keys(endpoints).length > 0) {
      info("Auto-detected endpoints:");
      for (const [k, v] of Object.entries(endpoints)) {
        dim(`    ${k.padEnd(14)} → ${v}`);
      }
      print("");
      const customize = await confirm(rl, "Add or override endpoints?", false);
      if (customize) {
        await addEndpoints(rl, endpoints);
      }
    } else {
      info("No endpoints detected — let's add some.");
      print("");
      await addEndpoints(rl, endpoints);
    }

    // ── Step 5: Features ────────────────────────────────────────────────────
    print("");
    print(`${BOLD}  Step 5/5 — Optional features${RESET}`);
    print("");

    const schemaCache = await confirm(rl, "Enable schema cache? (recommended)", true);
    const auditLog    = await confirm(rl, "Enable audit log?", true);

    const enableApprovals = await confirm(rl, "Enable human-in-the-loop approval gate?", false);
    let approvalTools: string[] = [];
    if (enableApprovals) {
      const toolsRaw = await ask(
        rl,
        `Comma-separated tool names to gate (e.g. delete_posts,delete_projects)`,
        Object.keys(endpoints)
          .filter((k) => k !== "media")
          .map((k) => `delete_${k}`)
          .join(","),
      );
      approvalTools = toolsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    }

    const readOnly  = await confirm(rl, "Read-only mode? (disable all write tools)", false);
    const legacyMode = await confirm(rl, "Use legacy mutate_X tools? (v0.5 compat)", false);

    // ── Write config ────────────────────────────────────────────────────────
    const answers: WizardAnswers = {
      baseUrl,
      cms:           detected.cms,
      authType,
      apiKeyHeader,
      endpoints,
      legacyMode,
      schemaCache,
      auditLog,
      approvals:     enableApprovals,
      approvalTools,
      readOnly,
      extraConfig:   (detected.extraConfig ?? {}) as Record<string, unknown>,
    };

    const config = buildConfig(answers);
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    print("");
    print(`  ${"─".repeat(48)}`);
    ok(`${BOLD}Config written to ${configPath}${RESET}`);
    print("");
    print(`${BOLD}  Next steps:${RESET}`);
    print("");

    if (authType === "bearer" || authType === "api-key") {
      print(`  ${CYAN}1.${RESET} Set your credentials:`);
      print(`     ${BOLD}export CMS_API_TOKEN=<your-token>${RESET}`);
    } else if (authType === "basic") {
      print(`  ${CYAN}1.${RESET} Set your credentials:`);
      print(`     ${BOLD}export CMS_USERNAME=<user> CMS_PASSWORD=<pass>${RESET}`);
    } else {
      print(`  ${CYAN}1.${RESET} (No auth required)`);
    }

    print(`  ${CYAN}2.${RESET} Review the config: ${DIM}${configPath}${RESET}`);
    print(`  ${CYAN}3.${RESET} Start the server:`);
    print(`     ${BOLD}npx cms-mcp --config ${configPath}${RESET}`);
    print(`  ${CYAN}4.${RESET} In Claude: run ${BOLD}discover_api${RESET} to auto-detect all endpoints`);
    print("");
    print(`  ${DIM}Docs: https://github.com/parnish007/cms-mcp${RESET}`);
    print("");

  } finally {
    rl.close();
  }
}

// ─── Add endpoints helper ─────────────────────────────────────────────────────

async function addEndpoints(
  rl: readline.Interface,
  endpoints: Record<string, string>,
): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const name = await ask(rl, `Endpoint name (e.g. posts, products) — blank to finish`, "");
    if (!name) break;

    const defaultPath = `/${name}`;
    const path = await ask(rl, `URL path for "${name}"`, defaultPath);
    endpoints[name] = path.startsWith("/") ? path : `/${path}`;
    ok(`Added: ${name} → ${endpoints[name]}`);
  }
}
