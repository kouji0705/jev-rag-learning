import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenRouterEmbedder } from "./providers/openrouter.js";
import { loadIndex } from "./retrieval/load-index.js";
import { retrieve } from "./retrieval/search.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  throw new Error("質問を渡してください。例: npm run retrieve -- \"Standardプランの月額料金はいくらですか？\"");
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY が .env にありません");
}

const index = await loadIndex(path.join(root, "data", "index.json"));
const configuredModel = process.env.OPENROUTER_EMBEDDING_MODEL;
if (configuredModel && configuredModel !== index.model) {
  throw new Error(
    `OPENROUTER_EMBEDDING_MODEL (${configuredModel}) が data/index.json のモデル (${index.model}) と違います`,
  );
}

const hits = await retrieve({
  index,
  query,
  embedder: createOpenRouterEmbedder({ apiKey, model: index.model }),
  k: 3,
});

console.log(`質問: ${query}`);
console.log(`モデル: ${index.model}`);
for (const [rank, hit] of hits.entries()) {
  console.log(`\n${rank + 1}. ${hit.score.toFixed(4)}  ${hit.id}  ${hit.heading}`);
  console.log(hit.text);
}
