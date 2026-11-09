import type { GeneratedAnswer, Generator } from "../naiverag/generation/generate.js";

const SYSTEM_PROMPT = [
  "あなたは問い合わせ担当です。",
  "質問が一般的な言葉の意味を聞いているときは、その言葉の一般的な説明を日本語で簡潔に答えてください。",
  "TaskFlowのマニュアルは渡されていません。製品固有の規定としては答えないでください。",
].join("\n");

export async function generateWithoutManuals(options: {
  generator: Generator;
  query: string;
}): Promise<GeneratedAnswer> {
  const query = options.query.trim();
  if (!query) {
    throw new Error("質問が空です");
  }
  return options.generator.complete([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: query },
  ]);
}
