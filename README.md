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

**v1.0.0: 5 tools per endpoint (`list_X`, `get_X`, `create_X`, `update_X`, `delete_X`) — auto-generated from OpenAPI spec or 20-record live schema introspection, with CMSAdapter field mapping, SecretManager, CompensatingTransaction rollback, SSRF v2 port whitelist, and a full interactive `init` wizard.**

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

cms-mcp is a schema-aware bridge: it reads your API's shape at startup, builds typed MCP tools from that shape, and registers them before Claude connects.

### Schema resolution (4-tier priority chain)

| Tier | Source | Speed | When used |
|------|--------|-------|-----------|
| **1 — Cache** | SQLite | Instant | Previous run cached a schema — no API calls |
| **2 — OpenAPI** | JSON/YAML spec | ~200ms | `openapi.autoDiscover: true` or `discoveryUrl` set — authoritative |
| **3 — Sampling** | Live records | ~500ms | No spec available — fetches **20 records**, merges fields, infers types |
| **4 — Cold-start** | None | Instant | Zero records + no spec — passthrough tools, still writable |

**Why OpenAPI first?** Sampling records misses optional fields and fails on empty endpoints. An OpenAPI spec declares every field, format, required status, and enum value explicitly — zero false positives. If your API has a spec (JSON or YAML), cms-mcp uses it.

**v1.0.0 schema merging:** When sampling, all fields across all 20 records are collected as a union. Fields absent in even one record are flagged `inconsistent: true` and always use `.optional()` in generated Zod shapes — no more false "required" errors on optional fields.

### What gets registered per endpoint

For each key in `config.endpoints` (except `media`), exactly **5 tools** are registered (default):

| Tool | What it does |
|------|-------------|
| `list_X` | Filter, paginate, full-text search. Enum fields become optional filter params. |
| `get_X` | Fetch single record by ID. |
| `create_X` | Create new record. `preview: true` shows field table without writing. |
| `update_X` | Update existing record by `id`. `preview: true` shows diff. |
| `delete_X` | Delete record by `id`. Requires `confirm: true`. |

Set `legacyMode: true` in config to register the v0.5 `mutate_X` combined tool instead.

Foreign-key fields (e.g. `author_id`) are auto-detected and surfaced as relation hints in tool descriptions: `author_id → get_authors`.

All schemas are cached in SQLite — next startup hits Tier 1 instantly.

---

## Features

### Core (always on)

| Feature | What it does |
|---------|-------------|
| **5 tools per endpoint** | `list_X`, `get_X`, `create_X`, `update_X`, `delete_X` — clean, granular tool surface |
| **`legacyMode`** | `legacyMode: true` keeps v0.5 `mutate_X` combined tool for backward compat |
| **OpenAPI-first schema** | 4-tier: cache → OpenAPI (JSON/YAML) → sampling → cold-start passthrough |
| **20-record schema merging** | Samples 20 records, merges fields; fields absent in any record marked `.optional()` |
| **CMSAdapter field mapping** | `adapters.X.fieldMap` translates internal→external field names bidirectionally |
| **PATCH / PUT toggle** | `adapters.X.updateMethod: "PUT"` for APIs requiring full-replacement semantics |
| **SecretManager** | Secrets tokenized after `loadConfig()` — Config object never holds plain-text credentials |
| **CompensatingTransaction** | Honest rollback — `CriticalInconsistencyError` surfaces orphaned IDs for manual cleanup |
| **Any endpoint key** | `"products"`, `"authors"`, `"events"` — any name, any REST endpoint |
| **Relation hints** | FK fields (`author_id`) linked to matching endpoints in tool descriptions |
| **Zod validation firewall** | Dynamic Zod shapes built at startup — MCP SDK validates before handlers run |
| **Diff preview** | `create_X({ preview: true })` / `update_X({ preview: true })` — change table, no API call |
| **Cold-start passthrough** | Empty endpoints get tools immediately — no startup failure |
| **Schema cache** | SQLite-backed TTL cache — instant restarts after first run |
| **Audit logging** | Every call: tool name, args (secrets redacted), outcome, duration |
| **Read-only mode** | `--readonly` disables all write tools |
| **SSRF v2** | Private IPs, cloud metadata (`169.254.169.254`), port whitelist, null-byte blocking |
| **`npx cms-mcp init`** | Full interactive wizard — HEAD probes, CMS detection, auth/endpoint/feature prompts |

