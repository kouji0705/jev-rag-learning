import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Hit } from "../naiverag/domain/types.js";

const INSTRUCTION = [
  "質問への回答に必要な根拠を確認し、次に調べるべき情報を1つ選んでください。",
  "推測で情報が揃ったと判断せず、すべての項目を文書で確認できた場合だけdoneを選んでください。",
].join("");

export type NextDecision = {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
};

export async function decideNext(options: {
  query: string;
  hits: readonly Hit[];
  aspects: Readonly<Record<string, string>>;
  done: string;
  apiKey: string;
}): Promise<NextDecision> {
  const client = new TypeSafeClient({ apiKey: options.apiKey, timeout: 60_000 });
  const documents = options.hits.map((hit) => hit.text).join("\n\n");
  const { answers } = await client.systemOne({
    state: `質問: ${options.query}\n\n取得済み文書:\n${documents}`,
    questions: {
      next: choice(INSTRUCTION, { ...options.aspects, done: options.done }),
    },
  });
  return {
    choice: answers.next.choice,
    confidence: answers.next.confidence,
    probabilities: { ...answers.next.probabilities },
  };
}
