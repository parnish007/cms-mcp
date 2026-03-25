// src/lib/config.ts
// v1.0.0 — Loads and validates cms-mcp.config.json.
//
// New in v1.0.0:
//   - `adapters`     — per-endpoint CMSAdapter config (fieldMap, updateMethod)
//   - `legacyMode`   — use mutate_X (v0.5 combined tool) instead of split tools
//   - `allowedPorts` — SSRF whitelist for non-standard API ports
//   - `SecretManager` integration — secrets are tokenized after resolution;
//     the Config object never holds plain-text credentials after loadConfig()

import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { getSecretManager, tokenizeSecrets } from "./secret-manager.js";

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const AuthSchema = z.discriminatedUnion("type", [
  z.object({
    type:  z.literal("bearer"),
    token: z.string().min(1).describe("Bearer token or env:VAR_NAME reference"),
  }),
  z.object({
    type:   z.literal("api-key"),
    header: z.string().default("X-API-Key"),
    token:  z.string().min(1).describe("API key or env:VAR_NAME reference"),
  }),
  z.object({
    type:     z.literal("basic"),
    username: z.string().min(1),
    password: z.string().min(1).describe("Password or env:VAR_NAME reference"),
  }),
  z.object({
    type: z.literal("none"),
  }),
]);

const EndpointsSchema = z.record(z.string(), z.string()).default({});

// Per-endpoint adapter configuration — the Mapping Layer
const AdapterConfigSchema = z.object({
  /**
   * HTTP method for update operations. Defaults to "PATCH".
   * Use "PUT" for APIs requiring full-replacement semantics.
   */
  updateMethod: z.enum(["PATCH", "PUT"]).default("PATCH"),

  /**
   * Field name translation map: internalKey → externalKey.
   * Internal keys are the LLM-friendly names Claude uses.
   * External keys are the actual API field names.
   *
   * Example: { "title": "post_heading_1", "body": "post_content_markdown" }
   */
  fieldMap: z.record(z.string(), z.string()).optional(),
}).optional();

const GitHubSchema = z.object({
  token:         z.string().min(1).describe("GitHub PAT or env:VAR_NAME reference"),
  defaultOwner:  z.string().optional(),
  webhookSecret: z.string().optional(),
});

const WebhookSchema = z.object({
  port:   z.number().int().min(1024).max(65535).default(3001),
  secret: z.string().min(1),
  path:   z.string().default("/webhook"),
});

const SchemaCacheSchema = z.object({
  path:       z.string().default("~/.cms-mcp/schema-cache.db"),
  ttlMinutes: z.number().int().min(1).default(60),
});

const OpenApiSchema = z.object({
  autoDiscover: z.boolean().default(true),
  discoveryUrl: z.string().optional(),
});

const EmbeddingSchema = z.object({
  provider: z.literal("openai"),
  apiKey:   z.string().min(1),
  model:    z.string().default("text-embedding-3-small"),
});

const ApprovalsSchema = z.object({
  port:      z.number().int().min(1024).max(65535).default(2323),
  timeoutMs: z.number().int().min(5000).default(300_000),
  tools:     z.array(z.string()).optional(),
});

// ─── Root schema ──────────────────────────────────────────────────────────────

export const ConfigSchema = z.object({
  name:        z.string().optional(),
  baseUrl:     z.string().url(),
  auth:        AuthSchema,
  endpoints:   EndpointsSchema,

  /**
   * Per-endpoint adapter configuration (fieldMap, updateMethod).
   * Keys must match keys in `endpoints`.
   */
  adapters:    z.record(z.string(), AdapterConfigSchema).optional(),

  /**
   * When true: register mutate_X (v0.5 combined tool) instead of the
   * default v1.0.0 split tools (create_X, update_X, delete_X).
   * Useful for backward compatibility with saved Claude prompts.
   */
  legacyMode:  z.boolean().default(false),

  /**
   * Ports that are explicitly allowed in outbound API URLs.
   * By default only standard HTTP (80) and HTTPS (443) are allowed.
   * Add non-standard ports here: [3000, 8080, 4000].
   */
  allowedPorts: z.array(z.number().int().min(1).max(65535)).optional(),

  github:      GitHubSchema.optional(),
  readOnly:    z.boolean().default(false),
  auditLog:    z.string().optional(),
  policies:    z.string().optional(),
  webhook:     WebhookSchema.optional(),
  schemaCache: SchemaCacheSchema.optional(),
  openapi:     OpenApiSchema.optional(),
  embedding:   EmbeddingSchema.optional(),
  approvals:   ApprovalsSchema.optional(),
}) satisfies z.ZodType;

export type Config        = z.infer<typeof ConfigSchema>;
export type AdapterConf   = z.infer<typeof AdapterConfigSchema>;
export type WebhookConf   = z.infer<typeof WebhookSchema>;
export type EmbeddingConf = z.infer<typeof EmbeddingSchema>;
export type ApprovalsConf = z.infer<typeof ApprovalsSchema>;

