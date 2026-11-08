export type Manual = {
  source: string;
  markdown: string;
};

export type Chunk = {
  id: string;
  source: string;
  title: string;
  heading: string;
  text: string;
};

export type IndexedChunk = Chunk & {
  embedding: number[];
};

export type VectorIndex = {
  model: string;
  createdAt: string;
  chunks: IndexedChunk[];
};

export type Hit = {
  id: string;
  source: string;
  title: string;
  heading: string;
  text: string;
  score: number;
};
