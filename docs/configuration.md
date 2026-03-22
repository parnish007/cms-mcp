# Configuration Reference

cms-mcp is configured via a single `cms-mcp.config.json` file. This document covers every field, all supported auth types, and complete example configs for common CMS stacks.

---

## Config file search order

When cms-mcp starts, it looks for the config file in this order:

1. `{current working directory}/cms-mcp.config.json`
2. `{home directory}/cms-mcp.config.json`

The first file found is used. If neither exists, the server exits with an error message pointing to this documentation.

**CWD takes precedence**, so you can have a project-specific config that overrides your global one.

---

## Top-level fields

### `name` (required)

A human-readable label for your site. Appears in audit log entries and error messages.

```json
"name": "My Portfolio"
```

---

### `baseUrl` (optional)

The base URL of your deployed site. Used for constructing preview links and as context for Claude when discussing URLs.

```json
"baseUrl": "https://my-portfolio.vercel.app"
```

---

### `auth` (required)

Authentication method for your CMS API. Supports four types via a discriminated union on `type`.

#### `bearer` — Authorization: Bearer token

```json
"auth": {
  "type": "bearer",
  "token": "env:CMS_API_TOKEN"
}
```

Sends `Authorization: Bearer <token>` on every request.

#### `api-key` — Custom header API key

```json
"auth": {
  "type": "api-key",
  "header": "X-API-Key",
  "token": "env:CMS_API_KEY"
}
```

`header` defaults to `X-API-Key` if omitted. Use this for Payload CMS, PocketBase admin tokens, or any API that uses a custom key header.

#### `basic` — HTTP Basic Auth

```json
"auth": {
  "type": "basic",
  "username": "admin",
  "password": "env:CMS_PASSWORD"
}
```

Encodes credentials as `Authorization: Basic base64(username:password)`.

#### `none` — No authentication

```json
"auth": {
  "type": "none"
}
```

Sends no `Authorization` header. Use only for locally-hosted CMSs behind a firewall.

---

### `endpoints` (required — at least one)

Maps resource types to their full API URLs. Each is optional; omitting one disables the corresponding tools.

```json
"endpoints": {
  "projects": "https://my-site.vercel.app/api/projects",
  "blogs":    "https://my-site.vercel.app/api/blogs",
  "media":    "https://my-site.vercel.app/api/media",
  "tags":     "https://my-site.vercel.app/api/tags",
  "siteConfig": "https://my-site.vercel.app/api/site-config",
  "analytics":  "https://my-site.vercel.app/api/analytics"
}
```

| Field | Tools enabled |
|-------|--------------|
| `projects` | All 8 project tools |
| `blogs` | All 9 blog tools |
| `media` | All 3 media tools |
| `tags` | Tag lookup (used internally by create/update) |
| `siteConfig` | Future: site settings tools |
| `analytics` | Future: analytics tools |

---

### `github` (optional)

Enables the 3 GitHub tools (`scan_repo`, `sync_repo_to_project`, `list_repos`).

```json
"github": {
  "token": "env:GITHUB_TOKEN",
  "defaultOwner": "your-github-username"
}
```

| Field | Description |
|-------|-------------|
| `token` | GitHub Personal Access Token. Needs `repo` scope for private repos, `public_repo` for public only. |
| `defaultOwner` | When you say "scan my repo foo", this username is used if no owner is specified. |

---

### `fieldMap` (optional)

Maps cms-mcp's generic field names to your API's actual field names. Useful when your API uses non-standard naming.

```json
"fieldMap": {
  "title":          "post_title",
  "body":           "content_md",
  "slug":           "url_slug",
  "status":         "publish_state",
  "tags":           "tag_list",
  "coverImage":     "hero_image",
  "publishedAt":    "published_date",
  "seoTitle":       "meta_title",
  "seoDescription": "meta_description",
  "techStack":      "technologies",
  "liveUrl":        "demo_url",
  "repoUrl":        "github_url"
}
```

All fields default to their standard names if omitted.

---

### `readOnly` (optional, default: `false`)

When `true`, all write operations are disabled. Claude will receive a clear message instead of executing any create, update, publish, or delete operation.

```json
"readOnly": true
```

Use this when sharing a Claude instance with team members who should be able to query content but not modify it.

---

### `auditLog` (optional)

Path to a file where every tool call is logged as newline-delimited JSON.

```json
"auditLog": "~/.cms-mcp/audit.log"
```

Each line in the file is a JSON object:

```json
{
  "timestamp": "2026-03-22T14:30:00.000Z",
  "tool": "create_blog",
  "args": { "title": "My Post", "status": "draft" },
  "success": true,
  "durationMs": 342
}
```

The `~` prefix is expanded to your home directory on both Unix and Windows.

---

## New fields (planned additions)

These fields are on the roadmap and will be validated by the config schema when implemented.

### `policies` — Path to policies.json

