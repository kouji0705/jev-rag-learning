import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Manual } from "../domain/types.js";

export async function loadManuals(dir: string): Promise<Manual[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".md")).sort();
  return Promise.all(
    names.map(async (name) => ({
      source: name,
      markdown: await readFile(path.join(dir, name), "utf8"),
    })),
  );
}
