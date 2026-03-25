# Getting Started with cms-mcp

Get from zero to a working Claude ↔ CMS integration in five minutes.

---

## Prerequisites

- **Node.js 18+** (`node --version` to check)
- A CMS or portfolio API with a JSON REST interface
- Claude Desktop or the Claude Code CLI

---

## Step 1 — Install

```bash
npm install -g cms-mcp
```

Verify the install:

```bash
cms-mcp --version
# cms-mcp 1.0.0
```

---

## Step 2 — Create your config file

**Option A — Auto-detect your CMS (recommended):**

```bash
npx cms-mcp init --base-url https://your-api.com/api
```

This opens an interactive wizard: it HEAD-probes your API, auto-detects Supabase, Strapi, Directus, PocketBase, and Payload CMS, then asks for auth type, endpoints, and optional features before writing `cms-mcp.config.json`.

**Option B — Write it manually:**

Create `cms-mcp.config.json` in your project root (or your home directory — see [Config search order](./configuration.md#config-file-search-order)):

```json
{
  "name": "My Portfolio",
  "baseUrl": "https://my-portfolio.vercel.app/api",
  "auth": {
    "type": "bearer",
    "token": "env:CMS_API_TOKEN"
  },
  "endpoints": {
    "projects": "/projects",
    "posts":    "/posts",
    "media":    "/media"
  },
  "schemaCache": { "path": "~/.cms-mcp/schema-cache.db", "ttlMinutes": 60 },
  "auditLog": "~/.cms-mcp/audit.log"
}
```

Any endpoint key works. At startup, cms-mcp registers `list_projects`, `get_projects`, `create_projects`, `update_projects`, `delete_projects`, `list_posts`, `get_posts`, `create_posts`, etc. — tool shapes built from your API's actual fields.

The `env:` prefix means the value is read from an environment variable at runtime — never hardcoded into the file.

---

## Step 3 — Get your API token and set environment variables

The `"token": "env:CMS_API_TOKEN"` line in your config means: *read the token from the `CMS_API_TOKEN` environment variable at runtime*. You need to get a token from your CMS and make it available to cms-mcp.

### What is `CMS_API_TOKEN`?

It's an API token (also called an API key or access token) that your CMS issues to prove you're allowed to read and write data. **Where you get it depends on your CMS:**

| CMS | Where to find the token |
|-----|------------------------|
| **Supabase** | Project Settings → API → `anon` or `service_role` key |
| **Strapi** | Settings → API Tokens → Create new API Token |
| **Directus** | Settings → Access Tokens → Create Token |
| **PocketBase** | POST `/api/collections/users/auth-with-password` → copy `token` |
| **Payload CMS** | Admin panel → Users → your user → API Key |
| **Contentful** | Settings → API keys → Content Management API token |
| **Sanity** | manage.sanity.io → API → Tokens → Add API token |
| **Custom backend** | Whatever auth your backend requires (see full guide) |

For step-by-step screenshots and curl commands for each platform, see the **[Environment Variables Guide](./env-vars.md)**.

### Set the variable

**For Claude Desktop / Claude Code (recommended):**

Add it to the `env` block in your MCP server config — tokens never touch your project files:

```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "npx",
      "args": ["cms-mcp", "--config", "/path/to/cms-mcp.config.json"],
      "env": {
        "CMS_API_TOKEN": "paste-your-token-here"
      }
    }
  }
}
```

**For terminal use:**

```bash
# macOS / Linux
export CMS_API_TOKEN=your-token-here

# Windows PowerShell
$env:CMS_API_TOKEN="your-token-here"
```

> Never put the raw token value in `cms-mcp.config.json` — use `"env:CMS_API_TOKEN"` and keep the real value in your shell or Claude config.

---

## Step 4 — Connect to Claude Desktop

Open your Claude Desktop config file:

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Add the `cms-mcp` server entry:

```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "cms-mcp",
      "env": {
        "CMS_API_TOKEN": "your-actual-api-token-here"
      }
    }
  }
}
```

Restart Claude Desktop. You should see a hammer icon in the chat input — click it to confirm the tools are loaded.

---

## Step 5 — Connect to Claude Code CLI

Add the server to your Claude Code project config at `.claude/settings.json`:

```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "cms-mcp",
      "env": {
        "CMS_API_TOKEN": "your-actual-api-token-here"
      }
    }
  }
}
```

Or add it from the command line:

```bash
claude mcp add cms-mcp -- npx cms-mcp --config ./cms-mcp.config.json
```

Verify the tools loaded:

```bash
claude mcp list
# cms-mcp  ● connected  (9 tools)
```

---

## Step 6 — First conversations

Once connected, you can talk to Claude naturally. Here are examples to try immediately.

### List everything

```
You: What posts do I have?

Claude: I'll check your posts now.
[calls list_posts]

Found 4 post(s):

• [abc123] Building a Design System (published)
• [def456] Why I Switched to Next.js (published)
• [ghi789] Getting Started with Supabase (draft)
• [jkl012] TypeScript Generics Deep Dive (draft)
```

### Create a new project

```
You: Add a new project called "AI Image Generator" — it's a Next.js + OpenAI app,
     live at https://ai-gen.vercel.app, repo at https://github.com/you/ai-image-gen.
     Keep it as a draft for now.

Claude: Let me preview that first.
[calls create_projects({ title: "AI Image Generator", tech_stack: "Next.js, OpenAI",
  live_url: "https://ai-gen.vercel.app", status: "draft", preview: true })]

## New Record Preview

| Field | Value |
|-------|-------|
| **title** | AI Image Generator |
| **tech_stack** | Next.js, OpenAI |
| **live_url** | https://ai-gen.vercel.app |
| **repo_url** | https://github.com/you/ai-image-gen |
| **status** | draft |

---
Reply confirm to create, or cancel to abort.

You: confirm

Claude: [calls create_projects({ ..., confirm: true })]
✅ projects created!
ID: proj_9xkT3
title: AI Image Generator
status: draft
```

### Scan a GitHub repo and sync it as a project

```
You: Scan my repo github.com/you/ai-image-gen and create a project from it.

Claude: [calls scan_repo → sync_repo_to_project]
Scanned repo. Detected: Next.js, TypeScript, OpenAI, Tailwind CSS, Vercel.
Project "AI Image Generator" synced with tech stack and description. ID: proj_9xkT3
```

### Publish a post

```
You: Publish the "Getting Started with Supabase" draft.

Claude: [calls get_posts to find it, then update_posts({ id: "ghi789", status: "published", confirm: true })]
✅ posts ghi789 updated.
```

---

## Troubleshooting

**"No config file found"** — Make sure `cms-mcp.config.json` is in the directory where you run the command, or in your home directory.

**"Environment variable X is not set"** — Add the variable to the `env` block in your Claude Desktop / Claude Code config.

**Tools not showing in Claude Desktop** — Restart Claude Desktop after editing the config file.

**API auth errors (401/403)** — Check that your token in the `env` block is correct and hasn't expired.

**Cold-start tools (passthrough mode)** — If your endpoint has no records yet, tools register in passthrough mode. Create one record in your CMS, then ask Claude: "Refresh the schema for X."

---

## Next steps

- [Environment variables guide](./env-vars.md) — tokens for every CMS, how to set them
- [Full configuration reference](./configuration.md)
- [Generic resource tools](./tools/generic-resource.md)
- [Introspection tools](./tools/introspection.md)
- [Security guide](./security.md)
- [Migration from v0.5](./migration-v1.0.md)
- [Migration from v0.4](./migration-v0.5.md)
