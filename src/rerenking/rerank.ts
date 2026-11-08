import { score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Hit } from "../naiverag/domain/types.js";

const RUBRIC = [
  "質問と関係がない",
  "料金や退会には触れるが、解約時の日割りは判断できない",
  "日割りや満額には触れるが、解約時のルールとは限らない",
  "解約した月の料金が日割りか満額かを判断できる",
] as const;

export type RerankedHit = Hit & {
  relevance: number;
};

export async function rerank(options: {
  query: string;
  hits: readonly Hit[];
  apiKey: string;
}): Promise<RerankedHit[]> {
  const client = new TypeSafeClient({ apiKey: options.apiKey });
  const reranked: RerankedHit[] = [];

  for (const hit of options.hits) {
    const { answers } = await client.systemOne({
      state: `質問: ${options.query}\n\n文書:\n${hit.text}`,
      questions: {
        usefulness: score(
          "この文書は、月の途中で解約したときに料金が日割りになるかを判断する根拠になるか。",
          RUBRIC,
        ),
      },
    });
    reranked.push({ ...hit, relevance: answers.usefulness.score });
  }

  return reranked.sort((a, b) => b.relevance - a.relevance || b.score - a.score);
}
