import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAnswerWithUsage } from "../naiverag/generation/generate.js";
import type { Hit } from "../naiverag/domain/types.js";
import { createOpenRouterEmbedder, createOpenRouterGenerator } from "../naiverag/providers/openrouter.js";
import { loadIndex } from "../naiverag/retrieval/load-index.js";
import { retrieve } from "../naiverag/retrieval/search.js";
import { GRADES, judgeRetrieval, type Grade } from "./judge.js";
import { rewriteQuery } from "./rewrite.js";

const QUESTIONS = [
  "クレジットカードの決済に失敗したままだと、いつタスクを編集できなくなりますか？",
  "Standardプランを月の途中で解約したら、日割りになりますか？",
];
const TOP_K = 3;

const LABELS: Record<Grade, string> = {
  Correct: "この結果を採用",
  Ambiguous: "情報を補完",
  Incorrect: "別の情報を検索",
};

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
  const naiveHits = await retrieve({ index, query: question, embedder, k: TOP_K });
  const naiveRetrieveMs = Date.now() - naiveStarted;
  const naiveGenerateStarted = Date.now();
  const naive = await generateAnswerWithUsage({ generator, query: question, hits: naiveHits });
  const naiveGenerateMs = Date.now() - naiveGenerateStarted;

  const firstStarted = Date.now();
  const first = await retrieve({ index, query: question, embedder, k: TOP_K });
  let retrieveMs = Date.now() - firstStarted;
  const searches: { query: string; hits: Hit[] }[] = [{ query: question, hits: first }];

  const jevStarted = Date.now();
  const decision = await judgeRetrieval({ query: question, hits: first, apiKey: jevKey });
  const jevMs = Date.now() - jevStarted;

  let rewriteMs = 0;
  if (decision.grade !== "Correct") {
    const rewriteStarted = Date.now();
    const rewritten = await rewriteQuery({ generator, query: question, hits: first });
    rewriteMs = Date.now() - rewriteStarted;
    const moreStarted = Date.now();
    const more = await retrieve({ index, query: rewritten, embedder, k: TOP_K });
    retrieveMs += Date.now() - moreStarted;
    searches.push({ query: rewritten, hits: more });
  }

  const hits = mergeHits(searches.flatMap((search) => search.hits));
  const generateStarted = Date.now();
  const corrective = await generateAnswerWithUsage({ generator, query: question, hits });
  const generateMs = Date.now() - generateStarted;

  console.log(`\n質問: ${question}`);
  console.log("\nNaive RAG");
  printHits(naiveHits);
  console.log(`検索回数: 1`);
  console.log(`検索: ${naiveRetrieveMs} ms`);
  console.log(`入力トークン: ${naive.promptTokens}`);
  console.log(`回答生成: ${naiveGenerateMs} ms`);
  console.log(`回答:\n${naive.text}`);

  console.log("\nCorrective RAG");
  console.log(`判定: ${decision.grade}（${LABELS[decision.grade]}） 信頼度 ${decision.confidence.toFixed(2)}`);
  console.log(
    `確率: ${Object.keys(GRADES)
      .map((label) => `${label} ${decision.probabilities[label as Grade].toFixed(2)}`)
      .join(" / ")}`,
  );
  console.log(`Jev: ${jevMs} ms`);
  console.log(`検索回数: ${searches.length}`);
  for (const [rank, search] of searches.entries()) {
    console.log(`検索${rank + 1}: ${search.query}`);
    printHits(search.hits);
  }
  if (rewriteMs > 0) {
    console.log(`再検索文: ${rewriteMs} ms`);
  }
  console.log(`文書数: ${hits.length}`);
  console.log(`検索: ${retrieveMs} ms`);
  console.log(`入力トークン: ${corrective.promptTokens}`);
  console.log(`回答生成: ${generateMs} ms`);
  console.log(`回答:\n${corrective.text}`);
}

function printHits(hits: readonly Hit[]) {
  for (const [rank, hit] of hits.entries()) {
    console.log(`${rank + 1}. 類似度 ${hit.score.toFixed(4)}  ${hit.heading}`);
  }
}

function mergeHits(hits: readonly Hit[]): Hit[] {
  const seen = new Set<string>();
  const merged: Hit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    merged.push(hit);
  }
  return merged;
}
