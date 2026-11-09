import type { ScoredHit } from "./evaluate.js";

export const MIN_RELEVANCE = 2;
export const MAX_DOCUMENTS = 3;
export const NO_EVIDENCE = "マニュアルからは確認できません。";

export function selectDocuments(hits: readonly ScoredHit[]): ScoredHit[] {
  return hits
    .filter((hit) => hit.relevance >= MIN_RELEVANCE)
    .sort((a, b) => b.relevance - a.relevance || b.score - a.score)
    .slice(0, MAX_DOCUMENTS);
}
