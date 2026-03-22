# Project Tools Reference

cms-mcp exposes 8 tools for managing portfolio projects. All tools require the `endpoints.projects` URL to be set in your config. Write tools (`create_project`, `update_project`, `publish_project`, `delete_project`) are disabled when `readOnly: true`.

---

## Tool overview

| Tool | Type | Description |
|------|------|-------------|
| `list_projects` | Read | List all projects with optional filters |
| `get_project` | Read | Fetch a single project by ID or slug |
| `preview_create_project` | Read | Preview a new project before creating |
| `create_project` | Write | Create a new project (requires `confirm: true`) |
| `preview_update_project` | Read | Show a diff of proposed changes |
| `update_project` | Write | Apply changes to an existing project |
| `publish_project` | Write | Set project status to `published` |
| `delete_project` | Write | Permanently delete a project |

---

## `list_projects`

Returns a formatted list of projects, optionally filtered by status or search query.

### Inputs

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | `"all" \| "draft" \| "published" \| "archived"` | `"all"` | Filter by project status |
| `limit` | integer (1–100) | `20` | Maximum number of results |
| `search` | string | — | Full-text search query |

### Example conversation

```
You: Show me all my draft projects.

Claude: [calls list_projects with status: "draft"]

Found 2 project(s):

• [proj_abc] AI Chat Widget (draft)
• [proj_def] Portfolio Redesign (draft)
```

```
You: Search for any projects related to "machine learning".

Claude: [calls list_projects with search: "machine learning"]

Found 1 project(s):

• [proj_xyz] ML Pipeline Dashboard (published)
```

---

## `get_project`

Fetches the full JSON record for a single project.

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Project ID or URL slug |

### Example conversation

```
You: Show me the full details for project proj_abc.

Claude: [calls get_project with id: "proj_abc"]

{
  "id": "proj_abc",
  "title": "AI Chat Widget",
  "slug": "ai-chat-widget",
  "status": "draft",
  "tech_stack": ["React", "OpenAI", "TypeScript"],
  "live_url": null,
  "repo_url": "https://github.com/you/ai-chat-widget",
  "cover_image": null,
  "seo_title": null,
  "seo_description": null,
  "created_at": "2026-03-01T10:00:00.000Z"
}
```

---

## `preview_create_project`

Validates all fields and renders a preview table **before** anything touches the API. Claude will always call this before `create_project` unless you explicitly ask to skip the preview.

### Inputs

Same as `create_project` (see below), but without `confirm`.

### Example output

```
## New Record Preview

| Field | Value |
|-------|-------|
| **title** | AI Chat Widget |
| **tech_stack** | React, OpenAI, TypeScript |
| **repo_url** | https://github.com/you/ai-chat-widget |
| **status** | draft |
| **is_featured** | false |

---
Reply confirm to create, or cancel to abort.
```

If validation fails:

```
❌ Validation error — fix these before creating:
  • title: String must contain at least 1 character(s)
  • live_url: Invalid url
```

---

## `create_project`

Creates a new project record. Requires `confirm: true` to prevent accidental writes. Uses the transaction engine internally — if the API call fails partway through, any partial state is rolled back.

### Inputs

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `title` | string | 1–200 chars | Project title (required) |
| `summary` | string | max 500 chars | One-line tagline shown in cards |
| `description` | string | — | Full description, markdown supported |
| `slug` | string | `[a-z0-9-]+` | URL slug — auto-generated from title if omitted |
| `tech_stack` | string[] | — | Technologies used, e.g. `["Next.js", "Supabase"]` |
| `live_url` | string | valid URL | Live demo link |
| `repo_url` | string | valid URL | GitHub/GitLab repository URL |
| `cover_image` | string | valid URL | Cover image URL |
| `tags` | string[] | — | Tags for filtering |
| `status` | `"draft" \| "published" \| "archived"` | — | Default: `"draft"` |
| `is_featured` | boolean | — | Default: `false` |
| `seo_title` | string | max 70 chars | SEO meta title |
| `seo_description` | string | max 160 chars | SEO meta description |
| `confirm` | `true` (literal) | **required** | Must be explicitly `true` |

