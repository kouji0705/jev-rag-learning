export type Embedder = {
  readonly model: string;
  embed(texts: readonly string[]): Promise<number[][]>;
};
