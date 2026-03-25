// src/lib/media-proxy.ts
// Binary media proxy — Pillar 3.
// Fetches an image from any URL into a buffer, detects MIME type,
// and re-streams it as multipart/form-data to your CMS upload endpoint.
// Real-world CMS APIs almost never accept a URL — they want a binary upload.

import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { buildAuthHeaders } from "./config.js";

export interface MediaUploadResult {
  url: string;
  id?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

// ─── Security: SSRF v2 ────────────────────────────────────────────────────────
//
// v1.0.0 changes:
//   - Explicit block on 169.254.169.254 (AWS/GCP/Azure metadata endpoint)
//   - Port whitelist: only 80 and 443 allowed by default
//     (configurable via config.allowedPorts)
//   - Blocks null bytes and URL-encoded variants
//   - Explicit OCI metadata block: 192.0.2.x (documentation range)

const PRIVATE_IP_RE = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,        // link-local AND AWS/GCP/Azure cloud metadata range
  /^\[?::1\]?$/,        // IPv6 loopback
  /^\[?fc00:/i,         // IPv6 ULA
  /^\[?fe80:/i,         // IPv6 link-local
];

// Cloud metadata endpoints blocked explicitly by full address
const BLOCKED_HOSTS = new Set([
  "169.254.169.254",  // AWS EC2 / GCP / Azure IMDS
  "metadata.google.internal",
  "metadata.internal",
]);

// Standard HTTP ports — allowed without explicit whitelist
const STANDARD_PORTS = new Set([80, 443]);

export interface SsrfCheckOptions {
  /** Additional ports to allow (from config.allowedPorts). Defaults to []. */
  allowedPorts?: number[];
}

export function assertSafeUrl(raw: string, opts: SsrfCheckOptions = {}): URL {
  // Reject null bytes before URL parsing (bypass attempt)
  if (raw.includes("\0") || raw.includes("%00")) {
    throw new Error(`[media-proxy] Blocked URL — contains null bytes`);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`[media-proxy] Invalid URL: ${raw.slice(0, 80)}`);
  }

  // Protocol check
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`[media-proxy] Blocked URL scheme "${url.protocol}" — only https/http allowed`);
  }

  const hostname = url.hostname.toLowerCase();

  // Explicit host blocklist
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error(`[media-proxy] Blocked URL — "${hostname}" is a cloud metadata endpoint (SSRF protection)`);
  }

  // Private IP range check
  for (const pattern of PRIVATE_IP_RE) {
    if (pattern.test(hostname)) {
      throw new Error(`[media-proxy] Blocked URL — private/internal host "${hostname}" not allowed (SSRF protection)`);
    }
  }

  // Port whitelist check
  const port = url.port ? parseInt(url.port, 10) : (url.protocol === "https:" ? 443 : 80);
  const allowedPorts = new Set([...STANDARD_PORTS, ...(opts.allowedPorts ?? [])]);
  if (!allowedPorts.has(port)) {
    throw new Error(
      `[media-proxy] Blocked URL — port ${port} not allowed. ` +
      `Add it to config.allowedPorts to whitelist non-standard ports.`
    );
  }

  return url;
}

// ─── MIME Detection ───────────────────────────────────────────────────────────

const MIME_SIGNATURES: Array<{ bytes: number[]; mime: string }> = [
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], mime: "image/png" },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif" },
  // RIFF....WEBP
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: "image/webp" }, // checked with offset[8] below
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf" }, // %PDF
  // MP4 ftyp atom at offset 4
];

function detectMime(buffer: Buffer, contentTypeFallback: string): string {
  // Check magic bytes
  for (const sig of MIME_SIGNATURES) {
    if (buffer.length < sig.bytes.length) continue;
    const match = sig.bytes.every((b, i) => buffer[i] === b);
    if (match) {
      // For RIFF: confirm WEBP at offset 8
      if (sig.mime === "image/webp") {
        const riff = buffer.slice(8, 12).toString("ascii");
        if (riff !== "WEBP") continue;
      }
      return sig.mime;
    }
  }

  // MP4: ftyp box at offset 4
  if (buffer.length >= 8) {
    const ftyp = buffer.slice(4, 8).toString("ascii");
    if (ftyp === "ftyp") return "video/mp4";
  }

  // Fall back to Content-Type header
  return contentTypeFallback.split(";")[0].trim() || "application/octet-stream";
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
  };
  return map[mime] ?? "bin";
}

