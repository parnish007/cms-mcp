// src/lib/api-client.ts
// Generic REST client. All CMS API calls go through here.
// Handles auth, error normalisation, timeouts, and response parsing.

import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { buildAuthHeaders } from "./config.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
    // URL intentionally excluded — don't leak it in thrown errors
  ) {
    super(`[cms-mcp] API error ${status} ${statusText}`);
  }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds

export class ApiClient {
  private authHeaders: Record<string, string>;

  constructor(private config: Config) {
    this.authHeaders = buildAuthHeaders(config);
  }

  private buildUrl(base: string, params?: Record<string, string | number | boolean | undefined>): string {
    if (!params) return base;
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return qs ? `${base}?${qs}` : base;
  }

  async request<T = unknown>(url: string, options: RequestOptions = {}): Promise<T> {
    const { method = "GET", body, params, headers = {} } = options;

    const finalUrl = this.buildUrl(url, params);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const fetchOptions: RequestInit = {
      method,
      signal: controller.signal,
      redirect: "error", // Don't follow redirects — prevents auth header leakage
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...this.authHeaders,
        ...headers,
      },
    };

    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(finalUrl, fetchOptions);
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      // Don't include URL in error — it may contain sensitive query params
      throw new Error(`[cms-mcp] Network error: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = await response.text().catch(() => "(no body)");
      }
      throw new ApiError(response.status, response.statusText, errorBody);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      return (await response.text()) as unknown as T;
    }
  }

  // ─── Convenience Methods ──────────────────────────────────────────────────

  get<T>(url: string, params?: RequestOptions["params"]): Promise<T> {
    return this.request<T>(url, { method: "GET", params });
  }

  post<T>(url: string, body: unknown): Promise<T> {
    return this.request<T>(url, { method: "POST", body });
  }

  patch<T>(url: string, body: unknown): Promise<T> {
    return this.request<T>(url, { method: "PATCH", body });
  }

  put<T>(url: string, body: unknown): Promise<T> {
    return this.request<T>(url, { method: "PUT", body });
  }

  delete<T>(url: string): Promise<T> {
    return this.request<T>(url, { method: "DELETE" });
  }

  // ─── Raw binary fetch (for media proxy) ──────────────────────────────────

  async fetchBuffer(url: string): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        redirect: "error",
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[cms-mcp] Failed to fetch binary: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`[cms-mcp] Binary fetch failed ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    const mimeType = contentType.split(";")[0].trim();

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Derive filename from URL, fallback to UUID
    let filename: string;
    try {
      const urlObj = new URL(url);
      const base = urlObj.pathname.split("/").pop() ?? "";
      filename = base || `file-${randomUUID()}`;
    } catch {
      filename = `file-${randomUUID()}`;
    }

    return { buffer, mimeType, filename };
  }
}
