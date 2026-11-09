import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Hit } from "../naiverag/domain/types.js";

export const GRADES = {
  Correct: "回答に必要な情報が、渡された文書に含まれている",
  Ambiguous: "関連する情報はあるが、質問が聞いている操作の根拠としては十分か判断しにくい",
  Incorrect: "質問に答えるために必要な情報が、渡された文書に含まれていない",
} as const;

export type Grade = keyof typeof GRADES;

const INSTRUCTION = [
  "この検索結果は、質問への回答に十分な根拠を含んでいるか。",
  "文書が説明している操作と、質問が聞いている操作が違う場合は Incorrect。",
  "話題が近いだけでは Correct にしない。",
].join("");

export type GradeDecision = {
  grade: Grade;
  confidence: number;
  probabilities: { readonly [label in Grade]: number };
};

export async function judgeRetrieval(options: {
  query: string;
  hits: readonly Hit[];
  apiKey: string;
}): Promise<GradeDecision> {
  const client = new TypeSafeClient({ apiKey: options.apiKey, timeout: 60_000 });
  const documents = options.hits.map((hit) => hit.text).join("\n\n");
  const { answers } = await client.systemOne({
    state: `質問: ${options.query}\n\n文書:\n${documents}`,
    questions: {
      grade: choice(INSTRUCTION, GRADES),
    },
  });
  return {
    grade: answers.grade.choice,
    confidence: answers.grade.confidence,
    probabilities: answers.grade.probabilities,
  };
}
