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

Create `cms-mcp.config.json` in your project root. If you're not sure how to create the file, pick one of these methods:

**Windows (PowerShell) — create and open in Notepad:**
```powershell
notepad cms-mcp.config.json
```
Notepad will ask "File not found, create it?" — click **Yes**.

**Open in VS Code directly:**
```powershell
code cms-mcp.config.json
```

**macOS / Linux:**
```bash
nano cms-mcp.config.json
# or
code cms-mcp.config.json
```

Paste this content — replacing the `baseUrl` with your actual API URL:

```json
{
  "name": "My Portfolio",
  "baseUrl": "https://your-domain.vercel.app/api/cms",
  "auth": {
    "type": "api-key",
    "header": "x-admin-api-secret",
    "token": "env:ADMIN_API_SECRET"
  },
  "endpoints": {
    "projects": "/projects",
    "blogs":    "/blogs",
    "media":    "/media"
  },
  "schemaCache": { "path": "~/.cms-mcp/schema-cache.db", "ttlMinutes": 60 },
  "auditLog": "~/.cms-mcp/audit.log",
  "approvals": {
    "port":      2323,
    "timeoutMs": 300000,
    "tools":     ["delete_projects", "delete_blogs"]
  }
}
```

> **Important — understand the two-file system before continuing:**

---

### The two-file system (read this carefully)

cms-mcp splits your configuration across **two files** on purpose — one safe to share, one that stays private.

```
cms-mcp.config.json          ← SAFE. Only holds the variable NAME.
claude_desktop_config.json   ← PRIVATE. Holds the actual secret VALUE.
```

**`cms-mcp.config.json`** — never put your real secret here:
```json
"token": "env:ADMIN_API_SECRET"
         ^^^  ^^^^^^^^^^^^^^^^
         |    variable NAME (not the value)
         tells cms-mcp to read from environment
```

**`claude_desktop_config.json`** — the real value lives here:
```json
"env": {
  "ADMIN_API_SECRET": "abc123youractualsecret"
                       ^^^^^^^^^^^^^^^^^^^^^^
                       the real value goes here
}
```

When cms-mcp starts, it reads `env:ADMIN_API_SECRET` from the config, looks up the `ADMIN_API_SECRET` environment variable, and finds the real secret that Claude Desktop injected. **The config file itself never sees the secret.**

**Common mistakes to avoid:**

| Wrong | Right |
|-------|-------|
| `"token": "env:abc123yoursecret"` | `"token": "env:ADMIN_API_SECRET"` |
| `"token": "abc123yoursecret"` | `"token": "env:ADMIN_API_SECRET"` |
| Real secret in `cms-mcp.config.json` | Real secret only in Claude Desktop config |

---

Any endpoint key works. At startup, cms-mcp registers `list_projects`, `get_projects`, `create_projects`, `update_projects`, `delete_projects`, `list_blogs`, `get_blogs`, etc. — tool shapes built from your API's actual fields.

---

## Step 3 — Get your API token

Your config file has `"token": "env:ADMIN_API_SECRET"`. This means cms-mcp will look for an environment variable called `ADMIN_API_SECRET` — you need to get the actual token value from your CMS and put it there.

### Where to get your token

| CMS / Backend | Where to find it |
|---------------|-----------------|
| **Supabase** | Project Settings → API → `anon` or `service_role` key |
| **Strapi** | Settings → API Tokens → Create new API Token |
| **Directus** | Settings → Access Tokens → Create Token |
| **PocketBase** | POST `/api/collections/users/auth-with-password` → copy `token` |
| **Payload CMS** | Admin panel → Users → your user → API Key |
| **Custom Next.js backend** | Your `ADMIN_API_SECRET` env var value in your backend `.env` |
| **Contentful** | Settings → API keys → Content Management API token |
| **Sanity** | manage.sanity.io → API → Tokens → Add API token |

Full step-by-step for every platform: **[Environment Variables Guide](./env-vars.md)**

### Where to put the token value

Once you have your token, **do NOT paste it into `cms-mcp.config.json`**. Put it in the Claude Desktop config instead (Step 4). The config file only holds the variable name — the real value goes in Claude Desktop.

---

## Step 4 — Connect to Claude Desktop

This step is where you paste your actual secret token. It lives here — not in `cms-mcp.config.json`.

### 1. Open the Claude Desktop config file

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Open it in Notepad (Windows):
```powershell
notepad "$env:APPDATA\Claude\claude_desktop_config.json"
```

### 2. Add the cms-mcp server entry

**If you cloned the repo** (e.g. to `C:\Users\AB\cms-mcp`):
```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "node",
      "args": [
        "C:/Users/AB/cms-mcp/build/index.js",
        "--config",
        "C:/Users/AB/cms-mcp/cms-mcp.config.json"
      ],
      "env": {
        "ADMIN_API_SECRET": "your-actual-token-here"
      }
    }
  }
}
```

**If you installed via npm (`npm install -g cms-mcp`):**
```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "cms-mcp",
      "args": ["--config", "C:/Users/AB/cms-mcp/cms-mcp.config.json"],
      "env": {
        "ADMIN_API_SECRET": "your-actual-token-here"
      }
    }
  }
}
```

