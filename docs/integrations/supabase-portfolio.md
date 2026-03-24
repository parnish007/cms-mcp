# Supabase Portfolio Integration

This guide explains how to use cms-mcp to manage a Next.js 14 portfolio site backed by Supabase, using the CMS bridge API routes.

---

## What This Integration Does

The portfolio site exposes a set of lightweight REST endpoints under `/api/cms/` that act as a standard bridge between cms-mcp and the Supabase database. cms-mcp calls these endpoints using a shared API secret, so Claude (via Claude Desktop or Claude Code) can:

- List, create, update, and delete **projects** and **blog posts** directly
- Upload and list **media** via Cloudinary
- Perform bulk operations, drafting, publishing, and content audits through natural conversation

The bridge routes use the Supabase service role key directly against the PostgREST API, bypassing Row Level Security — meaning Claude has full write access to the `projects` and `blogs` tables when authorized.

---

## Architecture Overview

```
Claude Desktop / Claude Code
        │
        ▼
   cms-mcp (MCP server)
        │  x-admin-api-secret header
        ▼
   Next.js /api/cms/* routes       ← the bridge files
        │  Supabase service role key
        ▼
   Supabase PostgREST
        │
        ▼
   projects / blogs tables
```

---

## Prerequisites

### Environment Variables (Portfolio Site)

Set these in your `.env.local` (development) and in Vercel / your hosting provider for production:

| Variable | Description |
|---|---|
| `ADMIN_API_SECRET` | Shared secret used to authenticate cms-mcp requests. Generate a strong random value (e.g. `openssl rand -hex 32`). |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key. Never expose this to the browser. |
| `CLOUDINARY_CLOUD_NAME` | Your Cloudinary cloud name (required for `/api/cms/media`). |
| `CLOUDINARY_API_KEY` | Cloudinary API key. |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret. |
| `CLOUDINARY_FOLDER_DEFAULT` | (Optional) Default upload folder, e.g. `portfolio`. Defaults to `portfolio`. |

### Environment Variables (cms-mcp / Claude)

| Variable | Description |
|---|---|
| `ADMIN_API_SECRET` | Must match the value set in the portfolio site. |

---

## Files Created

### Portfolio Site (`app/api/cms/`)

| File | Purpose |
|---|---|
| `app/api/cms/projects/route.ts` | `GET` list all projects, `POST` create a project |
| `app/api/cms/projects/[id]/route.ts` | `GET` single project, `PATCH` update, `DELETE` delete |
| `app/api/cms/blogs/route.ts` | `GET` list all blogs, `POST` create a blog post |
| `app/api/cms/blogs/[id]/route.ts` | `GET` single blog post, `PATCH` update, `DELETE` delete |
| `app/api/cms/media/route.ts` | `GET` list Cloudinary images, `POST` upload via URL |

### cms-mcp

| File | Purpose |
|---|---|
| `examples/portfolio-supabase/cms-mcp.config.json` | Ready-to-use config pointing at `localhost:3000` |

---

## Step-by-Step Setup

### 1. Set up environment variables

In the portfolio site root, add to `.env.local`:

```bash
ADMIN_API_SECRET=your-strong-random-secret-here
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key...
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### 2. Start the portfolio site

```bash
cd /path/to/portfolio-website
npm run dev
# Site is now running at http://localhost:3000
```

### 3. Configure cms-mcp

Copy the example config and edit the `baseUrl` if needed:

```bash
cp /path/to/cms-mcp/examples/portfolio-supabase/cms-mcp.config.json ~/.cms-mcp/portfolio.config.json
```

The config file uses `env:ADMIN_API_SECRET`, so cms-mcp will read `ADMIN_API_SECRET` from the environment automatically. Make sure the variable is set in the shell where you launch Claude Desktop or Claude Code.

For production, change `baseUrl` to your deployed URL:

```json
{
  "baseUrl": "https://your-portfolio.vercel.app/api/cms"
}
```

### 4. Configure Claude Desktop

Add to your `claude_desktop_config.json` (typically at `~/.config/claude/claude_desktop_config.json` on Linux/macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "cms-portfolio": {
      "command": "node",
      "args": ["/path/to/cms-mcp/dist/index.js", "--config", "/home/you/.cms-mcp/portfolio.config.json"],
      "env": {
        "ADMIN_API_SECRET": "your-strong-random-secret-here"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

### 5. Configure Claude Code

If using Claude Code (CLI), you can pass the config via the MCP flag or your project's `.claude/mcp.json`:

```json
{
  "servers": {
    "cms-portfolio": {
      "command": "node",
      "args": ["/path/to/cms-mcp/dist/index.js", "--config", "/home/you/.cms-mcp/portfolio.config.json"],
      "env": {
        "ADMIN_API_SECRET": "your-strong-random-secret-here"
      }
    }
  }
}
```

---

## API Reference

### Authentication

All endpoints accept the secret in either of two ways:

```
Authorization: Bearer <ADMIN_API_SECRET>
x-admin-api-secret: <ADMIN_API_SECRET>
```

### Projects

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/cms/projects` | — | `{ ok: true, items: [...] }` |
| `POST` | `/api/cms/projects` | JSON project fields | `{ ok: true, item: {...} }` |
| `GET` | `/api/cms/projects/:id` | `?slug=true` to look up by slug | `{ ok: true, item: {...} }` |
| `PATCH` | `/api/cms/projects/:id` | JSON partial update | `{ ok: true, item: {...} }` |
| `DELETE` | `/api/cms/projects/:id` | — | `{ ok: true }` |

