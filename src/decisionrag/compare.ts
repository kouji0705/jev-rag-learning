import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Hit } from "../naiverag/domain/types.js";
import { generateAnswerWithUsage } from "../naiverag/generation/generate.js";
import { loadManuals } from "../naiverag/indexing/load-manuals.js";
import { createOpenRouterEmbedder, createOpenRouterGenerator } from "../naiverag/providers/openrouter.js";
import { loadIndex } from "../naiverag/retrieval/load-index.js";
import { retrieve } from "../naiverag/retrieval/search.js";
import { exploreTree, MAX_DOCUMENTS } from "./explore.js";
import { buildTree } from "./tree.js";

const QUESTIONS = [
  "Standardプランを月の途中で解約したら、日割りになりますか？",
  "退会後、データはいつ削除されますか？",
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const openRouterKey = process.env.OPENROUTER_API_KEY;
const jevKey = process.env.TYPESAFE_API_KEY;
if (!openRouterKey) throw new Error("OPENROUTER_API_KEY が .env にありません");
if (!jevKey) throw new Error("TYPESAFE_API_KEY が .env にありません");

const index = await loadIndex(path.join(root, "data", "index.json"));
const tree = buildTree(await loadManuals(path.join(root, "data", "manuals")));
const chatModel = process.env.OPENROUTER_CHAT_MODEL ?? "openai/gpt-4.1-mini";
const embedder = createOpenRouterEmbedder({ apiKey: openRouterKey, model: index.model });
const generator = createOpenRouterGenerator({ apiKey: openRouterKey, model: chatModel });

for (const question of QUESTIONS) {
  const naiveStarted = Date.now();
  const naiveHits = await retrieve({ index, query: question, embedder, k: MAX_DOCUMENTS });
  const naiveRetrieveMs = Date.now() - naiveStarted;
  const naiveGenerateStarted = Date.now();
  const naive = await generateAnswerWithUsage({ generator, query: question, hits: naiveHits });
  const naiveGenerateMs = Date.now() - naiveGenerateStarted;

  const exploreStarted = Date.now();
  const exploration = await exploreTree({ query: question, tree, apiKey: jevKey });
  const exploreMs = Date.now() - exploreStarted;
  const decisionGenerateStarted = Date.now();
  const decision = await generateAnswerWithUsage({ generator, query: question, hits: exploration.hits });
  const decisionGenerateMs = Date.now() - decisionGenerateStarted;

  console.log(`\n質問: ${question}`);
  console.log("\nNaive RAG");
  printHits(naiveHits);
  console.log(`文書数: ${naiveHits.length}`);
  console.log(`検索: ${naiveRetrieveMs} ms`);
  console.log(`入力トークン: ${naive.promptTokens}`);
  console.log(`回答生成: ${naiveGenerateMs} ms`);
  console.log(`回答:\n${naive.text}`);

  console.log("\nDecision RAG");
  console.log("カテゴリ:");
  for (const category of exploration.categories) {
    const mark = category.kept ? "採用" : "除外";
    console.log(`- 関連度 ${category.relevance.toFixed(2)}  ${mark}  ${category.name}`);
  }
  console.log("グループ:");
  for (const group of exploration.groups) {
    const mark = group.kept ? "採用" : "除外";
    console.log(`- 関連度 ${group.relevance.toFixed(2)}  ${mark}  ${group.category} / ${group.name}`);
  }
  console.log("文書:");
  for (const [rank, section] of exploration.sections.entries()) {
    const mark = section.selected ? "採用" : "除外";
    console.log(`${rank + 1}. 関連度 ${section.relevance.toFixed(2)}  ${mark}  ${section.category} / ${section.group} / ${section.heading}`);
  }
  console.log(`文書数: ${exploration.hits.length}`);
  console.log(`探索: ${exploreMs} ms`);
  console.log(`入力トークン: ${decision.promptTokens}`);
  console.log(`回答生成: ${decisionGenerateMs} ms`);
  console.log(`回答:\n${decision.text}`);
}

function printHits(hits: readonly Hit[]) {
  for (const [rank, hit] of hits.entries()) {
    console.log(`${rank + 1}. 類似度 ${hit.score.toFixed(4)}  ${hit.heading}`);
  }
}
