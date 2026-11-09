import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judgeRetrieval, type Grade } from "../correctiverag/judge.js";
import { rewriteQuery } from "../correctiverag/rewrite.js";
import type { Hit } from "../naiverag/domain/types.js";
import { generateAnswerWithUsage } from "../naiverag/generation/generate.js";
import { createOpenRouterEmbedder, createOpenRouterGenerator } from "../naiverag/providers/openrouter.js";
import { loadIndex } from "../naiverag/retrieval/load-index.js";
import { retrieve } from "../naiverag/retrieval/search.js";
import { evaluateAnswer, SUPPORT, type Support, type SupportDecision } from "./evaluate.js";
import { reviseAnswer } from "./revise.js";

const QUESTIONS = [
  "Standardプランを月の途中で解約したら、日割りになりますか？",
  "退会後のデータ保存期間を、有料で90日間に延長できますか？",
];
const PLANTED_ANSWER = "有料でも90日間に延長することはできません。";
const NO_EVIDENCE = "マニュアルからは確認できません。";
const TOP_K = 3;

const GRADE_LABELS: Record<Grade, string> = {
  Correct: "この結果を採用",
  Ambiguous: "情報を補完",
  Incorrect: "別の情報を検索",
};

const SUPPORT_LABELS: Record<Support, string> = {
  supported: "根拠あり",
  not_supported: "根拠なし",
  contradicted: "矛盾",
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
  const firstStarted = Date.now();
  const first = await retrieve({ index, query: question, embedder, k: TOP_K });
  let cragRetrieveMs = Date.now() - firstStarted;
  const cragSearches: { query: string; hits: Hit[] }[] = [{ query: question, hits: first }];

  const cragJudgeStarted = Date.now();
  const grade = await judgeRetrieval({ query: question, hits: first, apiKey: jevKey });
  const cragJevMs = Date.now() - cragJudgeStarted;
  let rewriteMs = 0;
  if (grade.grade !== "Correct") {
    const rewriteStarted = Date.now();
    const rewritten = await rewriteQuery({ generator, query: question, hits: first });
    rewriteMs = Date.now() - rewriteStarted;
    const moreStarted = Date.now();
    const more = await retrieve({ index, query: rewritten, embedder, k: TOP_K });
    cragRetrieveMs += Date.now() - moreStarted;
    cragSearches.push({ query: rewritten, hits: more });
  }
  const cragHits = mergeHits(cragSearches.flatMap((search) => search.hits));
  const cragGenerateStarted = Date.now();
  const crag = await generateAnswerWithUsage({ generator, query: question, hits: cragHits });
  const cragGenerateMs = Date.now() - cragGenerateStarted;

  const selfRetrieveStarted = Date.now();
  const selfHits = await retrieve({ index, query: question, embedder, k: TOP_K });
  const selfRetrieveMs = Date.now() - selfRetrieveStarted;
  const generateStarted = Date.now();
  const initial = await generateAnswerWithUsage({ generator, query: question, hits: selfHits });
  const generateMs = Date.now() - generateStarted;

  const reflectStarted = Date.now();
  const reflection = await evaluateAnswer({
    query: question,
    hits: selfHits,
    answer: initial.text,
    apiKey: jevKey,
  });
  let jevMs = Date.now() - reflectStarted;

  let reviseMs = 0;
  let reviseTokens = 0;
  let recheck: SupportDecision | null = null;
  let finalText = initial.text;
  if (reflection.support !== "supported") {
    const reviseStarted = Date.now();
    const revised = await reviseAnswer({
      generator,
      query: question,
      hits: selfHits,
      answer: initial.text,
      support: reflection.support,
    });
    reviseMs = Date.now() - reviseStarted;
    reviseTokens = revised.promptTokens;
    const recheckStarted = Date.now();
    recheck = await evaluateAnswer({
      query: question,
      hits: selfHits,
      answer: revised.text,
      apiKey: jevKey,
    });
    jevMs += Date.now() - recheckStarted;
    finalText = recheck.support === "supported" ? revised.text : NO_EVIDENCE;
  }

  console.log(`\n質問: ${question}`);
  console.log("\nCRAG");
  console.log(`判定: ${grade.grade}（${GRADE_LABELS[grade.grade]}） 信頼度 ${grade.confidence.toFixed(2)}`);
  console.log(`確率: Correct ${grade.probabilities.Correct.toFixed(2)} / Ambiguous ${grade.probabilities.Ambiguous.toFixed(2)} / Incorrect ${grade.probabilities.Incorrect.toFixed(2)}`);
  console.log(`Jev: ${cragJevMs} ms`);
  console.log(`検索回数: ${cragSearches.length}`);
  for (const [rank, search] of cragSearches.entries()) {
    console.log(`検索${rank + 1}: ${search.query}`);
    printHits(search.hits);
  }
  if (rewriteMs > 0) console.log(`再検索文: ${rewriteMs} ms`);
  console.log(`文書数: ${cragHits.length}`);
  console.log(`検索: ${cragRetrieveMs} ms`);
  console.log(`入力トークン: ${crag.promptTokens}`);
  console.log(`回答生成: ${cragGenerateMs} ms`);
  console.log(`回答:\n${crag.text}`);

  console.log("\nSelf-RAG");
  console.log(`検索回数: 1`);
  printHits(selfHits);
  console.log(`検索: ${selfRetrieveMs} ms`);
  console.log(`初回回答:\n${initial.text}`);
  console.log(`初回判定: ${reflection.support}（${SUPPORT_LABELS[reflection.support]}） 信頼度 ${reflection.confidence.toFixed(2)}`);
  console.log(`確率: ${formatSupport(reflection)}`);
  if (recheck) {
    console.log(`修正: ${reviseMs} ms / 入力トークン ${reviseTokens}`);
    console.log(`再評価: ${recheck.support}（${SUPPORT_LABELS[recheck.support]}） 信頼度 ${recheck.confidence.toFixed(2)}`);
    console.log(`確率: ${formatSupport(recheck)}`);
  } else {
    console.log("修正: なし");
  }
  console.log(`Jev: ${jevMs} ms`);
  console.log(`文書数: ${selfHits.length}`);
  console.log(`初回入力トークン: ${initial.promptTokens}`);
  console.log(`回答生成: ${generateMs} ms`);
  console.log(`回答:\n${finalText}`);
}

const plantedQuery = QUESTIONS[1];
const plantedHits = await retrieve({ index, query: plantedQuery, embedder, k: TOP_K });
const planted = await evaluateAnswer({
  query: plantedQuery,
  hits: plantedHits,
  answer: PLANTED_ANSWER,
  apiKey: jevKey,
});
console.log(`\n根拠のない回答の検証`);
console.log(`質問: ${plantedQuery}`);
console.log(`入力した回答:\n${PLANTED_ANSWER}`);
printHits(plantedHits);
console.log(`判定: ${planted.support}（${SUPPORT_LABELS[planted.support]}） 信頼度 ${planted.confidence.toFixed(2)}`);
console.log(`確率: ${formatSupport(planted)}`);

function formatSupport(decision: SupportDecision): string {
  return Object.keys(SUPPORT)
    .map((label) => `${label} ${decision.probabilities[label as Support].toFixed(2)}`)
    .join(" / ");
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
