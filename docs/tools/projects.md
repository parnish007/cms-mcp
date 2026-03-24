# Project Tools (Deprecated)

> **This page describes the v0.3.x hardcoded project tools, which were removed in v0.4.0.**
>
> Since v0.4.0, cms-mcp generates tools dynamically from your configured endpoints. Since v0.5.0, every endpoint gets exactly 3 tools: `list_X`, `get_X`, and `mutate_X`.
>
> **See [Generic Resource Tools](./generic-resource.md) for current documentation.**

---

## What replaced these tools

| Old tool (v0.3.x) | Replacement (v0.5.0) |
|-------------------|----------------------|
| `list_projects` | `list_projects` (same name, schema-driven) |
| `get_project` | `get_projects` |
| `preview_create_project` | `mutate_projects({ action: "preview", data: {...} })` |
| `create_project` | `mutate_projects({ action: "create", data: {...}, confirm: true })` |
| `preview_update_project` | `mutate_projects({ action: "preview", id: "...", data: {...} })` |
| `update_project` | `mutate_projects({ action: "update", id: "...", data: {...}, confirm: true })` |
| `publish_project` | `mutate_projects({ action: "update", id: "...", data: { status: "published" }, confirm: true })` |
| `delete_project` | `mutate_projects({ action: "delete", id: "...", confirm: true })` |

For full documentation on how the current tools work, see [Generic Resource Tools](./generic-resource.md).

For upgrade instructions, see [Migration Guide v0.5](../migration-v0.5.md).
