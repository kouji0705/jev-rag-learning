import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Hit } from "../naiverag/domain/types.js";

export const SUPPORT = {
  supported: "回答の主張が文書によって裏付けられている",
  not_supported: "文書に根拠のない主張が回答に含まれている",
  contradicted: "回答が文書に明記された内容と矛盾している",
} as const;

export type Support = keyof typeof SUPPORT;

const INSTRUCTION =
  "回答に含まれる主張が、提示された文書の内容に裏付けられているか。文書に記載がないことを断定している場合は not_supported とする。";

export type SupportDecision = {
  support: Support;
  confidence: number;
  probabilities: { readonly [label in Support]: number };
};

export async function evaluateAnswer(options: {
  query: string;
  hits: readonly Hit[];
  answer: string;
  apiKey: string;
}): Promise<SupportDecision> {
  const client = new TypeSafeClient({ apiKey: options.apiKey, timeout: 60_000 });
  const documents = options.hits.map((hit) => hit.text).join("\n\n");
  const { answers } = await client.systemOne({
    state: `質問: ${options.query}\n\n文書:\n${documents}\n\n回答:\n${options.answer}`,
    questions: {
      support: choice(INSTRUCTION, SUPPORT),
    },
  });
  return {
    support: answers.support.choice,
    confidence: answers.support.confidence,
    probabilities: answers.support.probabilities,
  };
}
