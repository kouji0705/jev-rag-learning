import type { Generator } from "../generation/generate.js";
import type { Embedder } from "../indexing/embed.js";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

type EmbeddingItem = {
  index: number;
  embedding: number[];
};

type ApiErrorBody = {
  error?: { message?: string } | string;
};

type EmbeddingResponse = ApiErrorBody & {
  data?: EmbeddingItem[];
};

type ChatResponse = ApiErrorBody & {
  choices?: { message?: { content?: unknown } }[];
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

export function createOpenRouterGenerator(options: {
  apiKey: string;
  model: string;
  baseUrl?: string;
}): Generator {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");

  return {
    model: options.model,
    async generate(messages) {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      const raw = await response.text();
      let body: ChatResponse;
      try {
        body = JSON.parse(raw) as ChatResponse;
      } catch {
        throw new Error(`OpenRouter chat の応答を読めませんでした (${response.status})`);
      }

      if (!response.ok) {
        throw new Error(`OpenRouter chat に失敗しました (${response.status}): ${errorMessage(body)}`);
      }

      const answer = messageText(body.choices?.[0]?.message?.content);
      if (!answer) {
        throw new Error("OpenRouter chat の回答が空です");
      }
      return answer;
    },
  };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part === "object" && part && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("")
    .trim();
}

function errorMessage(body: ApiErrorBody): string {
  if (typeof body.error === "string") return body.error;
  return body.error?.message ?? "不明なエラー";
}
