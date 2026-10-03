// Retrieval quality for #19, computed exactly: each question's target message
// is ranked against every message in the mailbox, with no vector index, so
// the numbers measure the model alone.
//
// Titan V2 gives, at a smaller dimension, the first components of its 1,024
// vector, renormalized. So one vector per message at 1,024 stands for every
// size, cut to each.

export class Vectors {
  readonly count: number;
  readonly dimensions: number;
  private readonly data: Float32Array;
  // One over each vector's length on its first d components, per d.
  private readonly inverseNorms = new Map<number, Float32Array>();

  constructor(data: Float32Array, dimensions: number) {
    this.data = data;
    this.dimensions = dimensions;
    this.count = data.length / dimensions;
  }

  static of(vectors: ArrayLike<number>[]): Vectors {
    const dimensions = vectors[0]!.length;
    const data = new Float32Array(vectors.length * dimensions);
    vectors.forEach((v, i) => data.set(v, i * dimensions));
    return new Vectors(data, dimensions);
  }

  vector(index: number): Float32Array {
    return this.data.subarray(index * this.dimensions, (index + 1) * this.dimensions);
  }

  // One plus the number of messages more similar to the query than the
  // target, on the first `dimensions` components. Messages with the same
  // text tie with the target and don't push it down.
  rank(query: ArrayLike<number>, target: number, dimensions: number): number {
    const norms = this.norms(dimensions);
    const similarity = (index: number) => {
      const offset = index * this.dimensions;
      let dot = 0;
      for (let d = 0; d < dimensions; d++) dot += query[d]! * this.data[offset + d]!;
      return dot * norms[index]!;
    };
    const threshold = similarity(target);
    let rank = 1;
    for (let i = 0; i < this.count; i++) {
      if (similarity(i) > threshold) rank++;
    }
    return rank;
  }

  private norms(dimensions: number): Float32Array {
    let norms = this.inverseNorms.get(dimensions);
    if (!norms) {
      norms = new Float32Array(this.count);
      for (let i = 0; i < this.count; i++) {
        const offset = i * this.dimensions;
        let sum = 0;
        for (let d = 0; d < dimensions; d++) sum += this.data[offset + d]! ** 2;
        norms[i] = sum > 0 ? 1 / Math.sqrt(sum) : 0;
      }
      this.inverseNorms.set(dimensions, norms);
    }
    return norms;
  }
}

// The first `dimensions` components of a vector, renormalized.
export function truncate(vector: ArrayLike<number>, dimensions: number): Float32Array {
  const cut = Float32Array.from({ length: dimensions }, (_, d) => vector[d]!);
  const norm = Math.hypot(...cut);
  return cut.map((x) => x / norm);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let d = 0; d < a.length; d++) {
    dot += a[d]! * b[d]!;
    aa += a[d]! ** 2;
    bb += b[d]! ** 2;
  }
  return dot / Math.sqrt(aa * bb);
}

// Each question's target rank, summed up. MRR is over the whole ranking.
export function quality(ranks: number[]) {
  const sorted = [...ranks].sort((a, b) => a - b);
  const share = (top: number) => ranks.filter((r) => r <= top).length / ranks.length;
  return {
    questions: ranks.length,
    recallAt1: share(1),
    recallAt10: share(10),
    mrr: ranks.reduce((sum, r) => sum + 1 / r, 0) / ranks.length,
    medianRank: sorted[Math.floor((sorted.length - 1) / 2)]!,
  };
}
