import type { Embedder } from "../indexing/embed.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

type EmbeddingItem = {
  index: number;
  embedding: number[];
};

type EmbeddingResponse = {
  data?: EmbeddingItem[];
  error?: { message?: string } | string;
};

export function createOpenRouterEmbedder(options: {
  apiKey: string;
  model: string;
  baseUrl?: string;
}): Embedder {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");

  return {
    model: options.model,
    async embed(texts) {
      if (texts.length === 0) return [];

      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          input: [...texts],
          encoding_format: "float",
        }),
        signal: AbortSignal.timeout(60_000),
      });

      const raw = await response.text();
      let body: EmbeddingResponse;
      try {
        body = JSON.parse(raw) as EmbeddingResponse;
      } catch {
        throw new Error(`OpenRouter embeddings の応答を読めませんでした (${response.status})`);
      }

      if (!response.ok) {
        throw new Error(
          `OpenRouter embeddings に失敗しました (${response.status}): ${errorMessage(body)}`,
        );
      }

      const byIndex = new Map((body.data ?? []).map((item) => [item.index, item.embedding]));
      return texts.map((_, index) => {
        const embedding = byIndex.get(index);
        if (!embedding || embedding.length === 0) {
          throw new Error(`index ${index} の Embedding がありません`);
        }
        return embedding;
      });
    },
  };
}

function errorMessage(body: EmbeddingResponse): string {
  if (typeof body.error === "string") return body.error;
  return body.error?.message ?? "不明なエラー";
}
