import type { Chunk, Manual } from "../domain/types.js";

/** マニュアルを見出し（##）ごとに、ベクトル化する単位へ分ける。 */
export function chunkManual(manual: Manual): Chunk[] {
  const lines = manual.markdown.replace(/\r\n/g, "\n").split("\n");
  let title = manual.source.replace(/\.md$/, "");
  const sections: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of lines) {
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      title = h1[1].trim();
      continue;
    }

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      if (current) sections.push(current);
      current = { heading: h2[1].trim(), lines: [] };
      continue;
    }

    if (current) current.lines.push(line);
  }
  if (current) sections.push(current);

  return sections.flatMap((section, index) => {
    const body = section.lines.join("\n").trim();
    if (!body) return [];

    return [
      {
        id: `${manual.source}#${index}`,
        source: manual.source,
        title,
        heading: section.heading,
        text: `# ${title}\n## ${section.heading}\n\n${body}`,
      },
    ];
  });
}

export function chunkManuals(manuals: readonly Manual[]): Chunk[] {
  return manuals.flatMap(chunkManual);
}
