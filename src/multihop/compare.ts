import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hit } from "../naiverag/domain/types.js";
import { generateAnswerWithUsage } from "../naiverag/generation/generate.js";
import { createOpenRouterEmbedder, createOpenRouterGenerator } from "../naiverag/providers/openrouter.js";
import { loadIndex } from "../naiverag/retrieval/load-index.js";
import { retrieve } from "../naiverag/retrieval/search.js";
import { INCOMPLETE, searchHops, TOP_K } from "./hop.js";

const QUESTIONS: {
  query: string;
  aspects: Readonly<Record<string, string>>;
  done: string;
}[] = [
  {
    query: "SSOが使えるプランを月の途中で退会した場合、当月の請求額とデータ削除までの日数は？",
    aspects: {
      plan: "SSOに対応するプランや月額料金の根拠が不足している",
      billing: "月途中で退会した場合の請求ルールが未確認",
      deletion: "退会完了からデータ削除までの期間が未確認",
    },
    done: "プラン、料金、退会時の請求、データ削除の根拠がすべて揃っている",
  },
  {
    query: "退会後、データはいつ削除されますか？",
    aspects: {
      deletion: "退会完了からデータ削除までの期間が未確認",
    },
    done: "データ削除までの期間の根拠が文書で確認できている",
  },
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const openRouterKey = process.env.OPENROUTER_API_KEY;
const jevKey = process.env.TYPESAFE_API_KEY;
if (!openRouterKey) throw new Error("OPENROUTER_API_KEY が .env にありません");
if (!jevKey) throw new Error("TYPESAFE_API_KEY が .env にありません");

const index = await loadIndex(path.join(root, "data", "index.json"));
const chatModel = process.env.OPENROUTER_CHAT_MODEL ?? "openai/gpt-4.1-mini";
const embedder = createOpenRouterEmbedder({ apiKey: openRouterKey, model: index.model });
const generator = createOpenRouterGenerator({ apiKey: openRouterKey, model: chatModel });

for (const question of QUESTIONS) {
  const naiveStarted = Date.now();
  const naiveHits = await retrieve({ index, query: question.query, embedder, k: TOP_K });
  const naiveRetrieveMs = Date.now() - naiveStarted;
  const naiveGenerateStarted = Date.now();
  const naive = await generateAnswerWithUsage({ generator, query: question.query, hits: naiveHits });
  const naiveGenerateMs = Date.now() - naiveGenerateStarted;

  const hop = await searchHops({
    index,
    embedder,
    generator,
    apiKey: jevKey,
    query: question.query,
    aspects: question.aspects,
    done: question.done,
  });

  const generateStarted = Date.now();
  const answer = hop.done
    ? await generateAnswerWithUsage({ generator, query: question.query, hits: hop.documents })
    : { text: INCOMPLETE, promptTokens: 0 };
  const generateMs = hop.done ? Date.now() - generateStarted : 0;

  console.log(`\n質問: ${question.query}`);
  console.log("\nNaive RAG");
  printHits(naiveHits);
  console.log(`検索回数: 1`);
  console.log(`文書数: ${naiveHits.length}`);
  console.log(`検索: ${naiveRetrieveMs} ms`);
  console.log(`入力トークン: ${naive.promptTokens}`);
  console.log(`回答生成: ${naiveGenerateMs} ms`);
  console.log(`回答:\n${naive.text}`);

  console.log("\nMulti-hop RAG");
  console.log(`検索回数: ${hop.steps.length}`);
  for (const [rank, step] of hop.steps.entries()) {
    console.log(`\n検索${rank + 1}: ${step.query}`);
    console.log(`検索: ${step.retrieveMs} ms`);
    printHits(step.hits);
    const probabilities = Object.entries(step.decision.probabilities)
      .map(([label, value]) => `${label} ${value.toFixed(2)}`)
      .join(" / ");
    console.log(
      `Jev: ${step.decision.choice}  信頼度 ${step.decision.confidence.toFixed(2)}  ${step.jevMs} ms`,
    );
    console.log(`確率: ${probabilities}`);
    if (step.nextQuery) {
      console.log(`次の検索文: ${step.nextQuery}  ${step.nextQueryMs} ms`);
    }
  }
  console.log(`\n収集した文書数: ${hop.documents.length}`);
  for (const document of hop.documents) {
    console.log(`- ${document.heading}`);
  }
  console.log(`入力トークン: ${answer.promptTokens}`);
  console.log(`回答生成: ${generateMs} ms`);
  console.log(`回答:\n${answer.text}`);
}

function printHits(hits: readonly Hit[]) {
  for (const [rank, hit] of hits.entries()) {
    console.log(`${rank + 1}. 類似度 ${hit.score.toFixed(4)}  ${hit.heading}`);
  }
}
