# Environment Variables Guide

cms-mcp never stores secrets in its config file. Instead, any value prefixed with `env:` is read from an environment variable at runtime:

```json
"token": "env:CMS_API_TOKEN"
```

This means `CMS_API_TOKEN` must exist in the environment where cms-mcp runs. This guide explains what each variable is, how to get it, and how to set it.

---

## All variables at a glance

| Variable | Used for | Required? |
|----------|----------|-----------|
| `CMS_API_TOKEN` | Authenticating with your CMS/backend | Yes (if auth type is bearer/api-key) |
| `GITHUB_TOKEN` | Reading repos for `scan_repo`, `list_repos` | Only if `github` plugin enabled |
| `OPENAI_API_KEY` | Semantic search with real embeddings | Only if `embedding.provider: "openai"` |
| `WEBHOOK_SECRET` | Verifying GitHub webhook signatures | Only if webhook mode enabled |

---

## `CMS_API_TOKEN`

This is an API token (also called an API key, access token, or personal access token) issued by your CMS or backend. It proves to your API that cms-mcp is allowed to read and write data.

### How to get it — by platform

---

#### Supabase

1. Open your project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Go to **Project Settings → API**
3. Under **Project API keys**, copy the **`anon` key** (safe for server-side use with RLS policies) or the **`service_role` key** (full admin access — use carefully)

```json
"auth": {
  "type": "api-key",
  "header": "apikey",
  "token": "env:CMS_API_TOKEN"
}
```

> The anon key works for most use cases if you have Row Level Security set up. Use service_role only if you need to bypass RLS.

---

#### PocketBase

1. Start your PocketBase instance
2. Open the Admin UI at `http://localhost:8090/_/`
3. Log in with your admin account
4. Go to **Settings → API Rules** — by default all admin operations require authentication
5. To get a token, make a POST request to your PocketBase API:

```bash
curl -X POST https://your-pocketbase.com/api/collections/users/auth-with-password \
  -H "Content-Type: application/json" \
  -d '{"identity": "admin@example.com", "password": "yourpassword"}'
```

The response contains a `token` field — use that value.

```json
"auth": {
  "type": "bearer",
  "token": "env:CMS_API_TOKEN"
}
```

> PocketBase tokens expire. For long-running use, create a dedicated admin account and use its credentials to generate a fresh token when needed. PocketBase v0.20+ supports permanent API keys in Settings → API Keys.

---

#### Payload CMS

1. Go to your Payload Admin panel (usually `http://localhost:3000/admin`)
2. Log in as an admin user
3. To get a token via API:

```bash
curl -X POST https://your-payload-api.com/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "yourpassword"}'
```

The response contains a `token` field.

Alternatively, use **API Keys** (Payload v2+):
1. Go to your Payload admin panel
2. Open the **Users** collection
3. Edit your user → enable **API Key** → copy the generated key

```json
"auth": {
  "type": "bearer",
  "token": "env:CMS_API_TOKEN"
}
```

---

#### Directus

1. Open your Directus Admin panel
2. Go to **Settings → Access Tokens** (or **User Management → your user → Token**)
3. Click **Create Token** → give it a name → copy the value

Or generate via API:

```bash
curl -X POST https://your-directus.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@example.com", "password": "yourpassword"}'
```

Use the `access_token` from the response. For a static token, use the Directus admin panel to create a permanent token.

```json
"auth": {
  "type": "bearer",
  "token": "env:CMS_API_TOKEN"
}
```

---

#### Strapi

1. Open your Strapi Admin panel (usually `http://localhost:1337/admin`)
2. Go to **Settings → API Tokens**
3. Click **Create new API Token**
4. Set a name, select type (**Full access** or **Custom**), set expiry
5. Copy the generated token immediately — it won't be shown again

```json
"auth": {
  "type": "bearer",
  "token": "env:CMS_API_TOKEN"
}
```

> Strapi API tokens can have expiry dates. Choose "Unlimited" if you want it to work without rotation.

---

#### Custom Next.js / Express / FastAPI backend

If you built your own backend, you control how authentication works. Common patterns:

**Option 1 — Static secret in your backend code**

Set an environment variable in your backend (e.g., `MY_CMS_SECRET=abc123`). In each API route, check for it:

```typescript
// Next.js route handler
if (req.headers.authorization !== `Bearer ${process.env.MY_CMS_SECRET}`) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

Then set `CMS_API_TOKEN=abc123` in your cms-mcp environment.

**Option 2 — JWT from a login endpoint**

```bash
curl -X POST https://your-api.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "yourpassword"}'
# → { "token": "eyJhbG..." }
```

Use the returned JWT as your `CMS_API_TOKEN`.

**Option 3 — No auth (`"type": "none"`)**

If your API is local-only or protected by network rules and doesn't require a token:

```json
"auth": { "type": "none" }
```

---

#### Sanity

1. Go to [sanity.io/manage](https://sanity.io/manage)
2. Select your project → **API → Tokens**
3. Click **Add API token** → set a label and permissions → **Save**
4. Copy the token value

```json
"auth": {
  "type": "bearer",
  "token": "env:CMS_API_TOKEN"
}
```

---

#### Contentful

1. Go to [app.contentful.com](https://app.contentful.com)
2. Select your space → **Settings → API keys**
3. Click **Add API key** or use the default one
4. Copy the **Content Delivery API access token** (read) or **Content Management API token** (read+write)

For read+write you need a **Personal Access Token**:
1. Go to **Profile → Personal access tokens**
2. Click **Generate personal token** → copy it

```json
"auth": {
  "type": "bearer",
  "token": "env:CMS_API_TOKEN"
}
```

---

### No token? Check if your API needs one

Some self-hosted APIs in development mode have no auth. Try:

```bash
curl https://your-api.com/api/posts
```

If it returns data without a token, use `"type": "none"`.

---

## `GITHUB_TOKEN`

Required if you enable the `github` plugin (`scan_repo`, `sync_repo_to_project`, `list_repos`).

### How to get it

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Set a note (e.g., "cms-mcp")
4. Select scopes:
   - `repo` — read access to your private repositories
   - `public_repo` — if you only need public repos
5. Click **Generate token** → copy the value immediately

Or use a **Fine-grained personal access token** (recommended):
1. Go to [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token**
3. Set repository access → **Only select repositories** → pick the ones you need
4. Under Permissions → **Contents: Read-only**
5. Generate and copy

```json
"github": {
  "token": "env:GITHUB_TOKEN",
  "defaultOwner": "your-github-username"
}
```

---

## `OPENAI_API_KEY`

Required only if you set `"embedding": { "provider": "openai" }`. Enables true semantic similarity search instead of TF-IDF.

### How to get it

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Click **Create new secret key** → give it a name → copy the value

> OpenAI API keys start with `sk-`. They are billed per-use. The `text-embedding-3-small` model used by default costs ~$0.00002 per 1K tokens — very cheap for typical CMS content.

```json
"embedding": {
  "provider": "openai",
  "apiKey": "env:OPENAI_API_KEY",
  "model": "text-embedding-3-small"
}
```

> **No OpenAI account?** Skip the `embedding` block entirely. cms-mcp uses TF-IDF (keyword-based) search by default — no API key needed, just add `schemaCache`.

---

## `WEBHOOK_SECRET`

Required only if you enable GitHub webhook mode (`--webhook` flag + `"webhook"` config block). Used to verify that incoming webhook payloads actually came from GitHub.

### How to generate one

Generate a random secret — any long random string works:

```bash
# macOS / Linux
openssl rand -hex 32
# → a1b2c3d4e5f6...

# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use the same value in two places:

**1. cms-mcp config:**
```json
"webhook": {
  "port": 3001,
  "secret": "env:WEBHOOK_SECRET",
  "path": "/webhook"
}
```

**2. GitHub webhook settings:**
1. Open your repo on GitHub → **Settings → Webhooks → Add webhook**
2. Set **Payload URL** to your public URL (e.g., via ngrok)
3. Set **Content type** to `application/json`
4. Paste the same random string into **Secret**
5. Select **Just the push event**
6. Click **Add webhook**

---

## How to set environment variables

### Option 1 — Terminal (current session only)

```bash
# macOS / Linux
export CMS_API_TOKEN=your-token-here
export GITHUB_TOKEN=ghp_...
npx cms-mcp --config ./cms-mcp.config.json

# Windows (Command Prompt)
set CMS_API_TOKEN=your-token-here
cms-mcp --config ./cms-mcp.config.json

# Windows (PowerShell)
$env:CMS_API_TOKEN="your-token-here"
cms-mcp --config ./cms-mcp.config.json
```

### Option 2 — `.env` file (persistent, local dev)

Create a `.env` file in your project root:

```
CMS_API_TOKEN=your-token-here
GITHUB_TOKEN=ghp_...
OPENAI_API_KEY=sk-...
WEBHOOK_SECRET=a1b2c3...
```

Load it before running (using `dotenv-cli`):

```bash
npx dotenv-cli -- npx cms-mcp --config ./cms-mcp.config.json
```

> **Never commit your `.env` file to git.** Add it to `.gitignore`.

### Option 3 — Claude Desktop config (recommended for Claude Desktop)

Pass variables directly in your Claude Desktop MCP server config:

```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "npx",
      "args": ["cms-mcp", "--config", "/path/to/cms-mcp.config.json"],
      "env": {
        "CMS_API_TOKEN": "your-token-here",
        "GITHUB_TOKEN": "ghp_...",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```

This is the most common approach — tokens live in the Claude Desktop config, not in your project files.

### Option 4 — Claude Code `.claude/settings.json`

```json
{
  "mcpServers": {
    "cms-mcp": {
      "command": "npx",
      "args": ["cms-mcp", "--config", "./cms-mcp.config.json"],
      "env": {
        "CMS_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Option 5 — System environment (persistent, all sessions)

```bash
# macOS / Linux — add to ~/.bashrc or ~/.zshrc
echo 'export CMS_API_TOKEN=your-token-here' >> ~/.zshrc
source ~/.zshrc

# Windows — set a permanent user environment variable
[System.Environment]::SetEnvironmentVariable("CMS_API_TOKEN", "your-token-here", "User")
```

---

## Security tips

- **Never put tokens directly in `cms-mcp.config.json`** — use the `env:` prefix so secrets don't end up in config files that might be committed to git
- **Never commit `.env` files** — add `.env` to your `.gitignore`
- **Use the minimum permissions needed** — read-only tokens if you only need to list/get; read+write if you need create/update/delete
- **Rotate tokens periodically** — especially if they were ever logged or exposed
- cms-mcp **redacts all tokens from audit logs** — any key matching `token`, `key`, `secret`, `auth`, `credential` is replaced with `[redacted length=N]`