### Optional plugins (registered only when config block is present)

| Plugin | Config block | What it adds |
|--------|-------------|--------------|
| **Approval gate** | `"approvals": {...}` | Human click required before any write executes |
| **Policy engine** | `"policies": "..."` | Auto-enforced on every write; `check_policies`, `init_policies` always available |
| **Semantic search** | `"schemaCache"` + `"embedding"` | `sync_all_content`, `semantic_search`, `knowledge_status` |
| **GitHub** | `"github": {...}` + `GITHUB_TOKEN` env var | `scan_repo`, `sync_repo_to_project`, `list_repos` — **omit the block entirely if not using; adding block without env var crashes the server** |
| **Webhook** | `--webhook` + `"webhook": {...}` | Auto-draft on GitHub push |
| **Circuit breaker** | always active | Cached fallback when CMS API goes down |
| **Content distillation** | always active | HTML→Markdown for MCP Resources |

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

Any key works. At startup, cms-mcp generates `list_posts`, `get_posts`, `create_posts`, `update_posts`, `delete_posts`, `list_products`, `get_products`, `create_products`, etc. — schemas built from your API's actual fields.

Or skip the manual config and let `init` detect your CMS:

```bash
npx cms-mcp init --base-url https://your-api.com/api
```

**2. Get your API token and set it as an environment variable:**

`CMS_API_TOKEN` is an API token issued by your CMS. Where to get it:

| CMS | Where |
|-----|-------|
| Supabase | Project Settings → API → `anon` or `service_role` key |
| Strapi | Settings → API Tokens → Create new API Token |
| Directus | Settings → Access Tokens → Create Token |
| PocketBase | POST `/api/collections/users/auth-with-password` → `token` field |
| Payload CMS | Admin → Users → your user → API Key |
| Custom backend | Whatever your backend requires |

Full instructions for every platform: **[docs/env-vars.md](./docs/env-vars.md)**

```bash
export CMS_API_TOKEN=your-token-here
# or set it in the Claude Desktop/Code env block (recommended)
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
    "tools":     ["delete_posts", "delete_products"]
  },

  "adapters": {
    "posts": {
      "updateMethod": "PUT",
      "fieldMap": {
        "title": "post_heading_1",
        "body":  "post_content_markdown"
      }
    }
  },

  "legacyMode":   false,
  "allowedPorts": [3000, 8080],

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

### CLI commands

```bash
npx cms-mcp init --base-url <url>   # Detect CMS and write starter config
npx cms-mcp --config <path>         # Start MCP server
```

### CLI flags

| Flag | Description |
|------|-------------|
| `--config <path>`, `-c` | Config file path |
| `--base-url <url>`, `-u` | Base URL (used with `init`) |
| `--readonly` | Disable all write tools |
| `--approval` | Enable approval gate even without `approvals` config block |
| `--webhook` | Start GitHub webhook listener |
| `--no-discover` | Skip OpenAPI auto-discovery |

---

## Generic Tool System

### The 5-tool model (v1.0.0 default)

For every key in `config.endpoints` (except `media`), exactly 5 tools are registered:

#### `list_X`
Params: `limit` (default 20), `search` (full-text), plus one optional filter per `enum(...)` field.

```
"List my published posts"        → list_posts({ status: "published", limit: 20 })
"Find products mentioning 'pro'" → list_products({ search: "pro" })
```

#### `get_X`
Params: `id` (required). Returns the full record as JSON.

#### `create_X`
Creates a new record. Pass `preview: true` to see a field table without writing.

```
"Preview creating a post titled Hello World"
→ create_posts({ title: "Hello World", status: "draft", preview: true })

