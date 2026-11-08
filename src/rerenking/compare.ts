import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAnswer } from "../naiverag/generation/generate.js";
import type { Hit } from "../naiverag/domain/types.js";
import { createOpenRouterEmbedder, createOpenRouterGenerator } from "../naiverag/providers/openrouter.js";
import { loadIndex } from "../naiverag/retrieval/load-index.js";
import { retrieve } from "../naiverag/retrieval/search.js";
import { rerank } from "./rerank.js";

const QUESTION = "Standardプランを月の途中で解約したら、日割りになりますか？";
const CANDIDATES = 10;
const TOP_K = 3;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const openRouterKey = process.env.OPENROUTER_API_KEY;
const jevKey = process.env.TYPESAFE_API_KEY;
if (!openRouterKey) throw new Error("OPENROUTER_API_KEY が .env にありません");
if (!jevKey) throw new Error("TYPESAFE_API_KEY が .env にありません");

const index = await loadIndex(path.join(root, "data", "index.json"));
const chatModel = process.env.OPENROUTER_CHAT_MODEL ?? "openai/gpt-4.1-mini";
const embedder = createOpenRouterEmbedder({ apiKey: openRouterKey, model: index.model });
const generator = createOpenRouterGenerator({ apiKey: openRouterKey, model: chatModel });

const candidates = await retrieve({ index, query: QUESTION, embedder, k: CANDIDATES });
const naiveHits = candidates.slice(0, TOP_K);
const reranked = await rerank({ query: QUESTION, hits: candidates, apiKey: jevKey });
const rerankedHits = reranked.slice(0, TOP_K);

const [naiveAnswer, rerankedAnswer] = await Promise.all([
  generateAnswer({ generator, query: QUESTION, hits: naiveHits }),
  generateAnswer({ generator, query: QUESTION, hits: rerankedHits }),
]);

console.log(`質問: ${QUESTION}`);
console.log("\nNaive RAG");
printHits(naiveHits);
console.log(`\n回答:\n${naiveAnswer}`);
console.log("\nReranking RAG");
for (const [rank, hit] of rerankedHits.entries()) {
  console.log(`${rank + 1}. 関連度 ${hit.relevance.toFixed(2)}  類似度 ${hit.score.toFixed(4)}  ${hit.heading}`);
}
console.log(`\n回答:\n${rerankedAnswer}`);

function printHits(hits: readonly Hit[]) {
  for (const [rank, hit] of hits.entries()) {
    console.log(`${rank + 1}. 類似度 ${hit.score.toFixed(4)}  ${hit.heading}`);
  }
}