// ─── Home dir expansion ───────────────────────────────────────────────────────

export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    return resolve(home, p.slice(2));
  }
  return p;
}

// ─── Endpoint resolution ──────────────────────────────────────────────────────

function resolveEndpoints(config: Config): void {
  const base = config.baseUrl.replace(/\/$/, "");
  const endpoints = config.endpoints as Record<string, string>;
  for (const key of Object.keys(endpoints)) {
    const val = endpoints[key];
    if (val && !val.startsWith("http")) {
      endpoints[key] = `${base}${val.startsWith("/") ? "" : "/"}${val}`;
    }
  }
}

// ─── Secret tokenization ──────────────────────────────────────────────────────
// After this function runs, the Config object no longer contains plain-text
// secrets. All secret values are replaced with opaque tokens.
// Use SecretManager.resolve(token) to get the real value when needed.

function tokenizeConfigSecrets(config: Config): void {
  const sm = getSecretManager();

  tokenizeSecrets(sm, [
    // Auth secrets
    ...(config.auth.type === "bearer" || config.auth.type === "api-key"
      ? [{
          label: `auth-token`,
          getValue: () => (config.auth as any).token as string,
          setValue: (v: string) => { (config.auth as any).token = v; },
        }]
      : []),
    ...(config.auth.type === "basic"
      ? [{
          label: `auth-password`,
          getValue: () => (config.auth as any).password as string,
          setValue: (v: string) => { (config.auth as any).password = v; },
        }]
      : []),
    // GitHub token
    ...(config.github ? [{
      label: `github-token`,
      getValue: () => config.github!.token,
      setValue: (v: string) => { config.github!.token = v; },
    }] : []),
    ...(config.github?.webhookSecret ? [{
      label: `github-webhook-secret`,
      getValue: () => config.github!.webhookSecret!,
      setValue: (v: string) => { config.github!.webhookSecret = v; },
    }] : []),
    // Webhook secret
    ...(config.webhook ? [{
      label: `webhook-secret`,
      getValue: () => config.webhook!.secret,
      setValue: (v: string) => { config.webhook!.secret = v; },
    }] : []),
    // Embedding API key
    ...(config.embedding ? [{
      label: `openai-api-key`,
      getValue: () => config.embedding!.apiKey,
      setValue: (v: string) => { config.embedding!.apiKey = v; },
    }] : []),
  ]);
}

// ─── loadConfig ───────────────────────────────────────────────────────────────

export function loadConfig(explicitPath?: string): Config {
  const candidates = explicitPath
    ? [resolve(explicitPath)]
    : [
        resolve(process.cwd(), "cms-mcp.config.json"),
        resolve(process.env.HOME ?? process.env.USERPROFILE ?? ".", "cms-mcp.config.json"),
      ];

  const configPath = candidates.find(existsSync);
  if (!configPath) {
    throw new Error(
      `[cms-mcp] No config file found. Create cms-mcp.config.json in your project root.\n` +
      `Tip: run \`npx cms-mcp init --base-url <url>\` to generate one.`
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

  const config = result.data;

  // Resolve relative endpoint paths → absolute URLs
  resolveEndpoints(config);

  // Tokenize all secrets — after this call, config holds no plain-text credentials
  tokenizeConfigSecrets(config);

  // Warn if adapter keys don't match any configured endpoint (likely typo)
  if (config.adapters) {
    const endpointKeys = new Set(Object.keys(config.endpoints));
    for (const adapterKey of Object.keys(config.adapters)) {
      if (!endpointKeys.has(adapterKey)) {
        process.stderr.write(
          `[cms-mcp] Warning: adapters["${adapterKey}"] has no matching endpoint key. ` +
          `Configured endpoints: ${[...endpointKeys].join(", ")}.\n`,
        );
      }
    }
  }

  process.stderr.write(`[cms-mcp] Loaded config from ${configPath}\n`);
  return config;
}

// ─── Auth headers ─────────────────────────────────────────────────────────────
// Resolves secret tokens back to real values — only called here, just before
// sending HTTP requests.

export function buildAuthHeaders(config: Config): Record<string, string> {
  const sm = getSecretManager();
  const { auth } = config;

  if (auth.type === "bearer") {
    return { Authorization: `Bearer ${sm.resolveAny(auth.token)}` };
  }
  if (auth.type === "api-key") {
    return { [auth.header]: sm.resolveAny(auth.token) };
  }
  if (auth.type === "basic") {
    const password = sm.resolveAny(auth.password);
    const encoded  = Buffer.from(`${auth.username}:${password}`).toString("base64");
    return { Authorization: `Basic ${encoded}` };
  }
  return {};
}

// ─── Adapter config lookup ────────────────────────────────────────────────────

export function getAdapterConfig(config: Config, endpointKey: string): AdapterConf {
  return config.adapters?.[endpointKey] ?? { updateMethod: "PATCH" };
}
