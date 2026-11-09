import type { Hit } from "../domain/types.js";

export type ChatMessage = {
  role: "system" | "user";
  content: string;
};

export type GeneratedAnswer = {
  text: string;
  promptTokens: number;
};

export type Generator = {
  readonly model: string;
  generate(messages: readonly ChatMessage[]): Promise<string>;
  complete(messages: readonly ChatMessage[]): Promise<GeneratedAnswer>;
};

const SYSTEM_PROMPT = [
  "あなたはTaskFlowの問い合わせ担当です。",
  "渡されたマニュアルに書いてあることだけを根拠に、質問へ日本語で簡潔に答えてください。",
  "マニュアルに答えがない場合は、分からないと答えてください。",
].join("\n");

export function buildMessages(query: string, hits: readonly Hit[]): ChatMessage[] {
  const manuals = hits.map((hit) => hit.text).join("\n\n");
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `マニュアル:\n${manuals}\n\n質問:\n${query}` },
  ];
}

export async function generateAnswer(options: {
  generator: Generator;
  query: string;
  hits: readonly Hit[];
}): Promise<string> {
  const query = options.query.trim();
  if (!query) {
    throw new Error("質問が空です");
  }
  if (options.hits.length === 0) {
    throw new Error("検索結果がありません");
  }
  return (await generateAnswerWithUsage(options)).text;
}

export async function generateAnswerWithUsage(options: {
  generator: Generator;
  query: string;
  hits: readonly Hit[];
}): Promise<GeneratedAnswer> {
  const query = options.query.trim();
  if (!query) {
    throw new Error("質問が空です");
  }
  if (options.hits.length === 0) {
    throw new Error("検索結果がありません");
  }
  return options.generator.complete(buildMessages(query, options.hits));
}
