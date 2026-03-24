# Blog Tools (Deprecated)

> **This page describes the v0.3.x hardcoded blog tools, which were removed in v0.4.0.**
>
> Since v0.4.0, cms-mcp generates tools dynamically from your configured endpoints. Since v0.5.0, every endpoint gets exactly 3 tools: `list_X`, `get_X`, and `mutate_X`.
>
> **See [Generic Resource Tools](./generic-resource.md) for current documentation.**

---

## What replaced these tools

| Old tool (v0.3.x) | Replacement (v0.5.0) |
|-------------------|----------------------|
| `list_blogs` | `list_blogs` (same name, schema-driven) |
| `get_blog` | `get_blogs` |
| `preview_create_blog` | `mutate_blogs({ action: "preview", data: {...} })` |
| `create_blog` | `mutate_blogs({ action: "create", data: {...}, confirm: true })` |
| `preview_update_blog` | `mutate_blogs({ action: "preview", id: "...", data: {...} })` |
| `update_blog` | `mutate_blogs({ action: "update", id: "...", data: {...}, confirm: true })` |
| `publish_blog` | `mutate_blogs({ action: "update", id: "...", data: { status: "published" }, confirm: true })` |
| `unpublish_blog` | `mutate_blogs({ action: "update", id: "...", data: { status: "draft" }, confirm: true })` |
| `delete_blog` | `mutate_blogs({ action: "delete", id: "...", confirm: true })` |

For full documentation on how the current tools work, see [Generic Resource Tools](./generic-resource.md).

For upgrade instructions, see [Migration Guide v0.5](../migration-v0.5.md).
