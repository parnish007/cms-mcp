// src/lib/adapter.ts
// CMSAdapter — the Mapping Layer between LLM-friendly field names and
// whatever weird column names your actual API uses.
//
// Problem: Some APIs use non-standard field names.
//   • A legacy Payload CMS might store the body as "post_content_markdown"
//   • A Supabase table might use "heading_1" instead of "title"
//   • A Rails API might use snake_case where the schema expects camelCase
//
// CMSAdapter intercepts every request before it hits the network and
// renames keys according to the configured fieldMap. It also renames
// response keys back so the LLM always sees the friendly names.
//
// Configuration (per-endpoint in cms-mcp.config.json):
//
//   "adapters": {
//     "posts": {
//       "updateMethod": "PUT",
//       "fieldMap": {
//         "title": "post_heading_1",
//         "body":  "post_content_markdown"
//       }
//     }
//   }
//
// With this config, when Claude sends { title: "Hello" }, the adapter
// transforms it to { post_heading_1: "Hello" } before calling the API.
// When the API returns { post_heading_1: "Hello" }, it's renamed back
// to { title: "Hello" } before Claude sees it.

export interface AdapterConfig {
  /**
   * HTTP method to use for updates. Defaults to "PATCH".
   * Use "PUT" for APIs that require full-replacement semantics.
   */
  updateMethod?: "PATCH" | "PUT";

  /**
   * Field name mapping: internal (LLM-friendly) key → external (API) key.
   * Example: { "title": "post_heading_1", "body": "post_content_markdown" }
   *
   * The adapter applies this bidirectionally:
   * - transformRequest: renames internal→external before sending
   * - transformResponse: renames external→internal after receiving
   */
  fieldMap?: Record<string, string>;
}

// ─── CMSAdapter ───────────────────────────────────────────────────────────────

export class CMSAdapter {
  readonly #updateMethod: "PATCH" | "PUT";
  readonly #toExternal: ReadonlyMap<string, string>; // internal → external
  readonly #toInternal: ReadonlyMap<string, string>; // external → internal

  constructor(config: AdapterConfig = {}) {
    this.#updateMethod = config.updateMethod ?? "PATCH";

    const fieldMap = config.fieldMap ?? {};
    this.#toExternal = new Map(Object.entries(fieldMap));
    // Build reverse map for response transformation
    this.#toInternal = new Map(
      Object.entries(fieldMap).map(([internal, external]) => [external, internal])
    );
  }

  get updateMethod(): "PATCH" | "PUT" {
    return this.#updateMethod;
  }

  get hasMapping(): boolean {
    return this.#toExternal.size > 0;
  }

  /**
   * Rename LLM-friendly keys to API keys before sending a request.
   * Keys not in the fieldMap are passed through unchanged.
   *
   * Example:
   *   input:  { title: "Hello", body: "World", status: "draft" }
   *   output: { post_heading_1: "Hello", post_content_markdown: "World", status: "draft" }
   */
  transformRequest(data: Record<string, unknown>): Record<string, unknown> {
    if (!this.hasMapping) return data;

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      const externalKey = this.#toExternal.get(key) ?? key;
      result[externalKey] = value;
    }
    return result;
  }

  /**
   * Rename API keys back to LLM-friendly keys after receiving a response.
   * Keys not in the reverse fieldMap are passed through unchanged.
   *
   * Works on single objects or arrays of objects.
   */
  transformResponse(data: unknown): unknown {
    if (!this.hasMapping) return data;

    if (Array.isArray(data)) {
      return data.map((item) => this.#renameKeys(item));
    }

    if (data && typeof data === "object") {
      return this.#renameKeys(data as Record<string, unknown>);
    }

    return data;
  }

  #renameKeys(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const internalKey = this.#toInternal.get(key) ?? key;
      result[internalKey] = value;
    }
    return result;
  }

  /**
   * Build a human-readable summary for tool descriptions.
   * Shown when a mapping layer is active so Claude understands the translation.
   */
  describeMapping(): string {
    if (!this.hasMapping) return "";

    const pairs = [...this.#toExternal.entries()]
      .map(([internal, external]) => `${internal}→${external}`)
      .join(", ");
    return `\nField mapping: ${pairs}`;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/** Returns an identity adapter (no transformation) when no config is given. */
export function createAdapter(config?: AdapterConfig): CMSAdapter {
  return new CMSAdapter(config);
}
