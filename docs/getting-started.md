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
# cms-mcp 0.5.0
```

---

## Step 2 — Create your config file

**Option A — Auto-detect your CMS (recommended):**

```bash
npx cms-mcp init --base-url https://your-api.com/api
```

This probes your API for Supabase, Strapi, Directus, PocketBase, and Payload CMS signatures, then writes a starter `cms-mcp.config.json` with the correct auth type and common endpoint paths.

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

Any endpoint key works. At startup, cms-mcp registers `list_projects`, `get_projects`, `mutate_projects`, `list_posts`, `get_posts`, `mutate_posts`, etc. — tool shapes built from your API's actual fields.

The `env:` prefix means the value is read from an environment variable at runtime — never hardcoded into the file.

---

## Step 3 — Set environment variables

```bash
export CMS_API_TOKEN=your-api-token-here
```

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
[calls mutate_projects({ action: "preview", data: { title: "AI Image Generator", ... } })]

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

Claude: [calls mutate_projects({ action: "create", data: {...}, confirm: true })]
✅ Project created!
ID: proj_9xkT3
Title: AI Image Generator
Status: draft
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

Claude: [calls get_posts to find it, then mutate_posts({ action: "update", id: "ghi789", data: { status: "published" }, confirm: true })]
✅ Post ghi789 is now published.
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

- [Full configuration reference](./configuration.md)
- [Generic resource tools](./tools/generic-resource.md)
- [Introspection tools](./tools/introspection.md)
- [Security guide](./security.md)
- [Migration from v0.4](./migration-v0.5.md)
