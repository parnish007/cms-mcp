# cms-mcp

> A [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude manage your portfolio CMS — create blog posts, add projects, upload media, and sync GitHub repos — all from a conversation.

```
"Hey Claude, scan my latest repo and publish it as a portfolio project."
→ Done. Drafted, previewed, and published in 30 seconds.
```

---

## What it does

cms-mcp is a zero-dashboard CMS layer for developers. You describe what you want in plain language; Claude handles the API calls. It works with **any REST API** — Supabase, PocketBase, Payload CMS, a hand-rolled Next.js API, whatever you ship.

**Built on four safety pillars:**

| Pillar | What it means |
|--------|--------------|
| **Zod validation firewall** | All inputs validated before any network call |
| **Atomic transactions + rollback** | Failed writes auto-revert |
| **Binary media proxy** | Upload images by URL — MIME auto-detected from magic bytes, SSRF-protected |
| **Diff preview before writes** | See a field-level change table before confirming anything |

---

## Tools

### Projects (8 tools)
`list_projects` · `get_project` · `preview_create_project` · `create_project` · `preview_update_project` · `update_project` · `publish_project` · `delete_project`

### Blogs (9 tools)
`list_blogs` · `get_blog` · `preview_create_blog` · `create_blog` · `preview_update_blog` · `update_blog` · `publish_blog` · `unpublish_blog` · `delete_blog`

### Media (3 tools)
`upload_media_from_url` · `list_media` · `delete_media`

### GitHub (3 tools)
`scan_repo` · `sync_repo_to_project` · `list_repos`

---

## Installation

**Via npm (global):**
```bash
npm install -g cms-mcp
```

**Via npx (no install needed):**
```bash
npx cms-mcp --config ./cms-mcp.config.json
```

**From source:**
```bash
git clone https://github.com/parnish007/cms-mcp
cd cms-mcp
npm install && npm run build
node build/index.js --config ./cms-mcp.config.json
```

---

## Quick Start

**1. Create a config file** in your project root:

```json
{
  "baseUrl": "https://your-site.com/api",
  "auth": {
    "type": "bearer",
    "token": "env:CMS_API_TOKEN"
  },
  "endpoints": {
    "projects": "/projects",
    "blogs": "/blogs",
    "media": "/media"
  },
  "github": {
    "token": "env:GITHUB_TOKEN"
  }
}
```

**2. Set your environment variables:**

```bash
export CMS_API_TOKEN=your-api-token
export GITHUB_TOKEN=ghp_your_github_token
```

**3. Add to Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "npx",
      "args": ["cms-mcp", "--config", "/absolute/path/to/cms-mcp.config.json"],
      "env": {
        "CMS_API_TOKEN": "your-api-token",
        "GITHUB_TOKEN": "ghp_your_github_token"
      }
    }
  }
}
```

**4. Or add to Claude Code (CLI):**

```bash
claude mcp add cms-mcp -- npx cms-mcp --config ./cms-mcp.config.json
```

**5. Start a conversation:**

```
"List my draft projects"
"Scan github.com/you/cool-repo and create a portfolio entry"
"Write a blog post about my new release and save it as a draft"
"Upload this image and attach it to project ID 42"
```

---

## Configuration Reference

### Full config schema

```json
{
  "baseUrl": "https://your-site.com/api",

  "auth": {
    "type": "bearer",
    "token": "env:MY_TOKEN"
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

  "auditLog": "~/.cms-mcp/audit.log"
}
```

### Auth types

| Type | Example |
|------|---------|
| Bearer token | `{ "type": "bearer", "token": "env:MY_TOKEN" }` |
| API key header | `{ "type": "api-key", "header": "X-API-Key", "token": "env:MY_KEY" }` |
| HTTP Basic | `{ "type": "basic", "username": "admin", "password": "env:MY_PASS" }` |
| No auth | `{ "type": "none" }` |

### Secret references

Any string value prefixed with `env:` is resolved from the environment at startup:

```json
{ "token": "env:CMS_API_TOKEN" }
```

Secrets are **never** written to the audit log — only redacted lengths.

### Read-only mode

Disable all write tools with a flag or config:

```bash
npx cms-mcp --config ./cms-mcp.config.json --readonly
```

All create/update/delete/publish tools return a friendly block message. Safe for exploration.

---

## Tool Reference

### `scan_repo`

Scans a GitHub repository and extracts everything needed for a portfolio entry.

```
Input:  repo_url  —  "github.com/you/project" or "you/project"
Output: title, description, tech stack, live URL, recent commits, README preview
```

Detects 30+ technologies from README, package.json, requirements.txt, and repo topics.

---

### `sync_repo_to_project`

One-command: GitHub repo → portfolio project entry.

```
Input:  repo_url, status ("draft" | "published"), confirm: true
Output: Created project with auto-populated title, slug, tech stack, tags, SEO fields
```

---

### `preview_create_project` / `preview_update_project`

Shows a formatted table of what will be created/changed **before** anything hits your API. No confirmation required — safe to call freely.

```
## New Record Preview
| Field       | Value        |
|-------------|--------------|
| **title**   | My Project   |
| **status**  | draft        |
| **slug**    | my-project   |
---
Reply confirm to create, or cancel to abort.
```

---

### `upload_media_from_url`

Fetches an image from a public URL, detects its MIME type from magic bytes (not just the Content-Type header), and uploads it as a multipart binary to your media endpoint.

```
Input:  url, alt_text (optional), folder (optional)
Output: Uploaded file URL, filename, MIME type, size
```

SSRF-protected — blocks requests to private IPs, loopback, and AWS metadata endpoints.

---

## API Compatibility

cms-mcp normalizes list responses automatically. It handles these shapes:

```json
// All of these work:
[{ "id": 1, "title": "..." }]
{ "items": [...] }
{ "data": [...] }
{ "results": [...] }
{ "projects": [...] }
{ "posts": [...] }
```

Works with: Supabase (via PostgREST), PocketBase, Payload CMS, Directus, Strapi, custom Next.js API routes, Express, FastAPI — anything that speaks JSON over REST.

---

## Audit Log

Every tool call is appended to the audit log as newline-delimited JSON:

```json
{"timestamp":"2025-01-15T10:30:00.000Z","tool":"create_blog","args":{"title":"My Post","status":"draft"},"outcome":"success","durationMs":142}
{"timestamp":"2025-01-15T10:31:00.000Z","tool":"delete_project","args":{"id":"42","confirm":true},"outcome":"success","durationMs":89}
```

- Sensitive fields (`token`, `password`, `secret`, `key`, `auth*`) are redacted — only lengths logged
- Long string values (body, description) are truncated at 60 chars
- Error messages are truncated at 150 chars
- Nested objects are recursively sanitized

Configure via `"auditLog": "~/.cms-mcp/audit.log"` in your config. Logs always go to stderr regardless.

---

## CLI Flags

| Flag | Description |
|------|-------------|
| `--config <path>`, `-c <path>` | Path to config file (default: auto-discover in CWD, then home dir) |
| `--readonly` | Disable all write tools |

---

## Security

cms-mcp is designed to run with API credentials. Key security properties:

- **SSRF protection** — media proxy blocks all private/internal IP ranges and loopback addresses
- **No redirect following** — all `fetch()` calls use `redirect: "error"` to prevent auth header leakage
- **30-second timeouts** — every outbound request has a hard abort timeout
- **50 MB media cap** — rejects oversized uploads before buffering
- **Secrets never logged** — regex-based redaction covers all common secret field names
- **Input validation** — Zod schemas on every tool, GitHub owner/repo names validated against character allowlists
- **Confirm guards** — all destructive operations require `confirm: true` in the tool call

See [SECURITY.md](./SECURITY.md) for the full threat model and how to report vulnerabilities.

---

## Examples

### `examples/nextjs-supabase/`

Config for a Next.js portfolio site with API routes backed by Supabase.

```json
{
  "baseUrl": "https://your-site.vercel.app/api",
  "auth": { "type": "bearer", "token": "env:CMS_API_TOKEN" },
  "endpoints": {
    "projects": "/projects",
    "blogs": "/blogs",
    "media": "/media"
  },
  "github": { "token": "env:GITHUB_TOKEN" }
}
```

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](./LICENSE).
