# Media Tools Reference

cms-mcp exposes 3 tools for managing media assets. The upload tool works as a **server-side proxy** — it fetches the remote file on cms-mcp's behalf and forwards it to your CMS, so Claude never handles binary data directly and your CMS API key is never exposed to the source server.

---

## Tool overview

| Tool | Type | Description |
|------|------|-------------|
| `upload_media_from_url` | Write | Fetch a public URL and upload it to your media library |
| `list_media` | Read | List media assets in your library |
| `delete_media` | Write | Permanently delete a media asset |

Write tools are disabled when `readOnly: true`.

---

## `upload_media_from_url`

Downloads a file from a public URL and uploads it to your CMS media library as a multipart form upload. The fetch and upload happen inside the cms-mcp process — Claude only provides the URL.

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `url` | string (valid URL) | Public URL of the file to upload |
| `alt_text` | string | Accessible alt text (stored alongside the asset) |
| `folder` | string | Destination folder/path in your media library |

### Output

```
✅ Media uploaded successfully!

URL: https://my-site.vercel.app/media/hero-image-abc123.jpg
Filename: hero-image-abc123.jpg
Type: image/jpeg
Size: 284.3 KB
ID: media_9xkT3
```

### Example conversation

```
You: Upload this image to my media library: https://unsplash.com/photos/xyz/download
     Alt text: "A developer working at a standing desk"

Claude: [calls upload_media_from_url]
✅ Media uploaded successfully!

URL: https://my-site.vercel.app/media/developer-desk-a1b2c3.jpg
Filename: developer-desk-a1b2c3.jpg
Type: image/jpeg
Size: 412.7 KB
ID: media_r4s5t6

You: Great. Use that as the cover image for my next blog post about remote work.

Claude: [calls preview_create_blog with cover_image: "https://my-site.vercel.app/media/developer-desk-a1b2c3.jpg"]
...
```

### Supported MIME types

| Category | Types |
|----------|-------|
| Images | `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `image/svg+xml`, `image/avif` |
| Video | `video/mp4`, `video/webm`, `video/ogg` |
| Documents | `application/pdf` |
| Audio | `audio/mpeg`, `audio/ogg`, `audio/wav` |

Files with unsupported MIME types will be rejected before upload to prevent corrupted media entries in your library.

### Size limit

Files larger than **50 MB** are rejected. The limit is enforced by reading the `Content-Length` response header before downloading. If the server does not provide `Content-Length`, the file is streamed and the size is checked during download — the transfer is aborted if the limit is exceeded.

### SSRF protections

The upload proxy contains strict SSRF (Server-Side Request Forgery) protections to prevent it from being used as a proxy to reach internal services:

**Blocked URL targets:**
- `localhost` and `127.0.0.1`
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918 private ranges)
- `169.254.0.0/16` (link-local / AWS metadata endpoint `169.254.169.254`)
- `::1` and other IPv6 loopback addresses
- Redirect chains to any of the above (followed and re-checked)

**Blocked schemes:**
- `file://` — reading local files
- `gopher://` — legacy protocol abuse
- `data:` — inline data URIs

If a blocked target is detected, the tool returns an error immediately without making a network request:

```
Error: SSRF protection: URL resolves to a private/internal address and cannot be fetched.
```

---

## `list_media`

Returns a list of media assets from your CMS library. Requires `endpoints.media` to be configured.

### Inputs

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | integer (1–100) | `20` | Maximum number of results |
| `search` | string | — | Search by filename |

### Example conversation

```
You: Show me my recent media uploads.

Claude: [calls list_media]

Found 5 item(s):

• developer-desk-a1b2c3.jpg — https://my-site.vercel.app/media/developer-desk-a1b2c3.jpg
• supabase-cover.jpg — https://my-site.vercel.app/media/supabase-cover.jpg
• profile-photo.png — https://my-site.vercel.app/media/profile-photo.png
• og-default.jpg — https://my-site.vercel.app/media/og-default.jpg
• resume-2026.pdf — https://my-site.vercel.app/media/resume-2026.pdf
```

### Response normalization

The tool handles these common API response shapes:

```json
[...]
{ "items": [...] }
{ "data": [...] }
{ "results": [...] }
{ "assets": [...] }
{ "files": [...] }
{ "media": [...] }
```

Each item is displayed with its `filename` (or `name`) and `url` (or `secure_url` for Cloudinary-style APIs).

---

## `delete_media`

Permanently deletes a media asset by ID. This is **irreversible** — make sure the asset is not referenced by any blog posts or projects before deleting.

### Inputs

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Media asset ID |
| `confirm` | `true` (literal) | Required — this is irreversible |

### Example conversation

```
You: Delete the old profile photo — id media_oldphoto.

Claude: This will permanently delete media asset media_oldphoto. Are you sure?

You: Yes.

Claude: [calls delete_media with id: "media_oldphoto", confirm: true]
🗑️ Media media_oldphoto deleted.
```

---

## Configuration requirements

The media endpoint must be set in your config for `list_media` and `delete_media`:

```json
"endpoints": {
  "media": "https://my-site.vercel.app/api/media"
}
```

`upload_media_from_url` uses a separate upload endpoint that is typically the same URL. If your CMS uses a different upload endpoint (e.g., a multipart-specific route), configure it accordingly in your API client or middleware.

---

## Security notes

- The upload proxy **never** passes your CMS authentication token to the source URL — it only uses auth headers when communicating with your `endpoints.media` URL.
- All uploads are logged to the audit log (if configured) with the source URL, MIME type, and file size.
- In read-only mode, `upload_media_from_url` and `delete_media` are blocked; `list_media` continues to work.