"Create it"
→ create_posts({ title: "Hello World", status: "draft", confirm: true })
```

#### `update_X`
Updates an existing record. Pass `preview: true` (or omit `confirm`) to see a diff first.

```
"Update post 42 — set status to published"
→ update_posts({ id: "42", status: "published", confirm: true })
```

#### `delete_X`
Deletes a record. Always requires `confirm: true` — shows a warning preview otherwise.

```
"Delete post 42"
→ delete_posts({ id: "42", confirm: true })
```

### Legacy mode (v0.5 compatibility)

Set `legacyMode: true` in config to revert to the v0.5 `mutate_X` combined tool:

```json
{ "legacyMode": true }
```

```
→ mutate_posts({ action: "create", data: { title: "Hello World" }, confirm: true })
→ mutate_posts({ action: "delete", id: "42", confirm: true })
```

Useful if you have saved Claude prompts or MCP clients that reference `mutate_X` by name.

### Schema → Zod type mapping

| OpenAPI / inferred type | Zod validator |
|------------------------|---------------|
| `string` / `format: uuid` | `z.string().uuid()` |
| `string` / `format: date-time` | `z.string().datetime()` |
| `string` / `format: uri` | `z.string().url()` |
| `string` / `format: email` | `z.string().email()` |
| `enum: ["a","b","c"]` | `z.enum(["a","b","c"])` |
| `string` | `z.string()` |
| `integer` / `number` | `z.number()` |
| `boolean` | `z.boolean()` |
| `array` | `z.array(z.unknown())` |
| `object` | `z.record(z.unknown())` |
| `nullable: true` or `type: ["T","null"]` | base type `.nullable()` |
| `readOnly: true` (OpenAPI only) | excluded from create/update inputs |

### Relation hints

Fields matching `*_id` / `*_ids` / `*Id` / `*Ids` patterns are cross-referenced against configured endpoint keys. When a match is found, a hint appears in the tool description:

```
list_posts — ... Relations: author_id → get_authors | tag_ids[] → list_tags
```

Claude uses this to know which tool to call when resolving related records.

### CMSAdapter — field mapping and HTTP method override

Some CMS APIs use field names like `post_heading_1` that differ from what Claude sees (`title`). The `adapters` config block handles this bidirectionally:

```json
{
  "adapters": {
    "posts": {
      "updateMethod": "PUT",
      "fieldMap": {
        "title":  "post_heading_1",
        "body":   "post_content_markdown",
        "status": "publication_state"
      }
    }
  }
}
```

- **`fieldMap`** — Claude uses the left-hand names; the API receives the right-hand names. Responses are reverse-mapped before returning to Claude.
- **`updateMethod`** — `"PATCH"` (default) or `"PUT"`. Use `"PUT"` for APIs that require the full record on update.

### Cold-start mode

Zero records + no OpenAPI spec → tools registered in passthrough mode. `create_X` / `update_X` accept any key-value `fields` object — pass anything.

**Graduating from cold-start:**
1. Create one record in your CMS
2. Ask Claude: `"Refresh the schema for X"` → `refresh_resource_schema`
3. Restart cms-mcp — typed `create_X`/`update_X` tools appear

### Schema refresh workflow

```
discover_api                             ← re-fetch OpenAPI spec into cache
refresh_resource_schema({ resource_key: "posts", confirm: true })
[restart cms-mcp]                        ← tool shapes update
```

---

## Tools Reference

### Per-endpoint tools (× number of configured endpoints, except `media`)

| Tool | Params | Notes |
|------|--------|-------|
| `list_X` | `limit`, `search`, enum filters | |
| `get_X` | `id` | |
| `create_X` | typed fields from schema, `preview?`, `confirm?` | `preview: true` shows table, no write |
| `update_X` | `id` + typed fields, `preview?`, `confirm?` | Shows diff if no `confirm` |
| `delete_X` | `id`, `confirm?` | Shows warning if no `confirm` |

**Legacy mode** (`legacyMode: true`): registers `mutate_X` instead of the three write tools above.

### Media (always, if `"media"` key configured)
`upload_media_from_url` · `list_media` · `delete_media`

The `media` key is reserved for these dedicated tools (multipart upload, SSRF-hardened proxy, 50MB cap).

### Introspection (always)
`discover_api` · `apply_discovered_endpoints` · `inspect_endpoint_schema` · `refresh_resource_schema` · `list_configured_endpoints` · `cache_stats` · `clear_cache`

### Policy tools (always available)
`check_policies` · `init_policies`

Always registered. Without `"policies"` in config, they respond with a helpful setup message. With `"policies"` set, they use the loaded rules — and those same rules **auto-enforce** on every `create_X`, `update_X`, and `delete_X` call.

### Optional plugin tools

| Plugin | Tools registered |
|--------|-----------------|
| Search (`"schemaCache"`) | `semantic_search` · `sync_all_content` · `knowledge_status` |
| GitHub (`"github"`) | `scan_repo` · `sync_repo_to_project` · `list_repos` |

### MCP Resources
One resource pair per configured endpoint:
```
cms://posts          → List all posts
cms://posts/{id}     → Single post (HTML distilled to Markdown)
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
    "tools": ["delete_posts", "delete_products", "create_posts"]
  }
}
```

**Flow:**
1. Claude calls `delete_posts({ id: "42", confirm: true })`
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

Enforce publishing standards with `cms-mcp.policies.json`. Policies are **automatically enforced** on every `create_X`, `update_X`, and `delete_X` call — no manual `check_policies` step needed.

```json
{
  "version": "1",
  "rules": [
    {
      "type": "required_fields",
      "fields": ["cover_image", "seo_title", "seo_description"],
      "tools": ["update_posts", "update_projects"]
    },
    {
      "type": "forbidden_words",
      "field": "body",
      "words": ["TODO", "lorem ipsum"],
      "tools": ["create_posts", "update_posts"]
    },
    {
      "type": "min_tags",
      "min": 2,
      "tools": ["create_projects", "update_projects"]
    }
  ]
}
```

Rule `tools` arrays accept v1.0.0 names (`create_X`, `update_X`, `delete_X`) **or** legacy names (`mutate_X`) — they match interchangeably. Rules without a `tools` array apply to all write tools.

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
| **SSRF v2** | Blocks private IPs (RFC 1918), loopback, AWS/GCP/Azure metadata (`169.254.169.254`), IPv6 ULA, non-HTTP schemes, null bytes |
| **Port whitelist** | Only ports 80 and 443 allowed by default; add others via `allowedPorts: [3000, 8080]` |
| **SecretManager** | Secrets tokenized after `loadConfig()` — plain-text credentials are never held in the Config object; resolved only at the moment of the HTTP call |
| **No redirect following** | `redirect: "error"` on all fetch calls — prevents redirect-based SSRF and auth header leakage |
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

Multi-stage Alpine build (`node:22-alpine`) — compiled JS + production deps only (~45MB image). Uses `dumb-init` for proper PID 1 signal handling.

---

## Current Limitations

| Limitation | Detail | Workaround |
|-----------|--------|------------|
| **Tool shapes are fixed at connect time** | MCP tool schemas are registered during the handshake — schema changes require a server restart | Run `refresh_resource_schema` to update the SQLite cache, then restart |
| **No nested/relational writes** | Create tools only write top-level fields — no deep nested objects or join-table writes | Post top-level records, then use secondary tools for relations |
| **Sampling can miss rare fields** | Tier-3 samples 20 records — optional fields absent in all 20 are not included (though they'd be `inconsistent: true` if present in any) | Use OpenAPI spec (Tier 2) or `discover_api` + `refresh_resource_schema` |
| **CompensatingTransaction is not atomic** | REST APIs have no transaction primitive — rollback attempts individual DELETE/PATCH calls and may partially fail | On `CriticalInconsistencyError`, `orphanedIds` lists records that need manual cleanup |
| **No pagination abstraction** | `list_X` fetches a single page — no cursor iteration across all pages | Pass `limit`/`page` args manually; or sync all content with `sync_all_content` |
| **`media` key is reserved** | The key `"media"` always routes to the dedicated upload handler | Name your media endpoint `"media"` — it gets file upload tools automatically |
| **Single base URL** | All endpoints share one `baseUrl` + auth config | Run a second cms-mcp instance for a second API |
| **No GraphQL** | Only REST/JSON APIs are supported | Use a REST wrapper or Hasura REST endpoints in front of GraphQL |

---

## Migration

See [docs/migration-v1.0.md](./docs/migration-v1.0.md) for upgrading from v0.5 to v1.0.

See [docs/migration-v0.5.md](./docs/migration-v0.5.md) for upgrading from v0.4 to v0.5.

See [docs/migration-v0.4.md](./docs/migration-v0.4.md) for upgrading from v0.3.x to v0.4.

---

## Documentation

| | |
|-|-|
| [Getting Started](./docs/getting-started.md) | Install, configure, first conversation |
| [Environment Variables](./docs/env-vars.md) | What each env var is, how to get tokens from every CMS |
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
| [Migration v1.0](./docs/migration-v1.0.md) | Upgrading from v0.5 to v1.0 (split tools, CMSAdapter, SecretManager) |
| [Migration v0.5](./docs/migration-v0.5.md) | Upgrading from v0.4 to v0.5 |
| [Migration v0.4](./docs/migration-v0.4.md) | Upgrading from v0.3.x to v0.4 |

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
