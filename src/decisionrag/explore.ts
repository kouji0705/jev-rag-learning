import { score, TypeSafeClient } from "@typesafe-ai/sdk";
import type { Hit } from "../naiverag/domain/types.js";
import type { CategoryNode, ManualSection } from "./tree.js";

const RUBRIC = [
  "関係がない",
  "話題は近いが、答えはなさそう",
  "答えの一部がありそう",
  "質問が聞いている操作に直接答えられそう",
] as const;

const CAUTION = "似た言葉があるだけでは点を上げない。";

export const MIN_CATEGORY_RELEVANCE = 2;
export const MAX_DOCUMENTS = 3;

export type ScoredCategory = {
  id: string;
  name: string;
  relevance: number;
  kept: boolean;
};

export type ScoredGroup = {
  id: string;
  category: string;
  name: string;
  relevance: number;
  kept: boolean;
};

export type ScoredSection = ManualSection & {
  relevance: number;
  selected: boolean;
};

export type Exploration = {
  categories: ScoredCategory[];
  groups: ScoredGroup[];
  sections: ScoredSection[];
  hits: Hit[];
};

export async function exploreTree(options: {
  query: string;
  tree: readonly CategoryNode[];
  apiKey: string;
}): Promise<Exploration> {
  const categoryScores = await scoreAll({
    query: options.query,
    apiKey: options.apiKey,
    kind: "カテゴリ",
    candidates: options.tree.map((category) => ({
      id: category.id,
      label: category.name,
      body: category.groups.map((group) => group.name).join("、"),
    })),
  });
  const categories = markKept(
    [...options.tree]
      .map((category) => ({ id: category.id, name: category.name, relevance: categoryScores.get(category.id) ?? 0 }))
      .sort((a, b) => b.relevance - a.relevance),
  );
  const keptCategoryIds = new Set(categories.filter((category) => category.kept).map((category) => category.id));

  const openedGroups = options.tree
    .filter((category) => keptCategoryIds.has(category.id))
    .flatMap((category) => category.groups.map((group) => ({ category, group })));
  const groupScores = await scoreAll({
    query: options.query,
    apiKey: options.apiKey,
    kind: "グループ",
    candidates: openedGroups.map(({ category, group }) => ({
      id: group.id,
      label: `${category.name} / ${group.name}`,
      body: group.sections.map((section) => section.heading).join("、"),
    })),
  });
  const groups = markKept(
    openedGroups
      .map(({ category, group }) => ({
        id: group.id,
        category: category.name,
        name: group.name,
        relevance: groupScores.get(group.id) ?? 0,
      }))
      .sort((a, b) => b.relevance - a.relevance),
  );
  const keptGroupIds = new Set(groups.filter((group) => group.kept).map((group) => group.id));

  const openedSections = openedGroups
    .filter(({ group }) => keptGroupIds.has(group.id))
    .flatMap(({ group }) => group.sections);
  const sectionScores = await scoreAll({
    query: options.query,
    apiKey: options.apiKey,
    kind: "文書",
    candidates: openedSections.map((section) => ({
      id: section.id,
      label: `${section.category} / ${section.group} / ${section.heading}`,
      body: section.text,
    })),
  });
  const rankedSections = openedSections
    .map((section) => ({ ...section, relevance: sectionScores.get(section.id) ?? 0 }))
    .sort((a, b) => b.relevance - a.relevance);
  const selectedIds = new Set(rankedSections.slice(0, MAX_DOCUMENTS).map((section) => section.id));
  const sections = rankedSections.map((section) => ({ ...section, selected: selectedIds.has(section.id) }));
  const hits = sections.filter((section) => section.selected).map(toHit);
  return { categories, groups, sections, hits };
}

function markKept<T extends { id: string; relevance: number }>(ranked: T[]): (T & { kept: boolean })[] {
  const passing = ranked.filter((item) => item.relevance >= MIN_CATEGORY_RELEVANCE);
  const keptIds = new Set((passing.length > 0 ? passing : ranked.slice(0, 1)).map((item) => item.id));
  return ranked.map((item) => ({ ...item, kept: keptIds.has(item.id) }));
}

async function scoreAll(options: {
  query: string;
  apiKey: string;
  kind: "カテゴリ" | "グループ" | "文書";
  candidates: readonly { id: string; label: string; body: string }[];
}): Promise<Map<string, number>> {
  const questions: Record<string, ReturnType<typeof score<typeof RUBRIC>>> = {};
  options.candidates.forEach((candidate, index) => {
    questions[`q${index}`] = score(
      `質問「${options.query}」に対して、この${options.kind}「${candidate.label}」は回答の根拠になりそうか。${CAUTION}`,
      RUBRIC,
    );
  });
  const state = [
    `質問: ${options.query}`,
    "",
    "候補:",
    ...options.candidates.map((candidate, index) => `q${index}. ${candidate.label}\n${candidate.body}`),
  ].join("\n\n");
  const client = new TypeSafeClient({ apiKey: options.apiKey, timeout: 60_000 });
  const { answers } = await client.systemOne({ state, questions });
  return new Map(
    options.candidates.map((candidate, index) => {
      const answer = answers[`q${index}`];
      if (!answer || answer.type !== "score") {
        throw new Error(`Jevの採点がありません: ${candidate.label}`);
      }
      return [candidate.id, answer.score];
    }),
  );
}

function toHit(section: ScoredSection): Hit {
  return {
    id: section.id,
    source: section.source,
    title: section.category,
    heading: section.heading,
    text: section.text,
    score: section.relevance,
  };
}
