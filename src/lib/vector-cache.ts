// src/lib/vector-cache.ts
// Semantic Vector Cache — local-first knowledge layer.
// Default mode: TF-IDF (zero external deps, runs offline).
// OpenAI mode: real embeddings via embedFn — true semantic similarity.
// Storage: SQLite. Search: cosine similarity.

import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { expandHome } from "./config.js";
import type { EmbedFn } from "./embeddings.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VectorEntry {
  id: string;
  type: string;
  title: string;
  content: string;
  metadata: string;
  vector: number[];
  cachedAt: number;
}

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  score: number;
  metadata: Record<string, unknown>;
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .filter((w) => !STOP_WORDS.has(w));
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "has", "had",
  "was", "were", "will", "with", "this", "that", "from", "they", "been", "have",
  "said", "each", "which", "their", "time", "will", "way", "about", "many",
  "then", "them", "would", "make", "like", "him", "into", "its", "also",
  "could", "than", "other", "been", "now", "some", "more", "these", "just",
  "use", "used", "using", "does", "doing", "done", "did", "get", "got",
]);

// ─── TF-IDF Vector Builder ───────────────────────────────────────────────────

export class VectorBuilder {
  private docFrequency = new Map<string, number>();
  private totalDocs = 0;
  private vocabulary = new Map<string, number>();

  buildVocabulary(documents: string[]): void {
    this.docFrequency.clear();
    this.vocabulary.clear();
    this.totalDocs = documents.length;

    const allWords = new Set<string>();

    for (const doc of documents) {
      const uniqueWords = new Set(tokenize(doc));
      for (const word of uniqueWords) {
        allWords.add(word);
        this.docFrequency.set(word, (this.docFrequency.get(word) ?? 0) + 1);
      }
    }

    const sorted = [...allWords].sort((a, b) => {
      return (this.docFrequency.get(b) ?? 0) - (this.docFrequency.get(a) ?? 0);
    });

    for (let i = 0; i < Math.min(sorted.length, 2000); i++) {
      this.vocabulary.set(sorted[i], i);
    }
  }

  vectorize(text: string): number[] {
    const tokens = tokenize(text);
    const vec = new Array(this.vocabulary.size).fill(0);
    const termFreq = new Map<string, number>();

    for (const t of tokens) {
      termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    }

    for (const [word, idx] of this.vocabulary) {
      const tf = (termFreq.get(word) ?? 0) / Math.max(tokens.length, 1);
      const df = this.docFrequency.get(word) ?? 1;
      const idf = Math.log((this.totalDocs + 1) / (df + 1)) + 1;
      vec[idx] = tf * idf;
    }

    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    }

    return vec;
  }

  getVocabSize(): number {
    return this.vocabulary.size;
  }
}

// ─── Cosine Similarity ───────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// ─── VectorCache ─────────────────────────────────────────────────────────────

export class VectorCache {
  private db: Database.Database;
  private builder: VectorBuilder;
  private embedFn?: EmbedFn;

  /**
   * @param dbPath   SQLite file path (home dir expansion supported).
   * @param embedFn  Optional external embedding function (OpenAI).
   *                 When set, bypasses TF-IDF entirely — vectors are fetched
   *                 from the API and stored directly with no vocabulary rebuild.
   */
  constructor(dbPath: string, embedFn?: EmbedFn) {
    const resolvedPath = resolve(expandHome(dbPath));
    mkdirSync(dirname(resolvedPath), { recursive: true });

    this.db = new Database(resolvedPath);
    this.builder = new VectorBuilder();
    this.embedFn = embedFn;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_cache (
        id        TEXT NOT NULL,
        type      TEXT NOT NULL,
        title     TEXT NOT NULL,
        content   TEXT NOT NULL,
        metadata  TEXT NOT NULL,
        vector    TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        PRIMARY KEY (id, type)
      );

      CREATE INDEX IF NOT EXISTS idx_vector_type ON vector_cache (type);
    `);

    // Rebuild vocabulary from existing data (only in TF-IDF mode)
    if (!this.embedFn) {
      this.rebuildVocabulary();
    }
  }

  // ── Store ──────────────────────────────────────────────────────────────────

  async store(
    id: string,
    type: string,
    title: string,
    content: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (this.embedFn) {
      // OpenAI path: get real embedding, store directly, no vocab rebuild
      const vec = await this.embedFn(`${title} ${content}`);
      this.db.prepare(`
        INSERT OR REPLACE INTO vector_cache (id, type, title, content, metadata, vector, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, type, title, content, JSON.stringify(metadata), JSON.stringify(vec), Date.now());
      return;
    }

