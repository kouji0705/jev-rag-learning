import type { Hit } from "../naiverag/domain/types.js";
import type { Generator } from "../naiverag/generation/generate.js";

const SYSTEM_PROMPT = [
  "あなたは検索文を作る係です。",
  "不足している項目だけを聞く疑問文を1つ返してください。",
  "複数の項目を1つの文にまとめないでください。",
  "すでに文書から分かったプラン名などの事実は、疑問文に残してください。",
  "キーワードの羅列は返さないでください。",
  "疑問文以外は書かないでください。",
].join("\n");

export async function nextQuery(options: {
  generator: Generator;
  query: string;
  hits: readonly Hit[];
  missing: string;
  description: string;
}): Promise<string> {
  const seen = options.hits.map((hit) => hit.text).join("\n\n");
  const { text } = await options.generator.complete([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        `質問:\n${options.query}`,
        `次に調べること: ${options.missing}`,
        options.description,
        `すでに取得した文書:\n${seen}`,
      ].join("\n\n"),
    },
  ]);
  const query = text.trim().split("\n")[0]?.replace(/^["「]|["」]$/g, "").trim() ?? "";
  if (!query) {
    throw new Error("追加の検索文が空です");
  }
  return query;
}
