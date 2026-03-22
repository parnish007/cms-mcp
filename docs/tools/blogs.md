# Blog Tools Reference

cms-mcp exposes 9 tools for managing blog posts. All tools require the `endpoints.blogs` URL to be set in your config. Write tools are disabled when `readOnly: true`.

---

## Tool overview

| Tool | Type | Description |
|------|------|-------------|
| `list_blogs` | Read | List all posts with optional filters |
| `get_blog` | Read | Fetch a single post by ID or slug |
| `preview_create_blog` | Read | Preview a new post before creating |
| `create_blog` | Write | Create a new post (requires `confirm: true`) |
| `preview_update_blog` | Read | Show a diff of proposed changes |
| `update_blog` | Write | Apply changes to an existing post |
| `publish_blog` | Write | Set post status to `published` and stamp `published_at` |
| `unpublish_blog` | Write | Revert post back to `draft` |
| `delete_blog` | Write | Permanently delete a post |

---

## `list_blogs`

Returns a formatted list of blog posts with optional filtering.

### Inputs

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | `"all" \| "draft" \| "published"` | `"all"` | Filter by post status |
| `limit` | integer (1–100) | `20` | Maximum number of results |
| `search` | string | — | Search by title or content |

### Example conversation

```
You: List all my published blog posts.

Claude: [calls list_blogs with status: "published"]

Found 3 post(s):

• [blog_a1] Building a Design System (published)
• [blog_b2] Why I Switched to Next.js (published)
• [blog_c3] TypeScript Generics Deep Dive (published)
```

```
You: Do I have any drafts?

Claude: [calls list_blogs with status: "draft"]

Found 2 post(s):

• [blog_d4] Getting Started with Supabase (draft)
• [blog_e5] My Thoughts on AI Coding Tools (draft)
```

---

## `get_blog`

Fetches the full JSON record for a single blog post, including body content and all metadata.

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Blog post ID or URL slug |

### Example conversation

```
You: Show me the full details of the Supabase draft post.

Claude: [calls get_blog with id: "blog_d4"]

{
  "id": "blog_d4",
  "title": "Getting Started with Supabase",
  "slug": "getting-started-with-supabase",
  "status": "draft",
  "body": "# Getting Started with Supabase\n\nSupabase is an open-source...",
  "excerpt": "A practical guide to building with Supabase.",
  "cover_image": "https://my-site.vercel.app/images/supabase-cover.jpg",
  "tags": ["supabase", "database", "nextjs"],
  "reading_time": 8,
  "seo_title": null,
  "seo_description": null,
  "published_at": null,
  "created_at": "2026-03-10T09:00:00.000Z"
}
```

---

## `preview_create_blog`

Validates all fields and renders a preview table before anything touches the API. Catches validation errors (title too long, invalid URLs, missing required fields) before the write operation.

### Inputs

Same as `create_blog`, but without `confirm`.

### Example output

```
## New Record Preview

| Field | Value |
|-------|-------|
| **title** | Getting Started with Supabase |
| **body** | # Getting Started with Supabase\n\nSupabase is... |
| **excerpt** | A practical guide to building with Supabase. |
| **tags** | supabase, database, nextjs |
| **reading_time** | 8 |
| **status** | draft |

---
Reply confirm to create, or cancel to abort.
```

---

## `create_blog`

Creates a new blog post. Requires `confirm: true`. Internally uses the transaction engine — partial failures are rolled back automatically.

### Inputs

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `title` | string | 1–200 chars | Post title (required) |
| `body` | string | min 1 char | Full post content in markdown (required) |
| `excerpt` | string | max 300 chars | Short preview shown in listing pages |
| `slug` | string | `[a-z0-9-]+` | URL slug — auto-generated from title if omitted |
| `cover_image` | string | valid URL | Cover image URL |
| `tags` | string[] | — | Tags for categorization |
| `status` | `"draft" \| "published"` | — | Default: `"draft"` |
| `published_at` | string | ISO 8601 datetime | Override publish timestamp |
| `reading_time` | integer | min 1 | Estimated reading time in minutes |
| `seo_title` | string | max 70 chars | SEO meta title |
| `seo_description` | string | max 160 chars | SEO meta description |
| `confirm` | `true` (literal) | **required** | Must be explicitly `true` |

### Example conversation

