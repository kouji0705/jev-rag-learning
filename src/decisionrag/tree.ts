import { chunkManuals } from "../naiverag/indexing/chunk.js";
import type { Manual } from "../naiverag/domain/types.js";

export type ManualSection = {
  id: string;
  source: string;
  category: string;
  group: string;
  heading: string;
  text: string;
};

export type GroupNode = {
  id: string;
  name: string;
  sections: ManualSection[];
};

export type CategoryNode = {
  id: string;
  source: string;
  name: string;
  groups: GroupNode[];
};

export function buildTree(manuals: readonly Manual[]): CategoryNode[] {
  const categories = new Map<string, CategoryNode>();
  for (const chunk of chunkManuals(manuals)) {
    let category = categories.get(chunk.source);
    if (!category) {
      category = { id: chunk.source, source: chunk.source, name: chunk.title, groups: [] };
      categories.set(chunk.source, category);
    }
    let group = category.groups.find((item) => item.name === chunk.group);
    if (!group) {
      group = { id: `${chunk.source}#${chunk.group}`, name: chunk.group, sections: [] };
      category.groups.push(group);
    }
    group.sections.push({
      id: chunk.id,
      source: chunk.source,
      category: chunk.title,
      group: chunk.group,
      heading: chunk.heading,
      text: chunk.text,
    });
  }
  return [...categories.values()];
}