### Example conversation

```
You: Create a project for my new weather app. It uses React Native and the OpenWeatherMap API.
     The repo is github.com/you/weather-app. Keep it as a draft.

Claude: Let me preview that first.
[calls preview_create_project]

## New Record Preview

| Field | Value |
|-------|-------|
| **title** | Weather App |
| **tech_stack** | React Native, OpenWeatherMap API |
| **repo_url** | https://github.com/you/weather-app |
| **status** | draft |

---
Reply confirm to create, or cancel to abort.

You: Looks good, confirm.

Claude: [calls create_project with confirm: true]
✅ Project created!

ID: proj_m7nQ2
Title: Weather App
Status: draft
```

---

## `preview_update_project`

Fetches the current state of a project from the API and renders a diff table showing exactly what will change. Unchanged fields are omitted.

### Inputs

Same as `update_project` (see below), but without `confirm`.

### Example output

```
## Proposed Changes (2 fields)

| Field | Current Value | Proposed Value |
|-------|--------------|----------------|
| **status** | draft | published |
| **live_url** | *(empty)* | https://weather-app.vercel.app |

*5 unchanged fields omitted.*

---
Reply confirm to apply, or cancel to abort.
```

---

## `update_project`

Applies a partial update (PATCH) to an existing project. Only the fields you provide are changed. The current state is saved before the update so it can be rolled back on failure.

### Inputs

All fields from `create_project` are optional here, plus:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | **Required.** Project ID to update |
| `confirm` | `true` (literal) | **Required.** Must be explicitly `true` |

### Example conversation

```
You: Update the Weather App project — add the live URL https://weather-app.vercel.app
     and add "Expo" to the tech stack.

Claude: [calls preview_update_project first]

## Proposed Changes (2 fields)

| Field | Current Value | Proposed Value |
|-------|--------------|----------------|
| **live_url** | *(empty)* | https://weather-app.vercel.app |
| **tech_stack** | React Native, OpenWeatherMap API | React Native, OpenWeatherMap API, Expo |

---
Reply confirm to apply, or cancel to abort.

You: confirm

Claude: [calls update_project with confirm: true]
✅ Project proj_m7nQ2 updated successfully.
```

---

## `publish_project`

Sets the project's `status` to `"published"`. A focused shortcut — equivalent to `update_project` with `status: "published"`, but with a single-purpose interface.

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Project ID to publish |
| `confirm` | `true` (literal) | Required |

### Example conversation

```
You: Publish the Weather App.

Claude: [calls publish_project with id: "proj_m7nQ2", confirm: true]
✅ Project proj_m7nQ2 is now published and live.
```

---

## `delete_project`

Permanently deletes a project. This operation is **irreversible** — there is no trash or soft-delete. Claude will always ask for confirmation before calling this tool.

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Project ID to delete |
| `confirm` | `true` (literal) | Required — this is irreversible |

### Example conversation

```
You: Delete the old "Bootstrap Portfolio" project, id proj_old1.

Claude: Are you sure? Deleting proj_old1 is permanent and cannot be undone.
If you're certain, say "yes delete it".

You: Yes, delete it.

Claude: [calls delete_project with id: "proj_old1", confirm: true]
🗑️ Project proj_old1 deleted.
```

---

## Response normalization

The list tools understand several common API response shapes. Your API can return projects as a top-level array or wrapped in any of these keys:

```json
{ "items": [...] }
{ "data": [...] }
{ "results": [...] }
{ "projects": [...] }
```

All of these are handled automatically — no config required.

---

## Read-only mode

When `readOnly: true` is set in your config, any attempt to call a write tool returns:

```
🔒 "create_project" is disabled — server is running in read-only mode.
```

The read tools (`list_projects`, `get_project`, `preview_create_project`, `preview_update_project`) continue to work normally.