```
You: Create a blog post titled "Deploying to Vercel in 5 Minutes".
     The body should be:

     Vercel makes deployment stupidly simple. Here's how to go from zero to live
     in under 5 minutes...

     Tag it with "vercel", "deployment", "nextjs". Add a reading time of 3 minutes.

Claude: Let me preview that first.
[calls preview_create_blog]

## New Record Preview

| Field | Value |
|-------|-------|
| **title** | Deploying to Vercel in 5 Minutes |
| **body** | Vercel makes deployment stupidly simple. Here's... |
| **tags** | vercel, deployment, nextjs |
| **reading_time** | 3 |
| **status** | draft |

---
Reply confirm to create, or cancel to abort.

You: confirm

Claude: [calls create_blog with confirm: true]
✅ Blog post created!

ID: blog_f6
Title: Deploying to Vercel in 5 Minutes
Status: draft
```

---

## `preview_update_blog`

Fetches the current post from the API and produces a field-level diff showing exactly what would change. Unchanged fields are omitted from the output.

### Inputs

All fields from `create_blog` are optional here, plus:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | **Required.** Blog post ID |

### Example output

```
## Proposed Changes (3 fields)

| Field | Current Value | Proposed Value |
|-------|--------------|----------------|
| **excerpt** | *(empty)* | A practical guide to building with Supabase. |
| **seo_title** | *(empty)* | Getting Started with Supabase - Tutorial |
| **seo_description** | *(empty)* | Learn how to set up Supabase with Next.js in this step-by-step tutorial. |

*8 unchanged fields omitted.*

---
Reply confirm to apply, or cancel to abort.
```

---

## `update_blog`

Applies a partial update (PATCH) to an existing blog post. Only the fields you supply are modified. The pre-update state is captured for rollback on failure.

### Inputs

All fields from `create_blog` are optional here, plus:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | **Required.** Blog post ID |
| `confirm` | `true` (literal) | **Required** |

### Example conversation

```
You: Update the Supabase post — add an excerpt "A practical guide to building with Supabase."
     and fill in the SEO fields.

Claude: [calls preview_update_blog first]

## Proposed Changes (3 fields)

| Field | Current Value | Proposed Value |
|-------|--------------|----------------|
| **excerpt** | *(empty)* | A practical guide to building with Supabase. |
| **seo_title** | *(empty)* | Getting Started with Supabase - Tutorial |
| **seo_description** | *(empty)* | Learn how to set up Supabase with Next.js in under 30 minutes. |

---
Reply confirm to apply, or cancel to abort.

You: confirm

Claude: [calls update_blog with confirm: true]
✅ Blog post blog_d4 updated successfully.
```

---

## `publish_blog`

Sets the post's `status` to `"published"` and stamps `published_at` with the current UTC timestamp. Use this to take a draft live.

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Blog post ID |
| `confirm` | `true` (literal) | Required |

### What it sends to your API

```json
{
  "status": "published",
  "published_at": "2026-03-22T14:30:00.000Z"
}
```

### Example conversation

```
You: Publish the Supabase tutorial.

Claude: [calls publish_blog with id: "blog_d4", confirm: true]
✅ Blog post blog_d4 is now published.
```

---

## `unpublish_blog`

Reverts a published post back to `draft` status. The `published_at` timestamp is not cleared — it records when the post was originally published.

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Blog post ID |
| `confirm` | `true` (literal) | Required |

### Example conversation

```
You: The Supabase post has outdated info. Take it down for now.

Claude: [calls unpublish_blog with id: "blog_d4", confirm: true]
↩️ Blog post blog_d4 moved back to draft.
```

---

## `delete_blog`

Permanently deletes a blog post. This is **irreversible**.

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Blog post ID |
| `confirm` | `true` (literal) | Required |

### Example conversation

```
You: Delete the draft post "My Thoughts on AI Coding Tools", id blog_e5.
     It was just me rambling, not worth keeping.

Claude: This will permanently delete blog_e5. Are you sure?

You: Yes.

Claude: [calls delete_blog with id: "blog_e5", confirm: true]
🗑️ Blog post blog_e5 deleted.
```

---

## Response normalization

The list tools recognize all of these common API response shapes:

```json
[...]
{ "items": [...] }
{ "data": [...] }
{ "results": [...] }
{ "blogs": [...] }
{ "posts": [...] }
```

---

## Read-only mode

When `readOnly: true`, write tools return:

```
🔒 "create_blog" is disabled — read-only mode.
```

Read tools (`list_blogs`, `get_blog`, `preview_create_blog`, `preview_update_blog`) continue to work normally.

---

## Typical content workflow

A full post lifecycle with cms-mcp looks like this:

```
1. list_blogs              → See what exists
2. preview_create_blog     → Draft the post, review fields
3. create_blog             → Confirm and create as draft
4. get_blog                → Review the created record
5. preview_update_blog     → Add SEO fields, fix excerpt
6. update_blog             → Apply the changes
7. publish_blog            → Take it live
8. unpublish_blog          → Pull it down if needed later
```
