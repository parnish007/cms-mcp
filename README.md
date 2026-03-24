# cms-mcp

<div align="center">

[![npm version](https://img.shields.io/npm/v/cms-mcp?color=blue&style=flat-square)](https://www.npmjs.com/package/cms-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-compatible-6366f1?style=flat-square)](https://modelcontextprotocol.io)
[![Tests](https://img.shields.io/badge/tests-78%20passing-22c55e?style=flat-square)](#testing)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?style=flat-square)](https://nodejs.org/)

**A [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude full control over any REST-based CMS.**

Write blog posts, manage projects, upload media, search content semantically, enforce publishing policies, and require human approval before anything goes live — all through natural language with Claude.

**v0.4.0: Tools are now auto-generated from your live CMS schema — any field structure, any endpoint name, zero code changes.**

</div>

---

```
You: "Scan my latest GitHub repo and publish it as a portfolio project"
Claude: Done — scanned, policy-checked, diff shown, awaiting your approval...
[You click Approve in browser]
Claude: Published. ✅

You: "Have I written about LSTMs before? If so, link to that post in this new article."
Claude: Yes — found "Deep Learning Fundamentals" (87% match). Linking now.

You: "List my draft products"
Claude: Found 8 products: [id] Widget Pro (draft), [id] Gadget X (draft)...

You: "Create a new author named Jane Doe with email jane@example.com"
Claude: ✅ Author created! ID: a1b2c3, name: Jane Doe
```

Works with **any REST API** — Supabase, PocketBase, Payload CMS, Directus, Strapi, custom Next.js/Express/FastAPI routes, or any backend that speaks JSON over HTTP.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Generic Tool System](#generic-tool-system)
- [Tools Reference](#tools-reference)
- [Advanced Features](#advanced-features)
- [Security](#security)
- [Testing](#testing)
- [Docker](#docker)
- [Current Limitations](#current-limitations)
- [Migration from v0.3.x](#migration-from-v03x)
- [Contributing](#contributing)

---

## How It Works

At startup, cms-mcp resolves each endpoint schema using a 4-tier priority chain:

| Tier | Source | Description |
|------|--------|-------------|
| **1 — Cache** | SQLite | Instant startup — uses previously cached schema, no API calls |
| **2 — OpenAPI** | Spec | Parses your API's Swagger/OpenAPI spec — authoritative field list with types, enums, required/optional, readOnly |
| **3 — Sampling** | Live API | Fetches up to 5 records, infers types from runtime values |
| **4 — Cold-start** | Passthrough | No records, no spec — registers tools with `Record<unknown>` so you can still write |

Then for each endpoint:

1. Reads `config.endpoints` — any key, any URL (e.g. `"products": "/api/products"`)
2. Resolves schema via the tier chain above
3. Builds Zod validators from resolved field definitions
4. Registers 7 MCP tools (`list_X`, `get_X`, `preview_create_X`, `create_X`, `preview_update_X`, `update_X`, `delete_X`)
5. Caches schema in SQLite so next startup hits Tier 1 instantly

Claude receives tool descriptions that exactly match your CMS's real field names and types — not a hardcoded subset. If your CMS has `headline` instead of `title`, or `category_id` alongside `status`, all those fields are present with the correct Zod type automatically.

---

## Features

| Feature | What it does |
|---------|-------------|
| **🆕 Generic schema-driven tools** | 7 tools auto-generated per endpoint from live field introspection |
| **🆕 OpenAPI-first schema engine** | Spec-sourced schemas (4-tier: cache → OpenAPI → sampling → cold-start) |
| **🆕 Any endpoint key** | `"products"`, `"authors"`, `"events"` — not limited to blogs/projects |
| **🆕 Cold-start mode** | Passthrough tools registered even for empty endpoints |
| **🆕 Schema refresh** | `refresh_resource_schema` updates cache without full restart |
| **🆕 List configured endpoints** | `list_configured_endpoints` shows all keys, URLs, cache status |
| **MCP Resources** | `cms://projects/{id}`, `cms://blogs/{id}` — Claude reads content directly |
| **Zod validation firewall** | Runtime Zod shapes built from inferred types — every input validated |
| **Atomic transactions + rollback** | Failed writes auto-revert — no half-created records |
| **Diff preview before writes** | Field-level change table before anything hits your API |
| **Policy engine** | 10 rule types enforce publishing standards across teams |
| **Human approval gate** | Local dashboard — Claude pauses, you click Approve/Reject |
| **OpenAI semantic search** | Real embeddings (text-embedding-3-small) or local TF-IDF |
| **Auto-schema inspector** | `inspect_endpoint_schema` fetches live records, shows field types |
| **OpenAPI auto-discovery** | Scans your API for a Swagger/OpenAPI spec on startup |
| **Circuit breaker** | Serves cached responses when your CMS API goes down |
| **Content distillation** | HTML→Markdown, junk field stripping, metadata headers |
| **GitHub webhook mode** | Auto-creates draft entries when you push to a repo |
| **Schema cache** | SQLite-backed schema cache with TTL invalidation |
| **Audit logging** | Every tool call logged — tool, args, outcome, duration |
| **Read-only mode** | Disable all writes for exploratory sessions |
| **SSRF + security hardening** | Private IPs blocked, no redirect following, 30s timeouts |
| **78 tests** | 6 suites — policy, security, vector cache, circuit breaker, distiller, OpenAPI |

---

## Installation

**npx (no install):**
```bash
npx cms-mcp --config ./cms-mcp.config.json
```

**npm global:**
```bash
npm install -g cms-mcp
```

**From source:**
```bash
git clone https://github.com/parnish007/cms-mcp
cd cms-mcp
npm install && npm run build
node build/index.js --config ./cms-mcp.config.json
```

**Docker:**
```bash
docker compose up
```

---

## Quick Start

**1. Create `cms-mcp.config.json`:**

```json
{
  "baseUrl": "https://your-api.com/api",
  "auth": {
    "type": "bearer",
    "token": "env:CMS_API_TOKEN"
  },
  "endpoints": {
    "posts":    "/posts",
    "projects": "/projects",
    "products": "/products",
    "authors":  "/authors",
    "media":    "/uploads"
  }
}
```

Any key works. At startup, cms-mcp generates `list_posts`, `create_posts`, `list_products`, `create_products`, etc. — with schemas matching whatever fields your API actually has.

**2. Set environment variables:**
```bash
export CMS_API_TOKEN=your-token-here
```

**3. Add to Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "npx",
      "args": ["cms-mcp", "--config", "/path/to/cms-mcp.config.json"],
      "env": { "CMS_API_TOKEN": "your-token-here" }
    }
  }
}
```

**Or add to Claude Code:**
```bash
claude mcp add cms-mcp -- npx cms-mcp --config ./cms-mcp.config.json
```

**4. Talk to Claude:**
```
"List my draft posts"
"Create a product called Widget Pro with price 29.99"
"Inspect the schema of my authors endpoint"
"Show me what endpoints are configured"
"Refresh the schema for products and tell me what changed"
```

---

## Configuration

### Full config reference

```json
{
  "name": "My Site",
  "baseUrl": "https://your-api.com/api",

  "auth": {
    "type": "bearer",
    "token": "env:CMS_API_TOKEN"
  },

  "endpoints": {
    "posts":    "/posts",
    "projects": "/projects",
    "products": "/products",
    "authors":  "/authors",
    "events":   "/events",
    "media":    "/uploads"
  },

  "github": {
    "token":        "env:GITHUB_TOKEN",
    "defaultOwner": "your-username"
  },

  "readOnly": false,
  "auditLog": "~/.cms-mcp/audit.log",
  "policies": "./cms-mcp.policies.json",

  "schemaCache": {
    "path":       "~/.cms-mcp/schema-cache.db",
    "ttlMinutes": 60
  },

  "embedding": {
    "provider": "openai",
    "apiKey":   "env:OPENAI_API_KEY",
    "model":    "text-embedding-3-small"
  },

  "approvals": {
    "port":      2323,
    "timeoutMs": 300000,
    "tools":     ["publish_posts", "delete_posts", "delete_products"]
  },

  "openapi": {
    "autoDiscover": true,
    "discoveryUrl": "https://your-api.com/api/docs/openapi.json"
  },

  "webhook": {
    "port":   3001,
    "secret": "env:WEBHOOK_SECRET",
    "path":   "/webhook"
  }
}
```

### Auth types

| Type | Config |
|------|--------|
| Bearer token | `{ "type": "bearer", "token": "env:MY_TOKEN" }` |
| API key header | `{ "type": "api-key", "header": "X-API-Key", "token": "env:MY_KEY" }` |
| HTTP Basic | `{ "type": "basic", "username": "admin", "password": "env:MY_PASS" }` |
| No auth | `{ "type": "none" }` |

Any string prefixed with `env:` is resolved from the environment at startup. Secrets are **never** written to logs.

### CLI flags

| Flag | Description |
|------|-------------|
| `--config <path>`, `-c` | Config file path |
| `--readonly` | Disable all write tools |
| `--approval` | Enable approval gate even without `approvals` config block |
| `--webhook` | Start GitHub webhook listener |
| `--no-discover` | Skip OpenAPI auto-discovery |

---

## Generic Tool System

### How schema introspection works

For each key in `config.endpoints` (except `media`), cms-mcp:

1. **Checks the SQLite schema cache** — if a fresh entry exists, uses it (no API call)
2. **Fetches up to 5 live records** — `GET /endpoint?limit=5`
3. **Infers field types** from the actual values:

| Inferred type | What it means | Zod validator |
|---|---|---|
| `uuid` | UUID-format string | `z.string().uuid()` |
| `date` | ISO 8601 date string | `z.string().datetime()` |
| `url` | HTTP/HTTPS URL | `z.string().url()` |
| `email` | Email address | `z.string().email()` |
| `slug` | URL-safe lowercase slug | `z.string().regex(...)` |
| `enum(a\|b\|c)` | Closed set of string values | `z.enum(["a","b","c"])` |
| `string` | Generic string | `z.string()` |
| `number` | Numeric value | `z.number()` |
| `boolean` | True/false | `z.boolean()` |
| `array` | Array of any values | `z.array(z.unknown())` |
| `object` | Nested object | `z.record(z.unknown())` |
| Any `*?` | Nullable variant | base type + `.optional()` |

4. **Builds Zod shapes** — `create` mode excludes system fields (`id`, `created_at`, etc.), `update` mode makes all fields optional + requires `id`
5. **Registers 7 tools** per resource (see below)
6. **Caches the schema** in SQLite (TTL from `schemaCache.ttlMinutes`, default 60m)

### Tools generated per endpoint

For an endpoint key `X`, these tools are registered:

| Tool | Description |
|------|-------------|
| `list_X` | List records. Params: `limit`, `search`, plus any enum-typed fields as filters |
| `get_X` | Fetch a single record by ID |
| `preview_create_X` | Show a diff table of what will be created — no API call |
| `create_X` | Create a record. Requires `confirm: true`. All writable fields available |
| `preview_update_X` | Show a diff table of what will change — fetches current record |
| `update_X` | Update a record. Requires `id` + `confirm: true` |
| `delete_X` | Delete a record. Requires `id` + `confirm: true`. Gated by approval if configured |

### Cold-start mode

If an endpoint returns zero records at introspection time (brand-new CMS), tools are still registered in **passthrough mode**:

- `create_X` accepts `fields: Record<string, unknown>` — pass any key-value pairs
- `update_X` accepts `id` + `fields: Record<string, unknown>`
- Tools display a notice explaining that field hints aren't available yet

**To upgrade from cold-start to full schema:**
1. Create at least one record in your CMS
2. Ask Claude: `"Refresh the schema for X"` (calls `refresh_resource_schema`)
3. Restart cms-mcp — the new tool shapes will be applied

### Schema cache and refresh

```
Startup: check SQLite → cache hit → use immediately (fast)
                      → cache miss → introspect live API → cache result

Manual refresh: refresh_resource_schema → invalidate cache → re-introspect → re-cache
                → restart required for tool shapes to update
```

Clear all cached schemas: ask Claude `"Clear the schema cache"` (calls `clear_cache`).

---

## Tools Reference

### Generic resource tools (per configured endpoint)

See [Generic Tool System](#generic-tool-system) above. For endpoint key `posts`:
`list_posts` · `get_posts` · `preview_create_posts` · `create_posts` · `preview_update_posts` · `update_posts` · `delete_posts`

### Media (3 tools)
`upload_media_from_url` · `list_media` · `delete_media`

The `media` endpoint key is reserved for these dedicated tools (multipart upload, SSRF-hardened proxy).

### GitHub (3 tools)
`scan_repo` · `sync_repo_to_project` · `list_repos`

### Introspection (9 tools)
`discover_api` · `apply_discovered_endpoints` · `inspect_endpoint_schema` · `refresh_resource_schema` · `list_configured_endpoints` · `check_policies` · `init_policies` · `cache_stats` · `clear_cache`

### Search (3 tools)
`semantic_search` · `sync_all_content` · `knowledge_status`

### MCP Resources
```
cms://projects          → List all projects
cms://projects/{id}     → Read a single project (distilled HTML→Markdown)
cms://blogs             → List all blog posts
cms://blogs/{id}        → Read a single blog post (distilled)
```

---

## Advanced Features

### Human Approval Gate

When enabled, every write operation pauses and waits for a human to approve in a local browser UI.

**Enable:**
```bash
npx cms-mcp --config ./config.json --approval
```

Or in config:
```json
{
  "approvals": {
    "port": 2323,
    "tools": ["publish_posts", "delete_posts", "delete_products"]
  }
}
```

**Flow:**
1. Claude calls `delete_posts`
2. cms-mcp prints: `Approval required — open http://localhost:2323`
3. Browser shows the diff preview with Approve / Reject buttons
4. You click Approve → write executes
5. You click Reject → Claude is told the operation was rejected

Auto-rejects after 5 minutes (configurable with `timeoutMs`).

See [docs/advanced/approval-gate.md](./docs/advanced/approval-gate.md).

### Semantic Search with Real Embeddings

**Default (TF-IDF, no API key needed):**
```json
{ "schemaCache": { "path": "~/.cms-mcp/schema.db" } }
```

**OpenAI embeddings (true semantic similarity):**
```json
{
  "schemaCache": { "path": "~/.cms-mcp/schema.db" },
  "embedding": {
    "provider": "openai",
    "apiKey": "env:OPENAI_API_KEY",
    "model": "text-embedding-3-small"
  }
}
```

```
"Have I written about machine learning before? Link to it in this new article."
→ Found: Deep Learning Fundamentals (87% match), Neural Net Tutorial (73% match)
```

See [docs/advanced/vector-search.md](./docs/advanced/vector-search.md).

### Policy Engine

Enforce publishing standards with `cms-mcp.policies.json`:

```json
{
  "version": "1",
  "rules": [
    {
      "type": "required_fields",
      "fields": ["cover_image", "seo_title", "seo_description"],
      "tools": ["publish_posts"]
    },
    {
      "type": "forbidden_words",
      "fields": ["title", "body"],
      "words": ["TODO", "lorem ipsum"],
      "tools": ["create_posts", "update_posts", "publish_posts"]
    },
    {
      "type": "min_tags",
      "min": 2,
      "tools": ["publish_posts"]
    }
  ]
}
```

All 10 rule types: `required_fields`, `min_tags`, `max_tags`, `min_length`, `max_length`, `forbidden_words`, `require_cover_image`, `seo_required`, `regex_match`, `status_transition`

Generate a starter file: `"Initialize policies for my CMS"`

See [docs/advanced/policy-engine.md](./docs/advanced/policy-engine.md).

### OpenAPI Auto-Discovery

On startup, cms-mcp scans your API for Swagger/OpenAPI specs and suggests endpoint config:
```
"Discover what APIs are available"
"Apply the discovered endpoints to my config"
```
Disable: `--no-discover`. Override URL: `openapi.discoveryUrl` in config.

### GitHub Webhook Mode

Auto-create shadow draft projects on every push:
```bash
npx cms-mcp --config ./config.json --webhook
```

### Circuit Breaker

Serves cached responses when your API goes down:
```
CLOSED → (5 failures) → OPEN → (30s) → HALF-OPEN → test → CLOSED
```

---

## Security

| Protection | Detail |
|-----------|--------|
| **SSRF** | Blocks private IPs (RFC 1918), loopback, link-local, AWS metadata, IPv6 ULA, non-HTTP schemes |
| **No redirect following** | `redirect: "error"` on all fetch calls — prevents auth header leakage |
| **Timeouts** | 30s `AbortController` on every outbound request |
| **Media cap** | 50 MB upload limit — prevents memory exhaustion |
| **Secret redaction** | Recursive regex-based redaction of all secret field names in audit logs |
| **Input validation** | Zod shapes built from live schema — every tool input validated at runtime |
| **Confirm guards** | All destructive operations require `confirm: true` |
| **Approval gate** | Human-in-the-loop click required before write executes |
| **Webhook HMAC** | Constant-time SHA-256 signature verification |
| **Payload limits** | 5 MB webhook body cap |
| **Read-only mode** | `--readonly` disables all writes |

See [docs/security.md](./docs/security.md) · [SECURITY.md](./SECURITY.md) to report vulnerabilities.

---

## Testing

```bash
npm test
```

**78 tests, 6 suites, Node native test runner:**

| Suite | Tests | Coverage |
|-------|-------|---------|
| Policy Engine | 15 | All 10 rule types, tool scoping, multi-rule violations |
| Content Distiller | 14 | HTML→Markdown, field stripping, metadata headers, pipeline |
| Circuit Breaker | 10 | Full lifecycle, cached fallback, reset, status |
| Vector Cache | 10 | Store, async search, TF-IDF, custom embedFn, type filter, clear |
| OpenAPI | 6 | Formatting, empty resources, missing fields |
| Security | 23 | SSRF (15 URL patterns), null bytes, long URLs, auth URLs |

No Jest, Mocha, or Vitest — uses Node.js native `--test`.

---

## Docker

```bash
# Build and run
docker build -t cms-mcp .
docker run -v $(pwd)/cms-mcp.config.json:/app/config.json \
  -e CMS_API_TOKEN=your-token \
  cms-mcp --config /app/config.json

# Or with compose
docker compose up
```

Multi-stage build — compiled JS + production deps only (~80MB image).

---

## Current Limitations

| Limitation | Detail | Workaround |
|-----------|--------|------------|
| **Tool shapes are fixed at connect time** | MCP tool schemas are registered during the handshake — schema changes require a server restart | Run `refresh_resource_schema` to update the SQLite cache, then restart |
| **PATCH only for updates** | `update_X` always sends `PATCH`. APIs that require `PUT` will reject it | Map the endpoint to a custom wrapper that converts PATCH→PUT |
| **No nested/relational writes** | Create tools only write top-level fields — no deep nested objects or join-table writes | Post top-level records, then use secondary tools for relations |
| **Sampling misses rare fields** | Tier-3 sampling fetches 5 records — optional fields absent in all 5 are not included | Use OpenAPI spec (Tier 2) or add `discover_api` + `refresh_resource_schema` after adding records |
| **OpenAPI YAML not parsed** | YAML specs are detected but not parsed — only JSON specs are used | Convert your spec to JSON (`swagger-cli bundle --type json`) or set `openapi.discoveryUrl` to the JSON endpoint |
| **No pagination abstraction** | `list_X` fetches a single page — no cursor iteration across all pages | Pass `limit`/`page` args manually; or sync all content with `sync_all_content` |
| **`media` key is reserved** | The key `"media"` always routes to the dedicated upload handler | Name your media endpoint `"media"` — it gets file upload tools automatically |
| **Single base URL** | All endpoints share one `baseUrl` + auth config | Run a second cms-mcp instance for a second API |
| **No GraphQL** | Only REST/JSON APIs are supported | Use a REST wrapper or Hasura REST endpoints in front of GraphQL |

---

## Migration from v0.3.x

### What changed

| v0.3.x | v0.4.0 |
|--------|--------|
| `list_projects`, `create_project`, etc. | `list_projects`, `create_projects` — key-based naming |
| `list_blogs`, `create_blog`, etc. | `list_blogs`, `create_blogs` — key-based naming |
| Fixed fields (hardcoded Zod schemas) | Dynamic fields (inferred from your live API) |
| `endpoints.projects` / `endpoints.blogs` only | Any endpoint key supported |
| Schema inspector output was markdown only | Machine-readable `ResourceSchema` + markdown report |

### Config change

Your existing config still works. The only change is `endpoints` now accepts any key:

```json
{
  "endpoints": {
    "projects": "/projects",
    "blogs":    "/posts",
    "media":    "/uploads"
  }
}
```

This generates tools: `list_projects`, `list_blogs`, etc. — same names as before, now schema-driven.

### Tool name change

| Old | New |
|-----|-----|
| `create_project` | `create_projects` |
| `update_project` | `update_projects` |
| `delete_project` | `delete_projects` |
| `publish_project` | Use `update_projects` with `status: "published"` |
| `create_blog` | `create_blogs` |
| `publish_blog` | Use `update_blogs` with `status: "published"` |
| `unpublish_blog` | Use `update_blogs` with `status: "draft"` |

If you want the old singular names, set your endpoint key to the singular form:
```json
{ "endpoints": { "project": "/projects", "blog": "/posts" } }
```

This generates `list_project`, `create_project`, etc.

### Approval gate tool names

If you had `"tools": ["publish_project", "delete_blog"]` in your `approvals` config, update them to match the new tool names (`delete_projects`, `delete_blogs`, etc.).

---

## Documentation

| | |
|-|-|
| [Getting Started](./docs/getting-started.md) | Install, configure, first conversation |
| [Configuration](./docs/configuration.md) | Full config schema reference |
| [Generic Resource Tools](./docs/tools/generic-resource.md) | How schema-driven tools work |
| [Media Tools](./docs/tools/media.md) | Upload, list, delete |
| [GitHub Tools](./docs/tools/github.md) | Scan, sync, list repos |
| [Introspection Tools](./docs/tools/introspection.md) | Schema inspect, refresh, cache |
| [Approval Gate](./docs/advanced/approval-gate.md) | Human-in-the-loop setup |
| [OpenAI Embeddings](./docs/advanced/vector-search.md) | Semantic search setup |
| [Schema Inspector](./docs/advanced/openapi-discovery.md) | Auto-schema detection |
| [Policy Engine](./docs/advanced/policy-engine.md) | Publishing standards |
| [Webhook Mode](./docs/advanced/webhook-mode.md) | GitHub push → drafts |
| [Circuit Breaker](./docs/advanced/circuit-breaker.md) | API failure handling |
| [Content Distillation](./docs/advanced/content-distillation.md) | HTML→Markdown |
| [Security Guide](./docs/security.md) | Operator reference |
| [Migration Guide](./docs/migration-v0.4.md) | Upgrading from v0.3.x |

---

## CMSes confirmed working

| CMS | Auth type | Notes |
|-----|-----------|-------|
| **Supabase** (PostgREST) | `bearer` or `api-key` | Use `apikey` header for anon key |
| **PocketBase** | `bearer` | Token from `/api/collections/users/auth-with-password` |
| **Payload CMS** | `bearer` | Token from `/api/users/login` |
| **Directus** | `bearer` | Static token from user settings |
| **Strapi** | `bearer` | Token from API Token settings |
| **Custom Next.js API** | `bearer` or `none` | Your middleware handles auth |

Any REST JSON API works out of the box. See [`examples/`](./examples/) for ready-made config files.

---

## API response shapes

These list response shapes are all normalized automatically:

```json
[{...}]                  // raw array
{ "data": [...] }        // data wrapper
{ "items": [...] }       // items wrapper
{ "results": [...] }     // results wrapper
{ "records": [...] }     // records wrapper
{ "entries": [...] }     // entries (Contentful)
{ "nodes": [...] }       // nodes (GraphQL-style)
{ "collection": [...] }  // collection wrapper
{ "posts": [...] }       // named wrapper (any key containing an array)
```

---

## Contributing

Issues, PRs, and CMS adapter examples welcome.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev workflow.

**Good first contributions:**
- Add a CMS config to `examples/` (Directus, Strapi, Payload, etc.)
- Add `PUT` support alongside `PATCH` for APIs that require it
- Write tests for the generic introspection pipeline
- Add a new policy rule type

---

## License

MIT — see [LICENSE](./LICENSE).

---

<div align="center">
  <sub>Built for the <a href="https://modelcontextprotocol.io">Model Context Protocol</a> ecosystem</sub>
</div>
