import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Hit } from "../naiverag/domain/types.js";
import type { Generator } from "../naiverag/generation/generate.js";

const COVERAGE = {
  enough: "質問が求めている規定が、渡された文書に含まれている",
  another: "別の規定を追加で検索しないと答えられない",
} as const;

export type Coverage = keyof typeof COVERAGE;

const NEXT_QUERY_SYSTEM = [
  "あなたは検索文を作る係です。",
  "すでに取得した見出しにはない規定を探すため、短い検索文を1つだけ返してください。",
  "質問の言い換えは返さないでください。",
  "検索文以外は書かないでください。",
].join("\n");

export async function judgeCoverage(options: {
  query: string;
  hits: readonly Hit[];
  apiKey: string;
}): Promise<Coverage> {
  const client = new TypeSafeClient({ apiKey: options.apiKey, timeout: 60_000 });
  const documents = options.hits.map((hit) => hit.text).join("\n\n");
  const { answers } = await client.systemOne({
    state: `質問: ${options.query}\n\n文書:\n${documents}`,
    questions: {
      coverage: choice("この文書だけで質問に答えられるか。", COVERAGE),
    },
  });
  return answers.coverage.choice;
}

export async function nextQuery(options: {
  generator: Generator;
  query: string;
  hits: readonly Hit[];
}): Promise<string> {
  const seen = options.hits.map((hit) => `- ${hit.heading}`).join("\n");
  const { text } = await options.generator.complete([
    { role: "system", content: NEXT_QUERY_SYSTEM },
    {
      role: "user",
      content: `質問:\n${options.query}\n\nすでに取得した見出し:\n${seen}`,
    },
  ]);
  const query = text.trim().split("\n")[0]?.replace(/^["「]|["」]$/g, "").trim() ?? "";
  if (!query) {
    throw new Error("追加の検索文が空です");
  }
  return query;
}
