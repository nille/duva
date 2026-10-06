// A stand-in for Titan Text Embeddings V2: what Titan answered for each text the tests embed, recorded
// once from Bedrock, so tests find mail by meaning as Duva does, without reaching AWS. A text no one
// recorded gets a vector of its own drawn from its hash, as unlike every other as two random
// directions in 1,024 dimensions are, so it's found by meaning by nothing but itself.
//
// To record what a test embeds, run it with DUVA_RECORD_EMBEDDINGS=1 and AWS_PROFILE set to the test
// account: each text not yet recorded is embedded by Titan in eu-north-1 and added to
// titan-vectors.json. Record one test file at a time, since each worker writes the file.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { type Embedder, embeddingDimensions, titanEmbedder } from "../src/titan.ts";

const file = new URL("./titan-vectors.json", import.meta.url);

/** Each text's vector, as int8 codes in base64 with the scale that turns them back into floats. */
type Recordings = Record<string, { scale: number; codes: string }>;

const read = (): Recordings => JSON.parse(readFileSync(file, "utf8"));

export function recordedTitan(): Embedder {
  const recordings = read();
  const recording = process.env.DUVA_RECORD_EMBEDDINGS === "1";
  const titan = recording ? titanEmbedder(new BedrockRuntimeClient({ region: "eu-north-1" })) : undefined;
  return {
    async embed(texts) {
      const missing = [...new Set(texts.filter((text) => recordings[text] === undefined))];
      if (titan !== undefined && missing.length > 0) {
        const vectors = await titan.embed(missing);
        const all = read();
        missing.forEach((text, at) => (all[text] = recordings[text] = encode(vectors[at]!)));
        writeFileSync(file, `${JSON.stringify(Object.fromEntries(Object.entries(all).sort(([a], [b]) => (a < b ? -1 : 1))), null, 1)}\n`);
      }
      return texts.map((text) => (recordings[text] === undefined ? unlikeEveryOther(text) : decode(recordings[text])));
    },
  };
}

function encode(vector: Float32Array) {
  const scale = Math.max(...vector.map(Math.abs)) / 127;
  return { scale, codes: Buffer.from(Int8Array.from(vector, (value) => Math.round(value / scale)).buffer).toString("base64") };
}

function decode({ scale, codes }: { scale: number; codes: string }): Float32Array {
  const bytes = Buffer.from(codes, "base64");
  return unit(Float32Array.from(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length), (code) => code * scale));
}

/** A unit vector in a direction drawn from the text's hash. */
function unlikeEveryOther(text: string): Float32Array {
  let seed = createHash("sha256").update(text).digest().readUInt32LE(0);
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
  };
  return unit(Float32Array.from({ length: embeddingDimensions }, random));
}

function unit(vector: Float32Array): Float32Array {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}