> Replace `your-actual-token-here` with the real token you got in Step 3.
> Replace `ADMIN_API_SECRET` with whatever variable name you used in `cms-mcp.config.json` (after `env:`).

### 3. How the two files connect

```
cms-mcp.config.json                  claude_desktop_config.json
─────────────────────                ──────────────────────────────
"token": "env:ADMIN_API_SECRET"  →   "ADMIN_API_SECRET": "abc123..."
                  ↑                                        ↑
          variable NAME here                     real VALUE here
```

### 4. Restart Claude Desktop

Close it fully and reopen. You should see a hammer icon in the chat input — click it to confirm the tools are loaded.

> **Tools not showing?** Check that the `args` paths use forward slashes (`/`) not backslashes, and that `build/index.js` exists in your cms-mcp folder.

---

## Step 5 — Connect to Claude Code CLI

Add to `.claude/settings.json` in your project — same two-file rule applies, real token goes in the `env` block:

```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "node",
      "args": [
        "C:/Users/AB/cms-mcp/build/index.js",
        "--config",
        "C:/Users/AB/cms-mcp/cms-mcp.config.json"
      ],
      "env": {
        "ADMIN_API_SECRET": "your-actual-token-here"
      }
    }
  }
}
```

Or add via command line:

```bash
claude mcp add cms-mcp -- npx cms-mcp --config ./cms-mcp.config.json
```

Verify the tools loaded:

```bash
claude mcp list
# cms-mcp  ● connected
```

---

## Step 6 — (Optional) Enable GitHub plugin

The GitHub plugin lets Claude scan your repos and sync them as portfolio projects:

```
"Scan my repo github.com/you/my-app and create a project from it"
"List all my public repos"
```

> **Warning — both pieces required together:**
> If you add the `github` block to your config but forget to add `GITHUB_TOKEN` to the Claude Desktop `env` block (or vice versa), the **entire server crashes on startup** — not just the GitHub tools. Do Steps 1–4 together, or skip this step entirely until you're ready.

### 1. Get a GitHub Personal Access Token

1. Go to **[github.com/settings/tokens](https://github.com/settings/tokens)**
2. Click **"Generate new token (classic)"**
3. Give it a name like `cms-mcp`
4. Select scopes:
   - `public_repo` — public repos only (safer, recommended)
   - `repo` — if you want to scan private repos too
5. Click **"Generate token"** → copy the value (starts with `ghp_`)

> You only see the token **once**. Copy it before closing the page.

### 2. Add `github` block to `cms-mcp.config.json`

Open your `cms-mcp.config.json` and add the `github` block:

```json
{
  "name": "Portfolio",
  "baseUrl": "https://your-domain.vercel.app/api/cms",
  "auth": {
    "type": "api-key",
    "header": "x-admin-api-secret",
    "token": "env:ADMIN_API_SECRET"
  },
  "endpoints": {
    "projects": "/projects",
    "blogs":    "/blogs",
    "media":    "/media"
  },
  "github": {
    "token":        "env:GITHUB_TOKEN",
    "defaultOwner": "your-actual-github-username"
  },
  "schemaCache": { "path": "~/.cms-mcp/schema-cache.db", "ttlMinutes": 60 },
  "auditLog": "~/.cms-mcp/audit.log"
}
```

Two things to get right:
- `"env:GITHUB_TOKEN"` — this is the variable **name**, not the token value (same pattern as `ADMIN_API_SECRET`)
- `"defaultOwner"` — replace `"your-actual-github-username"` with your real GitHub username (e.g. `"parnish007"`)

### 3. Add `GITHUB_TOKEN` to Claude Desktop config

Open `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS).

Add `GITHUB_TOKEN` to the **same `env` block** as `ADMIN_API_SECRET`:

```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "node",
      "args": [
        "C:/Users/YourName/cms-mcp/build/index.js",
        "--config",
        "C:/Users/YourName/cms-mcp/cms-mcp.config.json"
      ],
      "env": {
        "ADMIN_API_SECRET": "your-actual-admin-secret",
        "GITHUB_TOKEN":     "ghp_xxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Replace `ghp_xxxxxxxxxxxxxxxxxxxx` with the token you copied in Step 1.

### 4. Restart Claude Desktop

Fully quit (system tray → Quit) and reopen. These tools will appear:

| Tool | What it does |
|------|-------------|
| `scan_repo` | Reads a GitHub repo — README, tech stack, description |
| `sync_repo_to_project` | Creates a draft project in your CMS from a scanned repo |
| `list_repos` | Lists your GitHub repos |

**Try it:**
```
You: Scan github.com/your-username/your-repo and add it as a project
Claude: [scans repo → creates draft project] ✅
```

### Quick troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Environment variable "GITHUB_TOKEN" is required but not set` | `github` block is in config but token missing from Claude Desktop env | Add `"GITHUB_TOKEN": "ghp_..."` to the `env` block |
| `list_repos` returns nothing | `defaultOwner` is still `"your-github-username"` placeholder | Replace with your real GitHub username |
| 404 on private repos | Token scope is `public_repo` | Regenerate with `repo` scope |
| Want to disable GitHub temporarily | Remove the `github` block from config | The `GITHUB_TOKEN` env var can stay — it's ignored when the block is absent |

---

## Step 7 — First conversations

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
