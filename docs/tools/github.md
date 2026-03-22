# GitHub Tools Reference

cms-mcp exposes 3 tools for interacting with GitHub repositories. These tools let Claude scan your repos, detect tech stacks, and auto-populate project entries in your CMS — eliminating the manual work of describing every project you've built.

All GitHub tools require the `github` block to be configured:

```json
"github": {
  "token": "env:GITHUB_TOKEN",
  "defaultOwner": "your-github-username"
}
```

---

## Tool overview

| Tool | Type | Description |
|------|------|-------------|
| `list_repos` | Read | List repositories for a GitHub user/org |
| `scan_repo` | Read | Analyze a repo and detect its tech stack |
| `sync_repo_to_project` | Write | Create or update a CMS project from a repo scan |

---

## `list_repos`

Lists repositories for a GitHub user or organization. Useful for discovering what repos exist before scanning them.

### Inputs

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `owner` | string | `github.defaultOwner` | GitHub username or org name |
| `type` | `"all" \| "public" \| "private" \| "forks"` | `"public"` | Filter by repo visibility/type |
| `limit` | integer (1–100) | `30` | Maximum number of results |
| `sort` | `"updated" \| "created" \| "pushed" \| "full_name"` | `"updated"` | Sort order |

### Example conversation

```
You: List my GitHub repos.

Claude: [calls list_repos with owner from defaultOwner]

Found 12 repositories:

• ai-image-generator — TypeScript · Updated 2 days ago
• portfolio-v3 — TypeScript · Updated 1 week ago
• weather-app — React Native · Updated 2 weeks ago
• ml-pipeline-dashboard — Python · Updated 1 month ago
• blog-api — Node.js · Updated 1 month ago
...
```

---

## `scan_repo`

