import type { Hit, VectorIndex } from "../naiverag/domain/types.js";
import type { Embedder } from "../naiverag/indexing/embed.js";
import type { Generator } from "../naiverag/generation/generate.js";
import { retrieve } from "../naiverag/retrieval/search.js";
import { decideNext, type NextDecision } from "./decide.js";
import { nextQuery } from "./query.js";

export const MAX_SEARCHES = 3;
export const TOP_K = 3;
export const INCOMPLETE = "一部の情報をマニュアルから確認できません。";

export type HopStep = {
  query: string;
  hits: Hit[];
  decision: NextDecision;
  retrieveMs: number;
  jevMs: number;
  nextQuery: string | null;
  nextQueryMs: number;
};

export type HopResult = {
  steps: HopStep[];
  documents: Hit[];
  done: boolean;
};

export async function searchHops(options: {
  index: VectorIndex;
  embedder: Embedder;
  generator: Generator;
  apiKey: string;
  query: string;
  aspects: Readonly<Record<string, string>>;
  done: string;
}): Promise<HopResult> {
  const documents: Hit[] = [];
  const steps: HopStep[] = [];
  let searchQuery = options.query;

  for (let hop = 0; hop < MAX_SEARCHES; hop++) {
    const usedQuery = searchQuery;
    const retrieveStarted = Date.now();
    const hits = await retrieve({
      index: options.index,
      query: usedQuery,
      embedder: options.embedder,
      k: TOP_K,
    });
    const retrieveMs = Date.now() - retrieveStarted;
    appendUnique(documents, hits);

    const jevStarted = Date.now();
    const decision = await decideNext({
      query: options.query,
      hits: documents,
      aspects: options.aspects,
      done: options.done,
      apiKey: options.apiKey,
    });
    const jevMs = Date.now() - jevStarted;

    let followUp: string | null = null;
    let nextQueryMs = 0;
    if (decision.choice !== "done" && hop < MAX_SEARCHES - 1) {
      const description = options.aspects[decision.choice];
      if (!description) {
        throw new Error(`未知の判断です: ${decision.choice}`);
      }
      const started = Date.now();
      followUp = await nextQuery({
        generator: options.generator,
        query: options.query,
        hits: documents,
        missing: decision.choice,
        description,
      });
      nextQueryMs = Date.now() - started;
      searchQuery = followUp;
    }

    steps.push({
      query: usedQuery,
      hits,
      decision,
      retrieveMs,
      jevMs,
      nextQuery: followUp,
      nextQueryMs,
    });

    if (decision.choice === "done") break;
  }

  return { steps, documents, done: steps.at(-1)?.decision.choice === "done" };
}

function appendUnique(documents: Hit[], hits: readonly Hit[]) {
  const seen = new Set(documents.map((hit) => hit.id));
  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    documents.push(hit);
  }
}