    // TF-IDF path: insert placeholder, then rebuild vocabulary and re-vectorize
    const placeholder = JSON.stringify([]);
    this.db.prepare(`
      INSERT OR REPLACE INTO vector_cache (id, type, title, content, metadata, vector, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, title, content, JSON.stringify(metadata), placeholder, Date.now());

    const count = (this.db.prepare("SELECT COUNT(*) as n FROM vector_cache").get() as any).n;
    if (count <= 5 || count % 20 === 0) {
      this.rebuildVocabulary();
    } else {
      const vec = this.builder.vectorize(content);
      this.db.prepare("UPDATE vector_cache SET vector = ? WHERE id = ? AND type = ?")
        .run(JSON.stringify(vec), id, type);
    }
  }

  // ── Semantic Search ────────────────────────────────────────────────────────

  async search(query: string, limit = 5, typeFilter?: string): Promise<SearchResult[]> {
    let queryVec: number[];

    if (this.embedFn) {
      // OpenAI path: embed the query
      queryVec = await this.embedFn(query);
    } else {
      // TF-IDF path: vectorize with current vocabulary
      if (this.builder.getVocabSize() === 0) {
        this.rebuildVocabulary();
        if (this.builder.getVocabSize() === 0) return [];
      }
      queryVec = this.builder.vectorize(query);
    }

    const rows = typeFilter
      ? this.db.prepare("SELECT id, type, title, vector, metadata FROM vector_cache WHERE type = ?").all(typeFilter)
      : this.db.prepare("SELECT id, type, title, vector, metadata FROM vector_cache").all();

    const scored: SearchResult[] = [];

    for (const row of rows as any[]) {
      let storedVec: number[];
      try {
        storedVec = JSON.parse(row.vector);
      } catch {
        continue;
      }

      // Handle dimension mismatch (e.g. mode switch, or stale TF-IDF vectors)
      const minLen = Math.min(queryVec.length, storedVec.length);
      if (minLen === 0) continue;
      const a = queryVec.length === minLen ? queryVec : queryVec.slice(0, minLen);
      const b = storedVec.length === minLen ? storedVec : storedVec.slice(0, minLen);
      const score = cosineSimilarity(a, b);

      if (score > 0.01) {
        let metadata: Record<string, unknown>;
        try {
          metadata = JSON.parse(row.metadata);
        } catch {
          metadata = {};
        }
        scored.push({ id: row.id, type: row.type, title: row.title, score, metadata });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  // ── Rebuild vocabulary (TF-IDF only) ──────────────────────────────────────

  private rebuildVocabulary(): void {
    const rows = this.db.prepare("SELECT id, type, content FROM vector_cache").all() as {
      id: string; type: string; content: string;
    }[];

    if (rows.length === 0) return;

    this.builder.buildVocabulary(rows.map((r) => r.content));

    const update = this.db.prepare("UPDATE vector_cache SET vector = ? WHERE id = ? AND type = ?");
    const batch = this.db.transaction(() => {
      for (const row of rows) {
        const vec = this.builder.vectorize(row.content);
        update.run(JSON.stringify(vec), row.id, row.type);
      }
    });
    batch();
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  stats(): {
    totalEntries: number;
    byType: Record<string, number>;
    vocabSize: number;
    embeddingMode: "openai" | "tfidf";
  } {
    const total = (this.db.prepare("SELECT COUNT(*) as n FROM vector_cache").get() as any).n as number;
    const types = this.db.prepare("SELECT type, COUNT(*) as n FROM vector_cache GROUP BY type").all() as { type: string; n: number }[];
    const byType: Record<string, number> = {};
    for (const t of types) byType[t.type] = t.n;
    return {
      totalEntries: total,
      byType,
      vocabSize: this.embedFn ? 0 : this.builder.getVocabSize(),
      embeddingMode: this.embedFn ? "openai" : "tfidf",
    };
  }

  // ── Clear ──────────────────────────────────────────────────────────────────

  clear(type?: string): number {
    if (type) {
      return this.db.prepare("DELETE FROM vector_cache WHERE type = ?").run(type).changes;
    }
    return this.db.prepare("DELETE FROM vector_cache").run().changes;
  }

  close(): void {
    this.db.close();
  }
}
