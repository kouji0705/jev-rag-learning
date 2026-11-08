import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexManuals } from "./indexing/run.js";
import { createOpenRouterEmbedder } from "./providers/openrouter.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY が .env にありません");
}

const model = process.env.OPENROUTER_EMBEDDING_MODEL ?? "openai/text-embedding-3-small";
const index = await indexManuals({
  manualsDir: path.join(root, "data", "manuals"),
  outFile: path.join(root, "data", "index.json"),
  embedder: createOpenRouterEmbedder({ apiKey, model }),
});

const dimension = index.chunks[0]?.embedding.length ?? 0;
console.log(`モデル: ${index.model}`);
console.log(`チャンク: ${index.chunks.length} 件`);
console.log(`次元: ${dimension}`);
console.log("保存先: data/index.json");
for (const chunk of index.chunks) {
  console.log(`- ${chunk.id} ${chunk.heading} (${chunk.text.length} 文字)`);
}
