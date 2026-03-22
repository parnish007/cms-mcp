// src/lib/config.ts
// Loads and validates cms-mcp.config.json at startup.
// Secrets are resolved from environment variables — never hardcoded.

import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const AuthSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bearer"),
    token: z.string().min(1).describe("Bearer token or env:VAR_NAME reference"),
  }),
  z.object({
    type: z.literal("api-key"),
    header: z.string().default("X-API-Key"),
    token: z.string().min(1).describe("API key or env:VAR_NAME reference"),
  }),
  z.object({
    type: z.literal("basic"),
    username: z.string().min(1),
    password: z.string().min(1).describe("Password or env:VAR_NAME reference"),
  }),
  z.object({
    type: z.literal("none"),
  }),
]);

// Endpoint paths — can be relative ("/projects") or full URLs
const EndpointsSchema = z.object({
  projects:   z.string().optional(),
  blogs:      z.string().optional(),
  media:      z.string().optional(),
  tags:       z.string().optional(),
  siteConfig: z.string().optional(),
  analytics:  z.string().optional(),
});

const GitHubSchema = z.object({
  token:        z.string().min(1).describe("GitHub PAT or env:VAR_NAME reference"),
  defaultOwner: z.string().optional(),
  webhookSecret: z.string().optional().describe("HMAC secret for GitHub webhook verification (env:VAR_NAME supported)"),
});

const FieldMapSchema = z.object({
  title:          z.string().default("title"),
  body:           z.string().default("body"),
  slug:           z.string().default("slug"),
  status:         z.string().default("status"),
  tags:           z.string().default("tags"),
  coverImage:     z.string().default("cover_image"),
  publishedAt:    z.string().default("published_at"),
  seoTitle:       z.string().default("seo_title"),
  seoDescription: z.string().default("seo_description"),
  techStack:      z.string().default("tech_stack"),
  liveUrl:        z.string().default("live_url"),
  repoUrl:        z.string().default("repo_url"),
});

const WebhookSchema = z.object({
  port:   z.number().int().min(1024).max(65535).default(3001),
  secret: z.string().min(1).describe("HMAC secret for verifying GitHub webhook payloads (env:VAR_NAME supported)"),
  path:   z.string().default("/webhook").describe("HTTP path to listen on"),
});

const SchemaCacheSchema = z.object({
  path:       z.string().default("~/.cms-mcp/schema-cache.db").describe("SQLite database path"),
  ttlMinutes: z.number().int().min(1).default(60).describe("Cache TTL in minutes"),
});

const OpenApiSchema = z.object({
  autoDiscover: z.boolean().default(true).describe("Automatically try to discover OpenAPI spec from baseUrl"),
  discoveryUrl: z.string().optional().describe("Override: exact URL of the OpenAPI/Swagger spec"),
});

export const ConfigSchema = z.object({
  name:        z.string().optional().describe("Human-readable name for your site"),
  baseUrl:     z.string().url().describe("Base URL of your CMS API (e.g. https://yoursite.com/api)"),
  auth:        AuthSchema,
  endpoints:   EndpointsSchema.default({}),
  github:      GitHubSchema.optional(),
  fieldMap:    FieldMapSchema.optional().default({}),
  readOnly:    z.boolean().default(false).describe("If true, all write tools are disabled"),
  auditLog:    z.string().optional().describe("Path to write audit log NDJSON file"),
  policies:    z.string().optional().describe("Path to cms-mcp.policies.json"),
  webhook:     WebhookSchema.optional().describe("GitHub webhook listener config"),
  schemaCache: SchemaCacheSchema.optional().describe("SQLite schema cache config"),
  openapi:     OpenApiSchema.optional().describe("OpenAPI/Swagger auto-discovery config"),
});

export type Config      = z.infer<typeof ConfigSchema>;
export type FieldMap    = z.infer<typeof FieldMapSchema>;
export type WebhookConf = z.infer<typeof WebhookSchema>;

// ─── Secret Resolution ────────────────────────────────────────────────────────

export function resolveSecret(value: string): string {
  if (value.startsWith("env:")) {
    const varName = value.slice(4);
    const resolved = process.env[varName];
    if (!resolved) {
      throw new Error(
        `[cms-mcp] Environment variable "${varName}" is required but not set.\n` +
        `Add it to the "env" field in your Claude Desktop config or export it in your shell.`
      );
    }
    return resolved;
  }
  return value;
}

function resolveSecrets(config: Config): Config {
  const auth = config.auth;
  if (auth.type === "bearer" || auth.type === "api-key") {
    (auth as any).token = resolveSecret(auth.token);
  }
  if (auth.type === "basic") {
    (auth as any).password = resolveSecret(auth.password);
  }
  if (config.github) {
    config.github.token = resolveSecret(config.github.token);
    if (config.github.webhookSecret) {
      config.github.webhookSecret = resolveSecret(config.github.webhookSecret);
    }
  }
  if (config.webhook) {
    config.webhook.secret = resolveSecret(config.webhook.secret);
  }
  return config;
}

// ─── Endpoint Resolution ──────────────────────────────────────────────────────
// Resolve relative paths ("/projects") against baseUrl

function resolveEndpoints(config: Config): Config {
  const base = config.baseUrl.replace(/\/$/, "");
  const endpoints = config.endpoints as Record<string, string | undefined>;

  for (const key of Object.keys(endpoints)) {
    const val = endpoints[key];
    if (val && !val.startsWith("http")) {
      endpoints[key] = `${base}${val.startsWith("/") ? "" : "/"}${val}`;
    }
  }
  return config;
}

// ─── Home dir expansion ───────────────────────────────────────────────────────

export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    return resolve(home, p.slice(2));
  }
  return p;
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export function loadConfig(explicitPath?: string): Config {
  const candidates = explicitPath
    ? [resolve(explicitPath)]
    : [
        resolve(process.cwd(), "cms-mcp.config.json"),
        resolve(
          process.env.HOME ?? process.env.USERPROFILE ?? ".",
          "cms-mcp.config.json"
        ),
      ];

  const configPath = candidates.find(existsSync);

  if (!configPath) {
    throw new Error(
      `[cms-mcp] No config file found. Create cms-mcp.config.json in your project root.\n` +
      `See: https://github.com/YOUR_USERNAME/cms-mcp#configuration`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    throw new Error(`[cms-mcp] Failed to parse ${configPath} — check for JSON syntax errors.`);
  }

  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[cms-mcp] Invalid config at ${configPath}:\n${issues}`);
  }

  console.error(`[cms-mcp] Loaded config from ${configPath}`);
  return resolveEndpoints(resolveSecrets(result.data));
}

// ─── Auth Headers ─────────────────────────────────────────────────────────────

export function buildAuthHeaders(config: Config): Record<string, string> {
  const { auth } = config;
  if (auth.type === "bearer") return { Authorization: `Bearer ${auth.token}` };
  if (auth.type === "api-key") return { [auth.header]: auth.token };
  if (auth.type === "basic") {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}
