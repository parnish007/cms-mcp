# cms-mcp

**A [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude control over any REST-based CMS.**

Write blog posts, manage projects, upload media, search content semantically, enforce publishing policies — all through natural language conversation with Claude.

```
You: "Scan my latest GitHub repo and publish it as a project entry"
Claude: Done — scanned, diffed, policy-checked, and published in 30 seconds.

You: "Find everything we wrote about machine learning"
Claude: Found 4 matches — FinTrack Dashboard (87%), Data Viz Deep Dive (62%)...

You: "Draft a blog post summarizing our Q4 release"
Claude: Here's the draft. Confirm to save, or tell me what to change.
```

Works with **any REST API** — Supabase, PocketBase, Payload CMS, Directus, Strapi, custom Next.js/Express/FastAPI routes, or any backend that speaks JSON over HTTP.

---

## Table of Contents

- [Why cms-mcp](#why-cms-mcp)
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

## Why cms-mcp

Most CMS integrations assume a human clicking through a dashboard. cms-mcp assumes an AI agent making API calls on your behalf — with all the safety rails that implies.

**Without cms-mcp:**
```
You ask Claude to update a blog post → Claude hallucinates an API shape →
Wrong fields sent → Partial write with missing data → Broken content
```

**With cms-mcp:**
```
You ask Claude to update a blog post →
Zod validates inputs → Diff shown for review → Atomic write with rollback →
Audit log entry → Success
```

---

## Features

| Feature | What it does |
|---------|-------------|
| **29 MCP tools** | Projects, blogs, media, GitHub, semantic search, API introspection |
| **MCP Resources** | `cms://projects/{id}`, `cms://blogs/{id}` — Claude reads content directly |
| **Zod validation firewall** | Every tool input validated before any network call |
| **Atomic transactions + rollback** | Failed writes auto-revert — no half-created records |
| **Diff preview before writes** | Claude shows a field-level change table before confirming |
| **Policy engine** | 10 rule types enforce publishing standards (required fields, SEO, no placeholder text, etc.) |
| **Semantic vector search** | TF-IDF local search — find content by meaning, not just keywords |
| **OpenAPI auto-discovery** | Scans your API for a Swagger/OpenAPI spec and suggests endpoint config |
| **Circuit breaker** | Serves cached responses when your CMS API goes down |
| **Content distillation** | HTML→Markdown, junk field stripping, metadata headers for clean LLM context |
| **GitHub webhook mode** | Auto-creates draft project entries when you push to a repo |
| **Schema cache** | SQLite-backed OpenAPI spec cache with TTL invalidation |
| **Audit logging** | Every tool call logged — tool name, args, outcome, duration, credentials redacted |
| **Read-only mode** | Disable all writes for exploratory or multi-agent sessions |
| **SSRF protection** | Blocks all private IPs, loopback, AWS metadata, non-HTTP schemes |
| **76 tests** | Unit tests across 6 suites — policy, security, vector cache, circuit breaker, distiller, OpenAPI |

---

## Installation

**npx (no install needed):**
```bash
npx cms-mcp --config ./cms-mcp.config.json
```

**npm global install:**
```bash
npm install -g cms-mcp
cms-mcp --config ./cms-mcp.config.json
```

**From source:**
```bash
git clone https://github.com/parnish007/cms-mcp
cd cms-mcp
npm install
npm run build
node build/index.js --config ./cms-mcp.config.json
```

**Docker:**
```bash
docker compose up
```

---

## Quick Start

### 1. Create a config file

`cms-mcp.config.json`:

```json
{
  "baseUrl": "https://your-api.com/api",
  "auth": {
    "type": "bearer",
    "token": "env:CMS_API_TOKEN"
  },
  "endpoints": {
    "projects": "/projects",
    "blogs": "/posts",
    "media": "/uploads"
  }
}
```

> **Tip:** Set `"type": "none"` if your API has no auth. All endpoints are optional — omit any you don't use.

### 2. Set environment variables

```bash
export CMS_API_TOKEN=your-token-here
```

Or pass them directly in the Claude Desktop config (see step 3).

### 3. Add to Claude Desktop

File: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
File: `%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "npx",
      "args": ["cms-mcp", "--config", "/absolute/path/to/cms-mcp.config.json"],
      "env": {
        "CMS_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### 4. Or add to Claude Code (CLI)

```bash
claude mcp add cms-mcp -- npx cms-mcp --config ./cms-mcp.config.json
```

### 5. Start talking

```
"List my draft blog posts"
"Create a new project called 'Analytics Dashboard' with status draft"
"Scan github.com/you/my-repo and create a portfolio entry"
"Search my content for anything about TypeScript"
"Check if project 42 passes publishing policies"
```

---

## Configuration

### Full config reference

```json
{
  "name": "My Portfolio Site",
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
    "defaultOwner": "your-github-username"
  },

  "readOnly": false,

  "auditLog": "~/.cms-mcp/audit.log",

  "policies": "./cms-mcp.policies.json",

  "schemaCache": {
    "path":       "~/.cms-mcp/schema-cache.db",
    "ttlMinutes": 60
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

| Type | Config example |
|------|----------------|
| Bearer token | `{ "type": "bearer", "token": "env:MY_TOKEN" }` |
| API key header | `{ "type": "api-key", "header": "X-API-Key", "token": "env:MY_KEY" }` |
| HTTP Basic | `{ "type": "basic", "username": "admin", "password": "env:MY_PASS" }` |
| No auth | `{ "type": "none" }` |

### Secret references

Any string prefixed with `env:` is resolved from the environment at startup:

```json
{ "token": "env:CMS_API_TOKEN" }
```

Secrets are **never** written to logs — only their redacted length is recorded.

### CLI flags

| Flag | Description |
|------|-------------|
| `--config <path>`, `-c <path>` | Config file path (default: auto-discovers `cms-mcp.config.json` in CWD or home dir) |
| `--readonly` | Disable all write tools |
| `--webhook` | Start GitHub webhook listener |
| `--no-discover` | Skip OpenAPI auto-discovery on startup |

---

## Tools Reference

### Projects (8 tools)

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects with optional status filter and search |
| `get_project` | Get a single project by ID or slug |
| `preview_create_project` | Preview what will be created (no API call) |
| `create_project` | Create a project (requires `confirm: true`) |
| `preview_update_project` | Preview changes vs current record |
| `update_project` | Update a project (requires `confirm: true`) |
| `publish_project` | Set status to `published` |
| `delete_project` | Delete a project (requires `confirm: true`, irreversible) |

**Project fields:** `title`, `summary`, `description`, `slug`, `tech_stack`, `live_url`, `repo_url`, `cover_image`, `tags`, `status`, `is_featured`, `seo_title`, `seo_description`

All fields except `title` are optional.

---

### Blogs (9 tools)

| Tool | Description |
|------|-------------|
| `list_blogs` | List all blog posts with optional status filter |
| `get_blog` | Get a single post by ID or slug |
| `preview_create_blog` | Preview what will be created |
| `create_blog` | Create a blog post (requires `confirm: true`) |
| `preview_update_blog` | Preview changes vs current record |
| `update_blog` | Update a blog post (requires `confirm: true`) |
| `publish_blog` | Set status to `published` and stamp `published_at` |
| `unpublish_blog` | Move back to `draft` status |
| `delete_blog` | Delete a post (requires `confirm: true`, irreversible) |

**Blog fields:** `title`, `body`, `excerpt`, `slug`, `cover_image`, `tags`, `status`, `published_at`, `reading_time`, `seo_title`, `seo_description`

---

### Media (3 tools)

| Tool | Description |
|------|-------------|
| `upload_media_from_url` | Fetch a public image URL and upload to your media endpoint as multipart binary |
| `list_media` | List uploaded media files |
| `delete_media` | Delete a media file |

Upload is SSRF-protected — no private IPs, loopback, or AWS metadata. MIME type detected from magic bytes, not the Content-Type header.

---

### GitHub (3 tools)

| Tool | Description |
|------|-------------|
| `scan_repo` | Scan a repo and extract title, description, tech stack, live URL, commits, README preview |
| `sync_repo_to_project` | One command: GitHub repo → project entry |
| `list_repos` | List repos for a user/org |

`scan_repo` detects 30+ technologies from README content, `package.json`, `requirements.txt`, and repo topics.

---

### Introspection (6 tools)

| Tool | Description |
|------|-------------|
| `discover_api` | Scan your API for OpenAPI/Swagger spec and suggest endpoint config |
| `apply_discovered_endpoints` | Apply suggested endpoints from `discover_api` |
| `check_policies` | Check a record against your `policies.json` rules |
| `init_policies` | Generate a starter `cms-mcp.policies.json` file |
| `cache_stats` | Show SQLite cache statistics |
| `clear_cache` | Clear the schema/OpenAPI cache |

---

### Search (3 tools)

| Tool | Description |
|------|-------------|
| `semantic_search` | Search indexed content by meaning using TF-IDF cosine similarity |
| `sync_all_content` | Pull all projects/blogs and index them in the vector cache |
| `knowledge_status` | Show vector cache stats and circuit breaker state |

---

### MCP Resources

Claude can read content directly as MCP Resources (no tool call needed):

```
cms://projects          → List all projects
cms://projects/{id}     → Read a specific project (HTML→Markdown, junk fields stripped)
cms://blogs             → List all blog posts
cms://blogs/{id}        → Read a specific blog post (distilled for LLM context)
```

---

## Advanced Features

### Semantic Search

```bash
# First, index your content
"Sync all my content for search"

# Then search by meaning
"What did we build for the fintech client?"
"Find all blog posts about CSS"
"Which projects use PostgreSQL?"
```

Scores: >80% strong match, 50–80% related, 20–50% tangential, <20% filtered out.

See [docs/advanced/vector-search.md](./docs/advanced/vector-search.md).

### Policy Engine

Create `cms-mcp.policies.json` to enforce publishing standards:

```json
{
  "version": "1",
  "rules": [
    {
      "type": "required_fields",
      "fields": ["title", "cover_image", "seo_title", "seo_description"],
      "tools": ["publish_blog", "publish_project"],
      "message": "Cover image and SEO fields are required before publishing"
    },
    {
      "type": "forbidden_words",
      "fields": ["title", "body", "description"],
      "words": ["TODO", "lorem ipsum", "placeholder", "test test"],
      "tools": ["create_blog", "update_blog", "publish_blog"]
    },
    {
      "type": "min_tags",
      "min": 2,
      "tools": ["publish_project", "publish_blog"]
    },
    {
      "type": "seo_required",
      "tools": ["publish_blog", "publish_project"]
    }
  ]
}
```

**All 10 rule types:** `required_fields`, `min_tags`, `max_tags`, `min_length`, `max_length`, `forbidden_words`, `require_cover_image`, `seo_required`, `regex_match`, `status_transition`

Generate a starter file:
```
"Initialize policies for my CMS"
```

See [docs/advanced/policy-engine.md](./docs/advanced/policy-engine.md).

### OpenAPI Auto-Discovery

On startup, cms-mcp tries 10 common OpenAPI spec paths. If found, it suggests endpoint config:

```
"Discover what APIs are available"
```

Disable with `--no-discover`. Override the discovery URL in config with `openapi.discoveryUrl`.

See [docs/advanced/openapi-discovery.md](./docs/advanced/openapi-discovery.md).

### GitHub Webhook Mode

Push to GitHub → auto-create a draft project entry:

```bash
npx cms-mcp --config ./config.json --webhook
```

Configure your GitHub repo to send webhooks to your server's URL. Secured with HMAC-SHA256 signature verification.

See [docs/advanced/webhook-mode.md](./docs/advanced/webhook-mode.md).

### Circuit Breaker

If your CMS API goes down, cms-mcp serves cached responses instead of errors:

```
CLOSED → (5 consecutive failures) → OPEN → (30s cooldown) → HALF-OPEN → test → CLOSED
```

Check status: `"Show knowledge status"`

See [docs/advanced/circuit-breaker.md](./docs/advanced/circuit-breaker.md).

---

## Adapting to Your CMS

cms-mcp is designed to work with **any REST API** out of the box. Here's how to adapt it:

### API response shapes

cms-mcp auto-normalizes these list response shapes:

```json
[{...}]                  // raw array
{ "data": [...] }        // data wrapper
{ "items": [...] }       // items wrapper
{ "results": [...] }     // results wrapper
{ "records": [...] }     // records wrapper
{ "entries": [...] }     // entries wrapper (Contentful, etc.)
{ "nodes": [...] }       // nodes wrapper (GraphQL-style)
{ "collection": [...] }  // collection wrapper
{ "posts": [...] }       // named wrapper (blogs)
{ "articles": [...] }    // named wrapper (blogs)
{ "projects": [...] }    // named wrapper (projects)
```

If your API uses a different wrapper key, open an issue or submit a PR to add it to `normalizeList()` in `src/tools/projects.ts` and `src/tools/blogs.ts`.

### Field names

The tools use standard REST field name conventions:

| Tool field | Expected by API |
|-----------|-----------------|
| `title` | `title` or `name` |
| `body` | `body`, `content`, or `description` |
| `slug` | `slug` |
| `status` | `status` |
| `tags` | `tags` |
| `cover_image` | `cover_image`, `coverImage`, or `thumbnail` |
| `published_at` | `published_at` or `publishedAt` |

If your API expects different field names (e.g., `name` instead of `title`, `content` instead of `body`), you have a few options:

1. **Map at the API layer** — use your CMS's middleware or a thin adapter to remap fields
2. **Contribute a custom tool** — see [Adding Custom Tools](#adding-custom-tools) below
3. **Use middleware endpoints** — point `endpoints.blogs` at a custom route that remaps fields before hitting your CMS

### Endpoint compatibility

Any CMS that supports these HTTP patterns works:

```
GET    /endpoint          → list records
GET    /endpoint/:id      → get single record
POST   /endpoint          → create record
PATCH  /endpoint/:id      → update record
DELETE /endpoint/:id      → delete record
```

Endpoints that use `PUT` instead of `PATCH` for updates — add a note in the issue tracker. This is a planned addition.

### Status values

The project tools use `draft`, `published`, and `archived`. Blog tools use `draft` and `published`. If your CMS uses different status values (e.g., `active`/`inactive`, `live`/`preview`), you can adapt the Zod enum in `src/tools/projects.ts`:

```typescript
status: z.enum(["draft", "published", "archived"]).default("draft"),
// → Change to match your CMS:
status: z.enum(["draft", "live", "archived"]).default("draft"),
```

### CMSes tested with

| CMS | Auth type | Notes |
|-----|-----------|-------|
| **Supabase** (PostgREST) | `bearer` or `api-key` | Use `apikey` header for anon key |
| **PocketBase** | `bearer` | Token from `/api/collections/users/auth-with-password` |
| **Payload CMS** | `bearer` | Token from `/api/users/login` |
| **Directus** | `bearer` | Static token from user settings |
| **Strapi** | `bearer` | Token from API Token settings |
| **Custom Next.js API** | `bearer` or `none` | Your own auth middleware |

See [`examples/`](./examples/) for ready-made config files.

---

## Adding Custom Tools

cms-mcp is designed to be extended. Adding a new tool takes about 20 lines.

### Example: add a `list_tags` tool

**1. Add the endpoint to your config:**
```json
{
  "endpoints": {
    "tags": "/tags"
  }
}
```

**2. Add the endpoint to the config schema** (`src/lib/config.ts`):

The `tags` endpoint is already in the schema — just set it in your config.

**3. Create or extend a tool file** (e.g., `src/tools/tags.ts`):

```typescript
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../lib/config.js";
import { ApiClient } from "../lib/api-client.js";
import { AuditLogger, withAudit } from "../lib/audit.js";

export function registerTagTools(
  server: McpServer,
  config: Config,
  audit: AuditLogger,
): void {
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
          content: [{
            type: "text" as const,
            text: `Tags: ${items.map((t: any) => t.name ?? t.slug).join(", ")}`,
          }],
        };
      });
    },
  );
}
```

**4. Register it in `src/index.ts`:**

```typescript
import { registerTagTools } from "./tools/tags.js";

// Inside the main() function, after other tool registrations:
registerTagTools(server, config, audit);
```

**5. Rebuild:**
```bash
npm run build
```

### Tool patterns

Every cms-mcp tool follows the same pattern:

```typescript
server.tool(
  "tool_name",
  { /* Zod schema for inputs */ },
  async (args) => {
    return withAudit(audit, "tool_name", args, async () => {
      // Your logic here
      return {
        content: [{ type: "text" as const, text: "result" }],
      };
    });
  },
);
```

`withAudit` handles timing, logging, and error capture automatically.

For write tools, add `if (config.readOnly) return readOnlyBlock("tool_name");` at the top.

For destructive tools, require `confirm: z.literal(true)` in the input schema.

### Adding a new endpoint type

If you want to manage a completely new resource type (e.g., `testimonials`, `case-studies`, `events`):

1. Add it to `EndpointsSchema` in `src/lib/config.ts`
2. Create `src/tools/your-resource.ts` following the blog/project tool pattern
3. Register in `src/index.ts`
4. Write tests in `tests/your-resource.test.ts`
5. Add docs in `docs/tools/your-resource.md`
6. Submit a PR

---

## Security

cms-mcp is designed to run with API credentials and be trusted with write access to your CMS.

| Protection | Detail |
|-----------|--------|
| **SSRF protection** | `assertSafeUrl()` blocks private IPs (RFC 1918), loopback, link-local (169.254.x.x), AWS metadata, IPv6 ULA/loopback, non-HTTP schemes |
| **No redirect following** | `redirect: "error"` on all `fetch()` calls — prevents auth header leakage via redirect |
| **30-second timeouts** | Every outbound request uses `AbortController` — no hanging requests |
| **50 MB media cap** | Rejects oversized uploads before buffering — prevents memory exhaustion |
| **Secret redaction** | Regex-based recursive redaction covers all common secret field names (`token`, `password`, `secret`, `key`, `auth*`, `credential*`) |
| **Input validation** | Zod schemas on every tool — types, lengths, formats, URL validity |
| **Confirm guards** | All create/update/delete operations require explicit `confirm: true` |
| **Webhook HMAC** | GitHub webhooks verified with constant-time SHA-256 comparison |
| **Payload limits** | 5 MB webhook body cap — rejects oversized payloads at HTTP level |
| **Read-only mode** | `--readonly` flag or `readOnly: true` config disables all write tools |
| **Audit logging** | Complete, tamper-evident log of every tool call with args, outcome, and duration |

For credential management and production deployment: [docs/security.md](./docs/security.md)

To report a vulnerability: [SECURITY.md](./SECURITY.md)

---

## Testing

```bash
npm test
```

**76 tests, 6 suites, 0 external dependencies:**

| Suite | Tests | What's covered |
|-------|-------|----------------|
| Policy Engine | 15 | All 10 rule types, tool scoping, multi-rule violations, edge cases |
| Content Distiller | 14 | HTML→Markdown (11 cases), field stripping, metadata headers, full pipeline |
| Circuit Breaker | 10 | Full CLOSED→OPEN→HALF-OPEN lifecycle, cached fallback, manual reset, status |
| Vector Cache | 8 | Store, TF-IDF search, type filtering, unrelated queries, clear operations |
| OpenAPI | 6 | Formatting, empty resources, missing fields |
| Security | 23 | SSRF (15 URL patterns), input edge cases, null bytes, long URLs, auth URLs |

Uses Node.js native test runner — no Jest, Mocha, or Vitest required.

---

## Docker

```dockerfile
# Build image
docker build -t cms-mcp .

# Run with config
docker run -v $(pwd)/cms-mcp.config.json:/app/config.json \
  -e CMS_API_TOKEN=your-token \
  cms-mcp --config /app/config.json
```

Or with docker-compose:

```bash
# Edit docker-compose.yml to set your env vars, then:
docker compose up
```

The Docker image uses a multi-stage build — only compiled JS and production dependencies ship in the final layer (~80MB).

---

## Documentation

| Guide | |
|-------|-|
| [Getting Started](./docs/getting-started.md) | Install, configure, first conversation |
| [Configuration](./docs/configuration.md) | Full config schema reference |
| [Project Tools](./docs/tools/projects.md) | All 8 project tools with input/output examples |
| [Blog Tools](./docs/tools/blogs.md) | All 9 blog tools with examples |
| [Media Tools](./docs/tools/media.md) | Upload, list, delete media |
| [GitHub Tools](./docs/tools/github.md) | Scan repos, sync to projects, list repos |
| [OpenAPI Discovery](./docs/advanced/openapi-discovery.md) | Auto-detect API endpoints from spec |
| [Policy Engine](./docs/advanced/policy-engine.md) | Enforce publishing standards |
| [Webhook Mode](./docs/advanced/webhook-mode.md) | GitHub push → shadow drafts |
| [Schema Cache](./docs/advanced/schema-cache.md) | SQLite caching with TTL |
| [Vector Search](./docs/advanced/vector-search.md) | TF-IDF semantic search |
| [Circuit Breaker](./docs/advanced/circuit-breaker.md) | Graceful API failure handling |
| [Content Distillation](./docs/advanced/content-distillation.md) | HTML→Markdown, junk stripping |
| [Security Guide](./docs/security.md) | Operator security reference |
| [Roadmap](./docs/roadmap.md) | Planned features (Phase 2 & 3) |

---

## Contributing

Contributions welcome — bug fixes, new CMS adapters, additional tool types, or documentation.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow, code conventions, and how to add new tools.

**Good first issues:**
- Add support for a new CMS in the examples folder
- Add `PUT` support alongside `PATCH` for APIs that require it
- Expand the `normalizeList` response parser for a new API shape you encounter
- Write tests for an edge case you discover

---

## License

MIT — see [LICENSE](./LICENSE).

---

<p align="center">
  Built for the <a href="https://modelcontextprotocol.io">Model Context Protocol</a> ecosystem
</p>