Analyzes a GitHub repository to detect its tech stack, generate a project description, extract the README, and gather metadata. Does **not** clone the repo — it uses the GitHub API to read file listings and key files (README, `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `composer.json`, etc.).

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Full GitHub repo URL |
| `owner` | string | GitHub username (alternative to URL) |
| `repo` | string | Repository name (alternative to URL) |

At least one of `url` or the `owner`/`repo` pair is required.

### URL format examples

All of these are valid:

```
https://github.com/yourname/my-project
https://github.com/yourname/my-project.git
github.com/yourname/my-project
yourname/my-project    (shorthand — uses defaultOwner if owner omitted)
```

### Detected technologies (30+)

The scanner checks for technology signals across the repository's file tree, dependency files, and configuration files:

**Frontend frameworks:**
`React`, `Next.js`, `Vue.js`, `Nuxt`, `Svelte`, `SvelteKit`, `Astro`, `Remix`, `Angular`

**Languages:**
`TypeScript`, `JavaScript`, `Python`, `Rust`, `Go`, `Ruby`, `PHP`, `Java`, `Kotlin`, `Swift`, `C#`

**Backend / runtime:**
`Node.js`, `Express`, `Fastify`, `NestJS`, `Django`, `Flask`, `FastAPI`, `Rails`, `Laravel`

**Databases / backends:**
`Supabase`, `PocketBase`, `Firebase`, `PostgreSQL`, `MongoDB`, `MySQL`, `SQLite`, `Redis`, `Prisma`, `Drizzle`

**Infrastructure / deployment:**
`Vercel`, `Netlify`, `Cloudflare Workers`, `Docker`, `Kubernetes`, `AWS`, `Railway`

**UI / styling:**
`Tailwind CSS`, `shadcn/ui`, `Chakra UI`, `Material UI`, `Styled Components`

**AI / ML:**
`OpenAI`, `Anthropic`, `LangChain`, `Hugging Face`, `PyTorch`, `TensorFlow`

**Mobile:**
`React Native`, `Expo`, `Flutter`

### How tech stack detection works

The scanner uses a signal-priority system. For each technology, it checks multiple evidence sources and assigns confidence based on the strength of the signal:

| Signal | Strength | Example |
|--------|----------|---------|
| Listed in `dependencies`/`devDependencies` | High | `"next": "^15.0.0"` in `package.json` |
| Import statement in source files | High | `import { createClient } from '@supabase/supabase-js'` |
| Config file present | Medium | `tailwind.config.ts` exists |
| Directory name | Medium | `prisma/` directory exists |
| README mention | Low | "Built with Next.js" in README |

Only technologies with at least one high-confidence signal are included by default. Low-confidence-only detections are filtered out to avoid false positives.

### Example conversation

```
You: Scan my repo github.com/yourname/ai-image-generator

Claude: [calls scan_repo]

Scan complete for yourname/ai-image-generator:

**Detected tech stack:**
Next.js, TypeScript, OpenAI, Tailwind CSS, Vercel, Shadcn/ui

**Repository info:**
- Stars: 47
- Language: TypeScript
- Last pushed: 2026-03-20
- Topics: ai, nextjs, openai, image-generation

**README summary:**
An AI-powered image generation app built with Next.js 15 and the OpenAI Images API.
Supports multiple styles, prompt history, and one-click Vercel deployment.

**Suggested project entry:**
Title: AI Image Generator
Summary: AI-powered image generation using Next.js and OpenAI
Tech stack: Next.js, TypeScript, OpenAI, Tailwind CSS
Live URL: https://ai-gen.vercel.app (from README badges)
Repo URL: https://github.com/yourname/ai-image-generator
```

---

## `sync_repo_to_project`

Scans a repository and creates or updates a CMS project entry from the scan results. If a project with a matching `repo_url` already exists, it is updated (after a diff preview). If no match is found, a new project is created.

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | GitHub repo URL |
| `owner` | string | GitHub username (if not using URL) |
| `repo` | string | Repository name (if not using URL) |
| `status` | `"draft" \| "published"` | Status for the created/updated project. Default: `"draft"` |
| `overwrite_description` | boolean | If updating an existing project, overwrite the description with the scanned README content. Default: `false` |
| `confirm` | `true` (literal) | Required for the write |

### Example conversation

```
You: Sync my ai-image-generator repo to a project entry.

Claude: [calls scan_repo internally, then preview_create_project]

## New Record Preview

| Field | Value |
|-------|-------|
| **title** | AI Image Generator |
| **summary** | AI-powered image generation using Next.js and OpenAI |
| **tech_stack** | Next.js, TypeScript, OpenAI, Tailwind CSS, Vercel |
| **repo_url** | https://github.com/yourname/ai-image-generator |
| **live_url** | https://ai-gen.vercel.app |
| **status** | draft |

---
Reply confirm to create, or cancel to abort.

You: confirm

Claude: [calls sync_repo_to_project with confirm: true]
✅ Project created from repo scan!

ID: proj_img1
Title: AI Image Generator
Status: draft
Tech stack: Next.js, TypeScript, OpenAI, Tailwind CSS, Vercel
```

### Updating an existing project

```
You: Re-sync the ai-image-generator — I've added Framer Motion since it was last synced.

Claude: [calls scan_repo, finds existing project by repo_url]
[calls preview_update_project]

## Proposed Changes (1 field)

| Field | Current Value | Proposed Value |
|-------|--------------|----------------|
| **tech_stack** | Next.js, TypeScript, OpenAI, Tailwind CSS, Vercel | Next.js, TypeScript, OpenAI, Tailwind CSS, Vercel, Framer Motion |

---
Reply confirm to apply, or cancel to abort.

You: confirm
✅ Project proj_img1 updated successfully.
```

---

## GitHub token requirements

| Use case | Required scope |
|----------|---------------|
| Public repos only | `public_repo` |
| Private repos | `repo` |
| Organization repos | `read:org` (in addition to above) |

Create a Personal Access Token (classic) or fine-grained token at `https://github.com/settings/tokens`.

Fine-grained tokens require: **Repository contents: Read-only** and, for org repos, **Organization metadata: Read-only**.

---

## Rate limiting

The GitHub REST API allows 5,000 requests/hour for authenticated requests. Scanning one repository typically uses 3–8 API calls (repo metadata, file tree, reading key files). You can scan approximately 600–1,600 repos per hour before hitting the limit.

For large-scale syncing, cms-mcp respects `X-RateLimit-Remaining` headers and will surface a clear error if the limit is approaching rather than letting requests fail silently.
