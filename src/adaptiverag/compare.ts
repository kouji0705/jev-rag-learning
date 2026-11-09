import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAnswerWithUsage } from "../naiverag/generation/generate.js";
import type { Hit } from "../naiverag/domain/types.js";
import { createOpenRouterEmbedder, createOpenRouterGenerator } from "../naiverag/providers/openrouter.js";
import { loadIndex } from "../naiverag/retrieval/load-index.js";
import { retrieve } from "../naiverag/retrieval/search.js";
import { generateWithoutManuals } from "./answer.js";
import { chooseStrategy, STRATEGIES, type Strategy } from "./choose.js";
import { judgeCoverage, nextQuery, type Coverage } from "./follow.js";

const QUESTIONS = [
  "「日割り」とはどういう意味ですか？",
  "TaskFlowでは退会後、データはいつ削除されますか？",
  "プラン変更後に退会した場合、請求とデータ削除はどうなりますか？",
];
const TOP_K = 3;

const LABELS: Record<Strategy, string> = {
  no_retrieval: "検索なし",
  single_step: "1回検索",
  multi_step: "複数回検索",
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

  const jevStarted = Date.now();
  const decision = await chooseStrategy({ query: question, apiKey: jevKey });
  let jevMs = Date.now() - jevStarted;

  const searches: { query: string; hits: Hit[] }[] = [];
  let retrieveMs = 0;
  let coverage: Coverage | null = null;
  let followUpMs = 0;

  if (decision.strategy !== "no_retrieval") {
    const started = Date.now();
    const first = await retrieve({ index, query: question, embedder, k: TOP_K });
    retrieveMs += Date.now() - started;
    searches.push({ query: question, hits: first });

    if (decision.strategy === "multi_step") {
      const judgeStarted = Date.now();
      coverage = await judgeCoverage({ query: question, hits: first, apiKey: jevKey });
      jevMs += Date.now() - judgeStarted;
      if (coverage === "another") {
        const followStarted = Date.now();
        const followUp = await nextQuery({ generator, query: question, hits: first });
        followUpMs = Date.now() - followStarted;
        const moreStarted = Date.now();
        const more = await retrieve({ index, query: followUp, embedder, k: TOP_K });
        retrieveMs += Date.now() - moreStarted;
        searches.push({ query: followUp, hits: more });
      }
    }
  }

  const hits = mergeHits(searches.flatMap((search) => search.hits));

  const generateStarted = Date.now();
  const adaptive =
    decision.strategy === "no_retrieval"
      ? await generateWithoutManuals({ generator, query: question })
      : await generateAnswerWithUsage({ generator, query: question, hits });
  const generateMs = Date.now() - generateStarted;

  console.log(`\n質問: ${question}`);
  console.log("\nNaive RAG");
  printHits(naiveHits);
  console.log(`検索回数: 1`);
  console.log(`検索: ${naiveRetrieveMs} ms`);
  console.log(`入力トークン: ${naive.promptTokens}`);
  console.log(`回答生成: ${naiveGenerateMs} ms`);
  console.log(`回答:\n${naive.text}`);

  console.log("\nAdaptive RAG");
  console.log(`戦略: ${decision.strategy}（${LABELS[decision.strategy]}） 信頼度 ${decision.confidence.toFixed(2)}`);
  console.log(
    `確率: ${Object.keys(STRATEGIES)
      .map((label) => `${label} ${decision.probabilities[label as Strategy].toFixed(2)}`)
      .join(" / ")}`,
  );
  console.log(`Jev: ${jevMs} ms`);
  console.log(`検索回数: ${searches.length}`);
  for (const [rank, search] of searches.entries()) {
    console.log(`検索${rank + 1}: ${search.query}`);
    printHits(search.hits);
  }
  if (coverage) {
    console.log(`追加判定: ${coverage === "enough" ? "足りている" : "追加検索"}`);
  }
  if (followUpMs > 0) {
    console.log(`追加検索文: ${followUpMs} ms`);
  }
  console.log(`文書数: ${hits.length}`);
  console.log(`検索: ${retrieveMs} ms`);
  console.log(`入力トークン: ${adaptive.promptTokens}`);
  console.log(`回答生成: ${generateMs} ms`);
  console.log(`回答:\n${adaptive.text}`);
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