#### Project fields

```
id, slug, title, summary, description, cover_image, tags (text[]),
tech_stack (text[]), live_url, repo_url, status, is_featured (bool),
is_published (bool), order_index (int), related_blog_slugs (text[]),
timeline (jsonb), seo (jsonb), created_at, updated_at
```

### Blogs

| Method | Path | Body / Params | Response |
|---|---|---|---|
| `GET` | `/api/cms/blogs` | — | `{ ok: true, items: [...] }` |
| `POST` | `/api/cms/blogs` | JSON blog fields | `{ ok: true, item: {...} }` |
| `GET` | `/api/cms/blogs/:id` | `?slug=true` to look up by slug | `{ ok: true, item: {...} }` |
| `PATCH` | `/api/cms/blogs/:id` | JSON partial update | `{ ok: true, item: {...} }` |
| `DELETE` | `/api/cms/blogs/:id` | — | `{ ok: true }` |

#### Blog fields

```
id, slug, title, excerpt, content, cover_image, tags (text[]),
published_at, is_published (bool), seo (jsonb), created_at, updated_at
```

### Media

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/cms/media` | `?max_results=50&next_cursor=...` | `{ ok: true, items: [...], nextCursor, totalCount }` |
| `POST` | `/api/cms/media` | `{ url: string, altText?: string, folder?: string }` | `{ ok: true, item: { url, publicId, ... } }` |

Media list items include: `url`, `publicId`, `filename`, `format`, `bytes`, `width`, `height`, `createdAt`.

---

## Example Conversations with Claude

Once cms-mcp is connected, you can use natural language to manage your portfolio content.

### Listing and reviewing content

> "Show me all my published projects."

> "List all blog posts that are still in draft."

> "Which projects are marked as featured?"

### Creating content

> "Create a new project called 'AI Dashboard' with slug 'ai-dashboard', summary 'A real-time AI monitoring dashboard', tags ['AI', 'Next.js', 'TypeScript'], and status 'draft'."

> "Write a new blog post titled 'Building with MCP' with an excerpt and the following content: ..."

### Updating content

> "Set the project with slug 'ai-dashboard' to published."

> "Update the SEO title and description for the blog post about MCP."

> "Add 'Supabase' to the tech stack of my portfolio redesign project."

### Publishing workflows

> "Publish all projects that have a non-empty description and cover image."

> "Set all blog posts with published_at before 2024-01-01 to is_published = false."

### Media management

> "List the most recent 20 images from Cloudinary."

> "Upload this image URL to Cloudinary in the 'blog' folder: https://example.com/image.jpg"

---

## How to Add New Endpoints

To expose a new Supabase table through the CMS bridge:

1. **Create the collection route** at `app/api/cms/<table>/route.ts`. Copy the pattern from `app/api/cms/projects/route.ts`, replacing `projects` with your table name in all fetch URLs.

2. **Create the single-item route** at `app/api/cms/<table>/[id]/route.ts`. Copy from `app/api/cms/projects/[id]/route.ts` and replace the table name.

3. **Add the endpoint to the cms-mcp config:**

```json
{
  "endpoints": {
    "projects": "/projects",
    "blogs": "/blogs",
    "media": "/media",
    "yourTable": "/your-table"
  }
}
```

4. Restart Claude Desktop / Claude Code to pick up the new endpoint. cms-mcp will register `list_yourTable`, `get_yourTable`, and `mutate_yourTable` automatically.

The bridge routes follow a consistent pattern:
- Auth check at the top using `isAuthorized(request)`
- Supabase config loaded from env vars
- Direct PostgREST fetch with service role headers
- `Prefer: return=representation` on POST/PATCH to get back the created/updated row
- All responses include `Cache-Control: no-store`
- Errors return `{ ok: false, error: "..." }` with an appropriate HTTP status

---

## Security Notes

- The `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. The bridge routes are protected only by `ADMIN_API_SECRET` — keep it secret and use a strong value.
- The `ADMIN_API_SECRET` should be at least 32 random hex characters. Generate one with: `openssl rand -hex 32`
- In production, ensure the `/api/cms/*` routes are only accessible over HTTPS.
- The approval gate (`approvals` config block, or `--approval` CLI flag) requires a human to confirm write operations in the cms-mcp UI before they execute. Gate specific endpoints with `"tools": ["mutate_projects", "mutate_blogs"]`.
- Audit logs are written to `~/.cms-mcp/portfolio-audit.ndjson` by default — review them periodically.
