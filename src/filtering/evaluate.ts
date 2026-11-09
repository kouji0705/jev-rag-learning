import { score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Hit } from "../naiverag/domain/types.js";

const RUBRIC = [
  "質問と関係がない",
  "話題は関連するが、回答の根拠にならない",
  "回答の一部を裏付ける情報を含む",
  "質問に直接回答できる根拠を含む",
] as const;

export type ScoredHit = Hit & {
  relevance: number;
};

export async function evaluateWithJev(options: {
  query: string;
  hits: readonly Hit[];
  apiKey: string;
}): Promise<ScoredHit[]> {
  const client = new TypeSafeClient({ apiKey: options.apiKey });
  const scored: ScoredHit[] = [];

  for (const hit of options.hits) {
    const { answers } = await client.systemOne({
      state: `質問: ${options.query}\n\n文書:\n${hit.text}`,
      questions: {
        usefulness: score(
          `質問「${options.query}」に対して、この文書は回答の根拠になるか。`,
          RUBRIC,
        ),
      },
    });
    scored.push({ ...hit, relevance: answers.usefulness.score });
  }

  return scored;
}
