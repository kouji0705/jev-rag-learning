import type { Hit } from "../naiverag/domain/types.js";
import type { Generator } from "../naiverag/generation/generate.js";

const SYSTEM_PROMPT = [
  "あなたは検索文を作る係です。",
  "渡された文書は、質問が聞いている行為を説明していません。",
  "検索文は「{その行為}した月の料金はどうなりますか」の形だけにしてください。",
  "すでに文書にある話題の語は入れないでください。",
  "検索文以外は書かないでください。",
].join("\n");

export async function rewriteQuery(options: {
  generator: Generator;
  query: string;
  hits: readonly Hit[];
}): Promise<string> {
  const seen = options.hits.map((hit) => hit.text).join("\n\n");
  const { text } = await options.generator.complete([
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `質問:\n${options.query}\n\nすでに取得した文書:\n${seen}`,
    },
  ]);
  const query = text.trim().split("\n")[0]?.replace(/^["「]|["」]$/g, "").trim() ?? "";
  if (!query) {
    throw new Error("再検索の検索文が空です");
  }
  return query;
}
