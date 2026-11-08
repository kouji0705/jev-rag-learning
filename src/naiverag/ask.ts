import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAnswer } from "./generation/generate.js";
import { createOpenRouterEmbedder, createOpenRouterGenerator } from "./providers/openrouter.js";
import { loadIndex } from "./retrieval/load-index.js";
import { retrieve } from "./retrieval/search.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  throw new Error("質問を渡してください。例: npm run ask -- \"Standardプランの月額料金はいくらですか？\"");
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY が .env にありません");
}

const index = await loadIndex(path.join(root, "data", "index.json"));
const configuredEmbeddingModel = process.env.OPENROUTER_EMBEDDING_MODEL;
if (configuredEmbeddingModel && configuredEmbeddingModel !== index.model) {
  throw new Error(
    `OPENROUTER_EMBEDDING_MODEL (${configuredEmbeddingModel}) が data/index.json のモデル (${index.model}) と違います`,
  );
}

const chatModel = process.env.OPENROUTER_CHAT_MODEL ?? "openai/gpt-4.1-mini";
const hits = await retrieve({
  index,
  query,
  embedder: createOpenRouterEmbedder({ apiKey, model: index.model }),
  k: 3,
});
const answer = await generateAnswer({
  generator: createOpenRouterGenerator({ apiKey, model: chatModel }),
  query,
  hits,
});

console.log(`質問: ${query}`);
console.log(`Embedding: ${index.model}`);
console.log(`回答モデル: ${chatModel}`);
console.log("\n参照:");
for (const [rank, hit] of hits.entries()) {
  console.log(`${rank + 1}. ${hit.score.toFixed(4)}  ${hit.id}  ${hit.heading}`);
}
console.log(`\n回答:\n${answer}`);
