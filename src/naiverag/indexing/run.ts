import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VectorIndex } from "../domain/types.js";
import { chunkManuals } from "./chunk.js";
import type { Embedder } from "./embed.js";
import { loadManuals } from "./load-manuals.js";

export async function indexManuals(options: {
  manualsDir: string;
  outFile: string;
  embedder: Embedder;
}): Promise<VectorIndex> {
  const manuals = await loadManuals(options.manualsDir);
  if (manuals.length === 0) {
    throw new Error(`マニュアルがありません: ${options.manualsDir}`);
  }

  const chunks = chunkManuals(manuals);
  if (chunks.length === 0) {
    throw new Error("チャンクが 0 件です。マニュアルに ## の節があるか確認してください");
  }

  const embeddings = await options.embedder.embed(chunks.map((chunk) => chunk.text));
  const dimension = embeddings[0]?.length ?? 0;
  if (dimension === 0 || embeddings.some((embedding) => embedding.length !== dimension)) {
    throw new Error("Embedding の次元が揃っていません");
  }

  const index: VectorIndex = {
    model: options.embedder.model,
    createdAt: new Date().toISOString(),
    chunks: chunks.map((chunk, i) => ({ ...chunk, embedding: embeddings[i] })),
  };

  await mkdir(path.dirname(options.outFile), { recursive: true });
  await writeFile(options.outFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return index;
}
