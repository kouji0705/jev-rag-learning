import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAnswerWithUsage } from "../naiverag/generation/generate.js";
import type { Hit } from "../naiverag/domain/types.js";
import { createOpenRouterEmbedder, createOpenRouterGenerator } from "../naiverag/providers/openrouter.js";
import { loadIndex } from "../naiverag/retrieval/load-index.js";
import { retrieve } from "../naiverag/retrieval/search.js";
import { evaluateWithJev, type ScoredHit } from "./evaluate.js";
import { MAX_DOCUMENTS, MIN_RELEVANCE, NO_EVIDENCE, selectDocuments } from "./select.js";

const QUESTIONS = [
  "退会後、データはいつ削除されますか？",
  "退会後のデータ保存期間を、有料で90日間に延長できますか？",
];
const CANDIDATES = 10;

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
  const started = Date.now();
  const candidates = await retrieve({ index, query: question, embedder, k: CANDIDATES });
  const retrieveMs = Date.now() - started;

  const naiveHits = candidates.slice(0, MAX_DOCUMENTS);
  const naiveStarted = Date.now();
  const naive = await generateAnswerWithUsage({ generator, query: question, hits: naiveHits });
  const naiveMs = Date.now() - naiveStarted;

  const jevStarted = Date.now();
  const scored = await evaluateWithJev({ query: question, hits: candidates, apiKey: jevKey });
  const jevMs = Date.now() - jevStarted;
  const selected = selectDocuments(scored);

  let filteringText = NO_EVIDENCE;
  let filteringTokens = 0;
  let filteringGenerateMs = 0;
  if (selected.length > 0) {
    const generateStarted = Date.now();
    const filtering = await generateAnswerWithUsage({ generator, query: question, hits: selected });
    filteringGenerateMs = Date.now() - generateStarted;
    filteringText = filtering.text;
    filteringTokens = filtering.promptTokens;
  }

  console.log(`\n質問: ${question}`);
  console.log(`検索: ${retrieveMs} ms / 上位${CANDIDATES}件`);
  console.log("\nNaive RAG");
  printHits(naiveHits);
  console.log(`文書数: ${naiveHits.length}`);
  console.log(`入力トークン: ${naive.promptTokens}`);
  console.log(`回答生成: ${naiveMs} ms`);
  console.log(`回答:\n${naive.text}`);

  console.log("\nFiltering RAG");
  for (const [rank, hit] of scored.entries()) {
    const kept = hit.relevance >= MIN_RELEVANCE ? "採用" : "除外";
    console.log(`${rank + 1}. 関連度 ${hit.relevance.toFixed(2)}  類似度 ${hit.score.toFixed(4)}  ${kept}  ${hit.heading}`);
  }
  console.log(`文書数: ${selected.length}`);
  console.log(`入力トークン: ${filteringTokens}`);
  console.log(`Jev: ${jevMs} ms / 回答生成: ${filteringGenerateMs} ms`);
  console.log(`回答:\n${filteringText}`);
}

function printHits(hits: readonly Hit[] | readonly ScoredHit[]) {
  for (const [rank, hit] of hits.entries()) {
    console.log(`${rank + 1}. 類似度 ${hit.score.toFixed(4)}  ${hit.heading}`);
  }
}