```json
"policies": "./cms-mcp.policies.json"
```

Points to a [policy engine configuration file](./advanced/policy-engine.md). Policies block writes that violate content governance rules before they reach the API.

### `webhook` — GitHub webhook listener

```json
"webhook": {
  "port": 3456,
  "secret": "env:WEBHOOK_SECRET"
}
```

Starts an HTTP server that listens for GitHub push events. See [Webhook Mode](./advanced/webhook-mode.md).

### `schemaCache` — SQLite schema cache

```json
"schemaCache": {
  "path": "~/.cms-mcp/schema.db",
  "ttlMinutes": 60
}
```

Caches discovered OpenAPI/CMS schemas locally in SQLite to reduce startup round trips. See [Schema Cache](./advanced/schema-cache.md).

### `openapi` — OpenAPI auto-discovery

```json
"openapi": {
  "autoDiscover": true,
  "discoveryUrl": "https://my-api.vercel.app/openapi.json"
}
```

When `autoDiscover` is `true`, cms-mcp fetches your API's OpenAPI spec at startup to learn about available endpoints and field shapes. See [OpenAPI Discovery](./advanced/openapi-discovery.md).

---

## Environment variable (secret) references

Any string field that accepts sensitive data supports the `env:` prefix:

```
"env:VARIABLE_NAME"
```

At startup, cms-mcp resolves these values from the process environment. If the variable is not set, the server exits with a clear error:

```
[cms-mcp] Environment variable "CMS_API_TOKEN" is required but not set.
Add it to the "env" field in your Claude Desktop config.
```

**Supported fields for `env:` references:**
- `auth.token` (bearer and api-key)
- `auth.password` (basic)
- `github.token`
- `webhook.secret`

**Never put raw secrets directly in the JSON file** — the file may be committed to source control.

---

## Example configs

### Supabase + Next.js API routes

```json
{
  "name": "My Supabase Portfolio",
  "baseUrl": "https://my-portfolio.vercel.app",
  "auth": {
    "type": "bearer",
    "token": "env:SUPABASE_SERVICE_ROLE_KEY"
  },
  "endpoints": {
    "projects": "https://my-portfolio.vercel.app/api/projects",
    "blogs":    "https://my-portfolio.vercel.app/api/blogs",
    "media":    "https://my-portfolio.vercel.app/api/media"
  },
  "github": {
    "token": "env:GITHUB_TOKEN",
    "defaultOwner": "yourname"
  },
  "auditLog": "~/.cms-mcp/audit.log"
}
```

The API routes in your Next.js app validate the `Authorization: Bearer` header against `SUPABASE_SERVICE_ROLE_KEY`.

---

### PocketBase

PocketBase uses a custom `Authorization` header with an admin token:

```json
{
  "name": "PocketBase Portfolio",
  "baseUrl": "https://pb.my-site.com",
  "auth": {
    "type": "api-key",
    "header": "Authorization",
    "token": "env:PB_ADMIN_TOKEN"
  },
  "endpoints": {
    "projects": "https://pb.my-site.com/api/collections/projects/records",
    "blogs":    "https://pb.my-site.com/api/collections/blog_posts/records",
    "media":    "https://pb.my-site.com/api/collections/media/records"
  }
}
```

Get your admin token by calling `POST /api/admins/auth-with-password` and storing the returned `token`.

---

### Payload CMS

```json
{
  "name": "Payload Portfolio",
  "baseUrl": "https://payload.my-site.com",
  "auth": {
    "type": "api-key",
    "header": "Authorization",
    "token": "env:PAYLOAD_API_KEY"
  },
  "endpoints": {
    "projects": "https://payload.my-site.com/api/projects",
    "blogs":    "https://payload.my-site.com/api/posts",
    "media":    "https://payload.my-site.com/api/media"
  },
  "fieldMap": {
    "body": "content",
    "coverImage": "heroImage"
  }
}
```

In Payload, enable API key authentication in your collection config and set `useAPIKey: true`.

---

### Custom Next.js API (no external CMS)

For a fully custom Next.js portfolio where your API routes live alongside your frontend:

```json
{
  "name": "Custom Portfolio",
  "baseUrl": "https://yourname.dev",
  "auth": {
    "type": "bearer",
    "token": "env:API_SECRET_KEY"
  },
  "endpoints": {
    "projects": "https://yourname.dev/api/projects",
    "blogs":    "https://yourname.dev/api/blog",
    "media":    "https://yourname.dev/api/media"
  },
  "github": {
    "token": "env:GITHUB_TOKEN",
    "defaultOwner": "yourname"
  },
  "readOnly": false,
  "auditLog": "~/.cms-mcp/audit.log",
  "openapi": {
    "autoDiscover": true
  }
}
```

Your API route handler validates the token:

```typescript
// app/api/projects/route.ts
export async function GET(req: Request) {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (token !== process.env.API_SECRET_KEY) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // ... your logic
}
```
