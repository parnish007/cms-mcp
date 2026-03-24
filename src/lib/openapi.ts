// src/lib/openapi.ts
// OpenAPI / Swagger discovery engine.
// Given a baseUrl, finds the spec, parses it, and suggests endpoint config.
// Supports OpenAPI 3.x and Swagger 2.x (both JSON and YAML shims).

const DISCOVERY_PATHS = [
  "/.well-known/openapi.json",
  "/openapi.json",
  "/openapi.yaml",
  "/swagger.json",
  "/swagger/v1/swagger.json",
  "/api-docs/json",
  "/api-docs",
  "/api/openapi.json",
  "/api/swagger.json",
  "/docs/openapi.json",
];

const TIMEOUT_MS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoveredEndpoint {
  path: string;
  methods: string[];
  summary?: string;
  operationIds?: string[];
  tags?: string[];
}

export interface DiscoveredResource {
  name: string;           // "posts", "projects", "media"
  listPath: string;       // GET /posts
  itemPath?: string;      // GET /posts/{id}
  createPath?: string;    // POST /posts
  updatePath?: string;    // PATCH /posts/{id}
  deletePath?: string;    // DELETE /posts/{id}
  suggestedKey: string;   // config key: "blogs" | "projects" | "media"
}

export interface OpenApiDiscoveryResult {
  specUrl: string;
  title: string;
  version: string;
  description?: string;
  endpoints: DiscoveredEndpoint[];
  resources: DiscoveredResource[];
  suggestedEndpointConfig: Record<string, string>;
  rawPathCount: number;
  /** Raw parsed spec object — used by openapi-parser.ts for schema extraction. */
  rawSpec?: Record<string, unknown>;
}

// ─── Fetch spec ───────────────────────────────────────────────────────────────

