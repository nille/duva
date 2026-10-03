// How #19 scores an embedding model: each question's target message is ranked
// against the whole mailbox by cosine similarity, at each dimension a model's
// vectors are cut to.
import { expect, test } from "vitest";
import { Vectors, quality } from "../harness/retrieval.ts";

const unit = (...v: number[]) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

// Four messages, in three dimensions.
const vectors = Vectors.of([unit(1, 0, 0), unit(0.9, 0.1, 0), unit(0, 1, 0), unit(0, 0, 1)]);

test("A target ranks after every message more similar to the question", () => {
  expect(vectors.rank(unit(0.8, 0.2, 0), 1, 3)).toBe(1);
  expect(vectors.rank(unit(0.8, 0.2, 0), 0, 3)).toBe(2);
  expect(vectors.rank(unit(0, 0, 1), 3, 3)).toBe(1);
});

test("Cut to fewer dimensions, vectors are compared on their first ones, renormalized", () => {
  // On the first dimension alone, messages 0 and 1 point the same way, and a
  // tie doesn't push the target down.
  expect(vectors.rank(unit(0.8, 0.2, 0), 1, 1)).toBe(1);
  // Message 2 is (0, 1) on two dimensions, so it beats message 1 for (0.1, 1).
  expect(vectors.rank(unit(0.1, 1, 0), 1, 2)).toBe(2);
});

test("Recall at 10 counts targets ranked tenth or better, and MRR averages one over each rank", () => {
  expect(quality([1, 2, 10, 11, 100])).toEqual({ questions: 5, recallAt1: 0.2, recallAt10: 0.6, mrr: (1 + 1 / 2 + 1 / 10 + 1 / 11 + 1 / 100) / 5, medianRank: 10 });
});
