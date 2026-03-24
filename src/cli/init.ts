// src/cli/init.ts
// `npx cms-mcp init` — interactive config generator.
//
// Probes the given baseUrl for known CMS signatures, then writes a
// starter cms-mcp.config.json. Reduces new-user setup from 20 minutes
// to under 60 seconds.
//
// Detected CMSes:
//   Supabase (PostgREST)  — /rest/v1/ prefix + apikey header
//   Strapi v4/v5          — /api/_health response
//   Directus              — /server/info response
//   PocketBase            — /api/health response
//   Payload CMS           — /api/globals or /api/users response
//   Generic REST API      — falls back to a minimal template

import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectResult {
  cms: string;
  authType: string;
  authNote: string;
  endpoints: Record<string, string>;
  extraConfig?: Record<string, unknown>;
}

// ─── CMS detection probes ─────────────────────────────────────────────────────

async function probe(url: string, timeoutMs = 5000): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function detectCms(baseUrl: string): Promise<DetectResult> {
  const base = baseUrl.replace(/\/$/, "");

  // ── Supabase / PostgREST ──────────────────────────────────────────────────
  // PostgREST returns a JSON object with table definitions at the root.
  const pgRest = await probe(`${base}/`);
  if (pgRest && typeof pgRest === "object" && (pgRest as any).paths) {
    return {
      cms: "Supabase / PostgREST",
      authType: "api-key",
      authNote: "Set CMS_API_TOKEN to your Supabase anon key. Header defaults to apikey.",
      endpoints: {
        posts:    "/posts",
        projects: "/projects",
        media:    "/storage/v1/object",
      },
      extraConfig: {
        openapi: { autoDiscover: true, discoveryUrl: `${base}/` },
      },
    };
  }

  // ── Strapi ────────────────────────────────────────────────────────────────
  const strapi = await probe(`${base}/_health`) as any;
  if (strapi?.data?.status === "UP" || strapi?.status === "UP") {
    return {
      cms: "Strapi",
      authType: "bearer",
      authNote: "Set CMS_API_TOKEN to a Strapi API token (Settings → API Tokens).",
      endpoints: {
        posts:    "/posts",
        projects: "/projects",
        media:    "/upload/files",
      },
    };
  }

  // ── Directus ──────────────────────────────────────────────────────────────
  const directus = await probe(`${base}/server/info`) as any;
  if (directus?.data?.project) {
    return {
      cms: "Directus",
      authType: "bearer",
      authNote: "Set CMS_API_TOKEN to a Directus static token (User settings → Token).",
      endpoints: {
        posts:    "/items/posts",
        projects: "/items/projects",
        media:    "/files",
      },
    };
  }

  // ── PocketBase ────────────────────────────────────────────────────────────
  const pb = await probe(`${base}/api/health`) as any;
  if (pb?.code === 200 || pb?.message === "API is healthy.") {
    return {
      cms: "PocketBase",
      authType: "bearer",
      authNote: "Set CMS_API_TOKEN to a PocketBase admin token from /api/admins/auth-with-password.",
      endpoints: {
        posts:    "/api/collections/posts/records",
        projects: "/api/collections/projects/records",
        media:    "/api/files",
      },
    };
  }

  // ── Payload CMS ───────────────────────────────────────────────────────────
  const payload = await probe(`${base}/api/globals`) as any;
  if (Array.isArray(payload?.docs) || payload?.totalDocs !== undefined) {
    return {
      cms: "Payload CMS",
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
    authType: "bearer",
    authNote: "Set CMS_API_TOKEN to your API token.",
    endpoints: {
      posts:    "/posts",
      media:    "/uploads",
    },
  };
}

// ─── Config builder ───────────────────────────────────────────────────────────

function buildConfig(baseUrl: string, detected: DetectResult): Record<string, unknown> {
  return {
    name:    detected.cms,
    baseUrl,
    auth: {
      type:  detected.authType,
      token: "env:CMS_API_TOKEN",
    },
    endpoints:   detected.endpoints,
    schemaCache: { path: "~/.cms-mcp/schema-cache.db", ttlMinutes: 60 },
    openapi:     { autoDiscover: true },
    auditLog:    "~/.cms-mcp/audit.log",
    ...(detected.extraConfig ?? {}),
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runInit(flags: { config?: string; baseUrl?: string }): Promise<void> {
  const out = process.stderr;

  out.write("\n  cms-mcp init\n  ─────────────────────────────────────\n\n");

  // Determine output path
  const configPath = resolve(flags.config ?? "cms-mcp.config.json");

  if (existsSync(configPath)) {
    out.write(`  ⚠️  Config already exists: ${configPath}\n`);
    out.write(`  Delete it or use --config <path> for a different location.\n\n`);
    process.exit(1);
  }

  // Get baseUrl — from flag or prompt fallback
  let baseUrl = flags.baseUrl;
  if (!baseUrl) {
    // In non-interactive mode (stdio MCP) we can't prompt; emit a helpful error.
    out.write(`  Usage: npx cms-mcp init --base-url https://your-api.com/api\n\n`);
    out.write(`  Example:\n`);
    out.write(`    npx cms-mcp init --base-url https://mysite.supabase.co/rest/v1\n\n`);
    process.exit(1);
  }

  out.write(`  Probing ${baseUrl} …\n`);
  const detected = await detectCms(baseUrl);
  out.write(`  Detected: ${detected.cms}\n\n`);
  out.write(`  Auth note: ${detected.authNote}\n\n`);

  const config = buildConfig(baseUrl, detected);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

  out.write(`  ✅ Config written to ${configPath}\n\n`);
  out.write(`  Next steps:\n`);
  out.write(`    1. export CMS_API_TOKEN=your-token\n`);
  out.write(`    2. Edit ${configPath} — add/rename endpoints to match your CMS\n`);
  out.write(`    3. npx cms-mcp --config ${configPath}\n\n`);
  out.write(`  Tip: Run discover_api in Claude after starting to auto-detect all endpoints.\n\n`);
}
