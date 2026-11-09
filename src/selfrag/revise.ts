import type { Hit } from "../naiverag/domain/types.js";
import type { GeneratedAnswer, Generator } from "../naiverag/generation/generate.js";
import type { Support } from "./evaluate.js";

const SYSTEM_PROMPT = [
  "あなたはTaskFlowの問い合わせ担当です。",
  "渡されたマニュアルに書いてあることだけを根拠に、回答を修正してください。",
  "文書にない断定は削除してください。",
  "文書と矛盾する記述は、文書の内容に合わせて直してください。",
  "マニュアルに答えがない場合は、分からないと答えてください。",
  "修正した回答だけを返してください。",
].join("\n");

const REASONS: Record<Exclude<Support, "supported">, string> = {
  not_supported: "文書に根拠のない主張が含まれています。",
  contradicted: "文書に書いてある内容と矛盾しています。",
};

export async function reviseAnswer(options: {
  generator: Generator;
  query: string;
  hits: readonly Hit[];
  answer: string;
  support: Exclude<Support, "supported">;
}): Promise<GeneratedAnswer> {
  const documents = options.hits.map((hit) => hit.text).join("\n\n");
  return options.generator.complete([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `質問:\n${options.query}`,
        `マニュアル:\n${documents}`,
        `今の回答:\n${options.answer}`,
        `指摘:\n${REASONS[options.support]}`,
      ].join("\n\n"),
    },
  ]);
}