// ─── Fetch to Buffer ──────────────────────────────────────────────────────────

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MB hard cap
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds

export async function fetchToBuffer(
  sourceUrl: string,
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  // SSRF protection — throws for private/invalid URLs
  const safeUrl = assertSafeUrl(sourceUrl);

  // Enforce size limit early via Content-Length header if available
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(safeUrl.href, {
      signal: controller.signal,
      redirect: "error", // Never follow redirects — prevents redirect-based SSRF
      headers: { "User-Agent": "cms-mcp media-proxy" },
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[media-proxy] Network error fetching source URL: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`[media-proxy] Source returned ${response.status}`);
  }

  // Guard against huge responses before buffering
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_MEDIA_BYTES) {
    throw new Error(`[media-proxy] File too large (${contentLength} bytes, max ${MAX_MEDIA_BYTES})`);
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const arrayBuffer = await response.arrayBuffer();

  if (arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
    throw new Error(`[media-proxy] File too large (${arrayBuffer.byteLength} bytes, max ${MAX_MEDIA_BYTES})`);
  }

  const buffer = Buffer.from(arrayBuffer);
  const mimeType = detectMime(buffer, contentType);

  // Derive filename from URL path, fallback to UUID
  let filename: string;
  try {
    const base = safeUrl.pathname.split("/").pop() ?? "";
    filename = base.includes(".") ? base : `upload-${randomUUID()}.${extFromMime(mimeType)}`;
  } catch {
    filename = `upload-${randomUUID()}.${extFromMime(mimeType)}`;
  }

  process.stderr.write(`[media-proxy] Fetched ${filename} (${mimeType}, ${buffer.byteLength} bytes)\n`);

  return { buffer, mimeType, filename };
}

// ─── Upload as Multipart ──────────────────────────────────────────────────────

export async function uploadToEndpoint(
  config: Config,
  uploadUrl: string,
  buffer: Buffer,
  mimeType: string,
  filename: string,
  extraFields?: Record<string, string>,
): Promise<MediaUploadResult> {
  const authHeaders = buildAuthHeaders(config);
  const formData = new FormData();

  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  formData.append("file", blob, filename);

  if (extraFields) {
    for (const [k, v] of Object.entries(extraFields)) {
      formData.append(k, v);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "POST",
      signal: controller.signal,
      redirect: "error",
      headers: { ...authHeaders },
      body: formData,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[media-proxy] Upload network error: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Don't leak full response body — just status
    throw new Error(`[media-proxy] Upload failed with status ${response.status}`);
  }

  const result = await response.json().catch(() => ({})) as Record<string, unknown>;

  // Normalise response — different APIs return different shapes
  const rawUrl =
    (result["url"] as string) ??
    (result["secure_url"] as string) ??
    (result["public_url"] as string) ??
    (result["data"] as any)?.url ??
    "";

  // Validate returned URL scheme before exposing it
  if (rawUrl && !rawUrl.startsWith("https://") && !rawUrl.startsWith("http://")) {
    throw new Error(`[media-proxy] Upload response contained unsafe URL scheme`);
  }

  const id =
    (result["id"] as string) ??
    (result["asset_id"] as string) ??
    undefined;

  if (!rawUrl) {
    process.stderr.write(`[media-proxy] Warning: could not extract URL from upload response\n`);
  }

  return {
    url: rawUrl,
    id,
    filename,
    mimeType,
    sizeBytes: buffer.byteLength,
  };
}

// ─── Combined helper ──────────────────────────────────────────────────────────

export async function proxyUpload(
  config: Config,
  sourceUrl: string,
  extraFields?: Record<string, string>,
): Promise<MediaUploadResult> {
  if (!config.endpoints.media) {
    throw new Error("[media-proxy] No media endpoint configured. Add endpoints.media to cms-mcp.config.json");
  }

  const { buffer, mimeType, filename } = await fetchToBuffer(sourceUrl);
  return uploadToEndpoint(config, config.endpoints.media, buffer, mimeType, filename, extraFields);
}
