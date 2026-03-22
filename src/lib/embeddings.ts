// src/lib/embeddings.ts
// Pluggable embedding provider for semantic vector search.
// When configured, replaces the local TF-IDF engine with real OpenAI embeddings,
// enabling true semantic similarity (finds "neural network" when you search "LSTM").

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmbedFn = (text: string) => Promise<number[]>;

// ─── OpenAI Provider ─────────────────────────────────────────────────────────

/**
 * Creates an embedding function using the OpenAI Embeddings API.
 * No SDK required — uses raw fetch with a 15-second timeout.
 *
 * @param apiKey  Resolved OpenAI API key (never logged or thrown in errors).
 * @param model   Embedding model: "text-embedding-3-small" (1536d, recommended)
 *                or "text-embedding-3-large" (3072d, higher quality).
 */
export function createOpenAIEmbedFn(apiKey: string, model: string): EmbedFn {
  return async function embed(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const resp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: text.slice(0, 8_000), // Stay well within token limit
        }),
        signal: controller.signal,
        redirect: "error",
      });

      if (!resp.ok) {
        // Avoid leaking the API key in error messages
        throw new Error(`[embeddings] OpenAI API error ${resp.status} — check your apiKey and model name`);
      }

      const data = await resp.json() as { data: Array<{ embedding: number[] }> };
      return data.data[0].embedding;

    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("[embeddings] OpenAI request timed out after 15s");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  };
}

// ─── Dimensions ───────────────────────────────────────────────────────────────

export function modelDimensions(model: string): number {
  if (model === "text-embedding-3-large") return 3_072;
  if (model === "text-embedding-ada-002")  return 1_536;
  return 1_536; // default: text-embedding-3-small
}
