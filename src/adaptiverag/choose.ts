import { choice, TypeSafeClient } from "@typesafe-ai/sdk";

export const STRATEGIES = {
  no_retrieval: "一般的な言葉の意味や常識で答えられ、TaskFlowの料金・退会・期限などの規定は不要",
  single_step: "TaskFlowの規定を1つ調べれば足りる",
  multi_step: "請求と削除のように、別々の規定を突き合わせないと答えられない",
} as const;

export type Strategy = keyof typeof STRATEGIES;

const INSTRUCTION = [
  "TaskFlowの問い合わせに答えるため、マニュアル検索をどう使うか。",
  "一般的な言葉の意味だけを聞いていて、料金・退会・期限などの製品の規定を聞いていないときは no_retrieval。",
  "製品の規定を1つ調べれば足りるときは single_step。",
  "別々の規定を突き合わせるときは multi_step。",
].join("");

export type StrategyDecision = {
  strategy: Strategy;
  confidence: number;
  probabilities: { readonly [label in Strategy]: number };
};

export async function chooseStrategy(options: {
  query: string;
  apiKey: string;
}): Promise<StrategyDecision> {
  const client = new TypeSafeClient({ apiKey: options.apiKey, timeout: 60_000 });
  const { answers } = await client.systemOne({
    state: `質問: ${options.query}`,
    questions: {
      strategy: choice(INSTRUCTION, STRATEGIES),
    },
  });
  return {
    strategy: answers.strategy.choice,
    confidence: answers.strategy.confidence,
    probabilities: answers.strategy.probabilities,
  };
}
