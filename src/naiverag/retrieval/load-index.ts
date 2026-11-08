import { readFile } from "node:fs/promises";
import type { VectorIndex } from "../domain/types.js";

export async function loadIndex(file: string): Promise<VectorIndex> {
  const index = JSON.parse(await readFile(file, "utf8")) as VectorIndex;
  if (!index.model || !Array.isArray(index.chunks) || index.chunks.length === 0) {
    throw new Error(`ベクトルインデックスを読めません: ${file}`);
  }
  return index;
}