async function tryFetchSpec(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "error",
      headers: { Accept: "application/json, application/yaml, */*" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    const text = await res.text();
    // Try JSON first regardless of Content-Type
    try {
      return JSON.parse(text);
    } catch {
      // YAML shim: return raw text so caller can handle it
      if (ct.includes("yaml") || url.endsWith(".yaml")) return { _yaml: text };
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Parse OpenAPI / Swagger spec ─────────────────────────────────────────────

interface PathItem {
  get?: { summary?: string; operationId?: string; tags?: string[] };
  post?: { summary?: string; operationId?: string; tags?: string[] };
  put?: { summary?: string; operationId?: string; tags?: string[] };
  patch?: { summary?: string; operationId?: string; tags?: string[] };
  delete?: { summary?: string; operationId?: string; tags?: string[] };
}

function extractEndpoints(spec: any): DiscoveredEndpoint[] {
  const paths: Record<string, PathItem> = spec.paths ?? {};
  const endpoints: DiscoveredEndpoint[] = [];

  for (const [path, item] of Object.entries(paths)) {
    const pathItem = item as PathItem;
    const methods: string[] = [];
    const summaries: string[] = [];
    const opIds: string[] = [];
    const tags: string[] = [];

    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const op = pathItem[method];
      if (op) {
        methods.push(method.toUpperCase());
        if (op.summary) summaries.push(op.summary);
        if (op.operationId) opIds.push(op.operationId);
        if (op.tags) tags.push(...op.tags);
      }
    }

    if (methods.length > 0) {
      endpoints.push({
        path,
        methods,
        summary: summaries[0],
        operationIds: opIds.length > 0 ? opIds : undefined,
        tags: [...new Set(tags)],
      });
    }
  }

  return endpoints;
}

// ─── Resource grouping ────────────────────────────────────────────────────────

// Map common resource name patterns to cms-mcp config keys
const RESOURCE_KEY_MAP: Array<{ patterns: RegExp[]; key: string }> = [
  { patterns: [/blogs?|posts?|articles?|entries/i], key: "blogs" },
  { patterns: [/projects?|works?|portfolio/i], key: "projects" },
  { patterns: [/media|uploads?|images?|assets?|files?/i], key: "media" },
  { patterns: [/tags?|categor/i], key: "tags" },
];

function mapResourceKey(name: string): string | undefined {
  for (const { patterns, key } of RESOURCE_KEY_MAP) {
    if (patterns.some((p) => p.test(name))) return key;
  }
  return undefined;
}

function extractResources(endpoints: DiscoveredEndpoint[]): DiscoveredResource[] {
  // Group endpoints by their "root" path (first segment)
  // e.g. /posts and /posts/{id} → root "posts"
  const groups = new Map<string, DiscoveredEndpoint[]>();

  for (const ep of endpoints) {
    const parts = ep.path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    const root = parts[0];
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(ep);
  }

  const resources: DiscoveredResource[] = [];

  for (const [name, eps] of groups) {
    // Skip paths that look like sub-resources (more than 2 segments)
    const listEp = eps.find((e) => !e.path.includes("{") && e.methods.includes("GET"));
    const itemEp = eps.find((e) => e.path.includes("{") && e.methods.includes("GET"));
    const createEp = eps.find((e) => !e.path.includes("{") && (e.methods.includes("POST")));
    const updateEp = eps.find((e) => e.path.includes("{") && (e.methods.includes("PATCH") || e.methods.includes("PUT")));
    const deleteEp = eps.find((e) => e.path.includes("{") && e.methods.includes("DELETE"));

    if (!listEp && !createEp) continue; // not a real resource

    const suggestedKey = mapResourceKey(name) ?? name;

    resources.push({
      name,
      listPath: listEp?.path ?? createEp?.path ?? `/${name}`,
      itemPath: itemEp?.path,
      createPath: createEp?.path,
      updatePath: updateEp?.path,
      deletePath: deleteEp?.path,
      suggestedKey,
    });
  }

  return resources;
}

// ─── Main discovery function ──────────────────────────────────────────────────

export async function discoverOpenApi(
  baseUrl: string,
  overrideUrl?: string,
): Promise<OpenApiDiscoveryResult | null> {
  const base = baseUrl.replace(/\/$/, "");
  const urlsToTry = overrideUrl
    ? [overrideUrl]
    : DISCOVERY_PATHS.map((p) => `${base}${p}`);

  let spec: any = null;
  let specUrl = "";

  for (const url of urlsToTry) {
    const result = await tryFetchSpec(url);
    if (result && !(result as any)._yaml) {
      spec = result;
      specUrl = url;
      break;
    }
  }

  if (!spec) return null;

  // Support both OpenAPI 3.x (info) and Swagger 2.x (info)
  const info = spec.info ?? {};
  const title = info.title ?? "Unknown API";
  const version = info.version ?? spec.swagger ?? spec.openapi ?? "?";
  const description = info.description;

  const endpoints = extractEndpoints(spec);
  const resources = extractResources(endpoints);

  // Build suggested endpoint config — include ALL discovered resources.
  // Known resources get their canonical key (e.g. "posts" → "blogs").
  // Unknown resources use their own name as the key so nothing is lost.
  const suggestedEndpointConfig: Record<string, string> = {};
  for (const r of resources) {
    const knownKey = mapResourceKey(r.name) ?? r.name;
    suggestedEndpointConfig[knownKey] = r.listPath;
  }

  return {
    specUrl,
    title,
    version,
    description,
    endpoints,
    resources,
    suggestedEndpointConfig,
    rawPathCount: Object.keys(spec.paths ?? {}).length,
    rawSpec: spec as Record<string, unknown>,
  };
}

// ─── Format result as Claude-readable text ────────────────────────────────────

export function formatDiscoveryResult(result: OpenApiDiscoveryResult): string {
  const lines: string[] = [
    `## API Discovered: ${result.title} (v${result.version})`,
    `**Spec:** ${result.specUrl}`,
    `**Total paths:** ${result.rawPathCount}`,
  ];

  if (result.description) {
    lines.push(``, `> ${result.description.slice(0, 200)}`);
  }

  lines.push(``, `### Detected Resources`);
  if (result.resources.length === 0) {
    lines.push(`_(no standard CRUD resources detected)_`);
  } else {
    lines.push(`| Resource | List | Create | Update | Delete |`,
               `|----------|------|--------|--------|--------|`);
    for (const r of result.resources) {
      lines.push(
        `| \`${r.name}\` | ${r.listPath} | ${r.createPath ?? "—"} | ${r.updatePath ?? "—"} | ${r.deletePath ?? "—"} |`
      );
    }
  }

  if (Object.keys(result.suggestedEndpointConfig).length > 0) {
    lines.push(``, `### Suggested \`endpoints\` config`);
    lines.push("```json");
    lines.push(JSON.stringify({ endpoints: result.suggestedEndpointConfig }, null, 2));
    lines.push("```");
    lines.push(``, `Add this to your \`cms-mcp.config.json\` — or run \`apply_discovered_endpoints\` to apply automatically.`);
  }

  return lines.join("\n");
}
