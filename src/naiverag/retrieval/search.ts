import type { Hit, VectorIndex } from "../domain/types.js";
import type { Embedder } from "../indexing/embed.js";
import { cosineSimilarity } from "./cosine.js";

export async function retrieve(options: {
  index: VectorIndex;
  query: string;
  embedder: Embedder;
  k: number;
}): Promise<Hit[]> {
  const queryText = options.query.trim();
  if (!queryText) {
    throw new Error("質問が空です");
  }
  if (options.embedder.model !== options.index.model) {
    throw new Error(
      `Embeddingモデルが一致しません。index: ${options.index.model} / 質問: ${options.embedder.model}`,
    );
  }

  const [queryEmbedding] = await options.embedder.embed([queryText]);
  return options.index.chunks
    .map((chunk) => ({
      id: chunk.id,
      source: chunk.source,
      title: chunk.title,
      heading: chunk.heading,
      text: chunk.text,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.k);
}
