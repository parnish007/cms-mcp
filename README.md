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

</div>

---

```
You: "Scan my latest GitHub repo and publish it as a portfolio project"
Claude: Done — scanned, policy-checked, diff shown, awaiting your approval...
[You click Approve in browser]
Claude: Published. ✅

You: "Have I written about LSTMs before? If so, link to that post in this new article."
Claude: Yes — found "Deep Learning Fundamentals" (87% match). Linking now.

You: "Inspect the schema of my blogs endpoint"
Claude: Found 14 fields — title (string), body (string), status (enum: draft|published),
        slug (slug), cover_image (url?), tags (array), published_at (date?)...
```

Works with **any REST API** — Supabase, PocketBase, Payload CMS, Directus, Strapi, custom Next.js/Express/FastAPI routes, or any backend that speaks JSON over HTTP.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Tools Reference](#tools-reference)
- [Advanced Features](#advanced-features)
- [Adapting to Your CMS](#adapting-to-your-cms)
- [Adding Custom Tools](#adding-custom-tools)
- [Security](#security)
- [Testing](#testing)
- [Docker](#docker)
- [Contributing](#contributing)

---

## Features

| Feature | What it does |
|---------|-------------|
| **32 MCP tools** | Projects, blogs, media, GitHub, semantic search, API introspection, schema inspection |
| **MCP Resources** | `cms://projects/{id}`, `cms://blogs/{id}` — Claude reads content directly |
| **Zod validation firewall** | Every tool input validated before any network call |
| **Atomic transactions + rollback** | Failed writes auto-revert — no half-created records |
| **Diff preview before writes** | Field-level change table before anything hits your API |
| **Policy engine** | 10 rule types enforce publishing standards across teams |
| **🆕 Human approval gate** | Local dashboard — Claude pauses, you click Approve/Reject |
| **🆕 OpenAI semantic search** | Real embeddings (text-embedding-3-small) or local TF-IDF |
| **🆕 Auto-schema inspector** | Fetches live records and infers your CMS field types |
| **OpenAPI auto-discovery** | Scans your API for a Swagger/OpenAPI spec on startup |
| **Circuit breaker** | Serves cached responses when your CMS API goes down |
| **Content distillation** | HTML→Markdown, junk field stripping, metadata headers |
| **GitHub webhook mode** | Auto-creates draft entries when you push to a repo |
| **Schema cache** | SQLite-backed OpenAPI spec cache with TTL invalidation |
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
    "projects": "/projects",
    "blogs":    "/posts",
    "media":    "/uploads"
  }
}
```

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
"List my draft blog posts"
"Inspect the schema of my projects endpoint"
"Create a project called Dashboard — show diff first"
"Search my content for anything about machine learning"
"Check if post 42 passes publishing policies"
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
    "projects": "/projects",
    "blogs":    "/posts",
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
    "tools":     ["publish_project", "publish_blog", "delete_project", "delete_blog"]
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

## Tools Reference

### Projects (8 tools)
`list_projects` · `get_project` · `preview_create_project` · `create_project` · `preview_update_project` · `update_project` · `publish_project` · `delete_project`

**Fields:** `title`, `summary`, `description`, `slug`, `tech_stack`, `live_url`, `repo_url`, `cover_image`, `tags`, `status`, `is_featured`, `seo_title`, `seo_description`

### Blogs (9 tools)
`list_blogs` · `get_blog` · `preview_create_blog` · `create_blog` · `preview_update_blog` · `update_blog` · `publish_blog` · `unpublish_blog` · `delete_blog`

**Fields:** `title`, `body`, `excerpt`, `slug`, `cover_image`, `tags`, `status`, `published_at`, `reading_time`, `seo_title`, `seo_description`

### Media (3 tools)
`upload_media_from_url` · `list_media` · `delete_media`

### GitHub (3 tools)
`scan_repo` · `sync_repo_to_project` · `list_repos`

### Introspection (7 tools)
`discover_api` · `apply_discovered_endpoints` · `check_policies` · `init_policies` · `cache_stats` · `clear_cache` · **`inspect_endpoint_schema`**

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

### Human Approval Gate 🆕

The killer enterprise feature. When enabled, every write operation pauses and waits for a human to approve in a local browser UI — no code changes required.

**Enable:**
```bash
npx cms-mcp --config ./config.json --approval
```

Or in config:
```json
{
  "approvals": {
    "port": 2323,
    "tools": ["publish_project", "publish_blog", "delete_project", "delete_blog"]
  }
}
```

**Flow:**
1. Claude calls `publish_project`
2. cms-mcp prints: `Approval required — open http://localhost:2323`
3. Browser shows the diff preview with Approve / Reject buttons
4. You click Approve → write executes
5. You click Reject → Claude is told the operation was rejected

The dashboard uses Server-Sent Events for real-time updates. Multiple pending approvals stack as cards. Auto-rejects after 5 minutes (configurable with `timeoutMs`).

See [docs/advanced/approval-gate.md](./docs/advanced/approval-gate.md).

### Semantic Search with Real Embeddings 🆕

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

With OpenAI embeddings, searching for "LSTM" finds posts about "neural networks" and "deep learning" — real semantic understanding, not keyword matching.

```
"Have I written about machine learning before? Link to it in this new article."
→ Found: Deep Learning Fundamentals (87% match), Neural Net Tutorial (73% match)
```

See [docs/advanced/vector-search.md](./docs/advanced/vector-search.md).

### Auto-Schema Inspector 🆕

Fetches live records from any configured endpoint and infers the schema:

```
"Inspect the schema of my projects endpoint"
```

Output:
```
## Schema: /api/projects

Sampled 5 records — 12 fields detected

| Field        | Type                    | Required | Example          |
|--------------|-------------------------|----------|------------------|
| id           | uuid                    | ✓        | "abc123-..."     |
| title        | string                  | ✓        | "My Project"     |
| status       | enum(draft|published)   | ✓        | "draft"          |
| slug         | slug                    | ✓        | "my-project"     |
| cover_image  | url?                    | —        | "https://cdn..." |
| tags         | array                   | —        | ["react", "ts"]  |
| published_at | date?                   | —        | "2024-01-15T..." |
```

Now Claude knows exactly what fields exist and what values they accept.

### Policy Engine

Enforce publishing standards with `cms-mcp.policies.json`:

```json
{
  "version": "1",
  "rules": [
    {
      "type": "required_fields",
      "fields": ["cover_image", "seo_title", "seo_description"],
      "tools": ["publish_blog", "publish_project"]
    },
    {
      "type": "forbidden_words",
      "fields": ["title", "body"],
      "words": ["TODO", "lorem ipsum", "placeholder"],
      "tools": ["create_blog", "update_blog", "publish_blog"]
    },
    {
      "type": "min_tags",
      "min": 2,
      "tools": ["publish_project", "publish_blog"]
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

## Adapting to Your CMS

cms-mcp works with **any REST API** out of the box.

### API response shapes

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
{ "posts": [...] }       // named wrapper
{ "articles": [...] }    // named wrapper
{ "projects": [...] }    // named wrapper
```

### Field names

The tools use standard conventions. Most CMSes match these out of the box:

| Tool field | Common API equivalents |
|-----------|------------------------|
| `title` | `title`, `name` |
| `body` | `body`, `content`, `description` |
| `slug` | `slug`, `handle`, `url_key` |
| `status` | `status`, `state` |
| `tags` | `tags`, `labels`, `categories` |
| `cover_image` | `cover_image`, `coverImage`, `thumbnail`, `featured_image` |

If your API uses different field names, either map at the API layer or contribute a field adapter.

### Status values

Default status enums: projects use `draft | published | archived`, blogs use `draft | published`. To change them, edit the Zod enum in `src/tools/projects.ts` or `src/tools/blogs.ts`.

### CMSes confirmed working

| CMS | Auth type | Notes |
|-----|-----------|-------|
| **Supabase** (PostgREST) | `bearer` or `api-key` | Use `apikey` header for anon key |
| **PocketBase** | `bearer` | Auth token from `/api/collections/users/auth-with-password` |
| **Payload CMS** | `bearer` | Token from `/api/users/login` |
| **Directus** | `bearer` | Static token from user settings |
| **Strapi** | `bearer` | Token from API Token settings |
| **Custom Next.js API** | `bearer` or `none` | Your middleware handles auth |

See [`examples/`](./examples/) for ready-made config files.

---

## Adding Custom Tools

Every cms-mcp tool follows the same 20-line pattern. Adding a new resource type takes about 5 minutes.

### Example: `list_tags` tool

**1. Add endpoint to config:**
```json
{ "endpoints": { "tags": "/tags" } }
```

**2. Add to `EndpointsSchema` in `src/lib/config.ts`** (already there — just set it in config).

**3. Create `src/tools/tags.ts`:**

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import { AuditLogger, withAudit } from "../lib/audit.js";

export function registerTagTools(server: McpServer, config: Config, audit: AuditLogger): void {
  const endpoint = config.endpoints.tags;
  if (!endpoint) return;

  const client = new ApiClient(config);

  server.tool(
    "list_tags",
    { limit: z.number().int().min(1).max(100).default(50) },
    async (args) => {
      return withAudit(audit, "list_tags", args, async () => {
        const data = await client.get<unknown>(endpoint, { limit: args.limit });
        const items = Array.isArray(data) ? data : (data as any).items ?? [];
        return {
          content: [{ type: "text" as const, text: `Tags: ${items.map((t: any) => t.name).join(", ")}` }],
        };
      });
    },
  );
}
```

**4. Register in `src/index.ts`:**
```typescript
import { registerTagTools } from "./tools/tags.js";
// Inside main():
registerTagTools(server, config, audit);
```

**5. Build:**
```bash
npm run build
```

### Write tool pattern (with approval gate)

```typescript
server.tool("create_thing", { ...Schema.shape, confirm: z.literal(true) }, async (args) => {
  if (config.readOnly) return readOnlyBlock("create_thing");

  return withAudit(audit, "create_thing", args, async () => {
    const parsed = Schema.safeParse(args);
    if (!parsed.success) return validationError(parsed.error);

    // Show diff preview
    const preview = buildCreatePreview(parsed.data);

    // Gate check — pauses if approval gate is enabled
    const blocked = await checkGate(gate, "create_thing", args, preview, config.approvals?.tools);
    if (blocked) return blocked;

    // Execute
    const result = await client.post(endpoint, parsed.data);
    return { content: [{ type: "text", text: `✅ Created: ${result.id}` }] };
  });
});
```

`withAudit` handles timing and error logging. `checkGate` handles human approval if configured. Both are no-ops when not enabled.

---

## Security

| Protection | Detail |
|-----------|--------|
| **SSRF** | Blocks private IPs (RFC 1918), loopback, link-local, AWS metadata, IPv6 ULA, non-HTTP schemes |
| **No redirect following** | `redirect: "error"` on all fetch calls — prevents auth header leakage |
| **Timeouts** | 30s `AbortController` on every outbound request |
| **Media cap** | 50 MB upload limit — prevents memory exhaustion |
| **Secret redaction** | Recursive regex-based redaction of all secret field names in audit logs |
| **Input validation** | Zod schemas on every tool, GitHub names validated against character allowlists |
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

## Documentation

| | |
|-|-|
| [Getting Started](./docs/getting-started.md) | Install, configure, first conversation |
| [Configuration](./docs/configuration.md) | Full config schema reference |
| [Project Tools](./docs/tools/projects.md) | All 8 project tools with examples |
| [Blog Tools](./docs/tools/blogs.md) | All 9 blog tools with examples |
| [Media Tools](./docs/tools/media.md) | Upload, list, delete |
| [GitHub Tools](./docs/tools/github.md) | Scan, sync, list repos |
| [Approval Gate](./docs/advanced/approval-gate.md) | Human-in-the-loop setup |
| [OpenAI Embeddings](./docs/advanced/vector-search.md) | Semantic search setup |
| [Schema Inspector](./docs/advanced/openapi-discovery.md) | Auto-schema detection |
| [Policy Engine](./docs/advanced/policy-engine.md) | Publishing standards |
| [Webhook Mode](./docs/advanced/webhook-mode.md) | GitHub push → drafts |
| [Circuit Breaker](./docs/advanced/circuit-breaker.md) | API failure handling |
| [Content Distillation](./docs/advanced/content-distillation.md) | HTML→Markdown |
| [Security Guide](./docs/security.md) | Operator reference |
| [Roadmap](./docs/roadmap.md) | What's next |

---

## Contributing

Issues, PRs, and CMS adapter examples welcome.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the dev workflow.

**Good first contributions:**
- Add a CMS config to `examples/` (Directus, Strapi, Payload, etc.)
- Add `PUT` support alongside `PATCH` for APIs that require it
- Write tests for an edge case you find
- Add a new policy rule type

---

## License

MIT — see [LICENSE](./LICENSE).

---

<div align="center">
  <sub>Built for the <a href="https://modelcontextprotocol.io">Model Context Protocol</a> ecosystem</sub>
</div>
