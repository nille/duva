// Titan Text Embeddings V2 at 1,024 dimensions (ADR-0007), in the deployment's own region, so mail
// stays there. Titan takes one text per request, so a batch runs as concurrent requests, and the
// SDK's adaptive retries slow down when Bedrock throttles. A request that hangs is abandoned and
// retried, since the SDK otherwise waits on it forever.
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { embeddingModel } from "./infrastructure.ts";

/** Turns texts into vectors whose cosine says how alike their meanings are. */
export interface Embedder {
  /** One unit vector of `embeddingDimensions` for each text, in order. */
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** The vectors' size. Titan's 256 and 512 are prefixes of it, so an index can be cut down later without embedding again (docs/aws.md). */
export const embeddingDimensions = 1024;

/** Titan V2 takes at most 50,000 characters. */
const longestText = 50_000;

/** How many requests one embedder has open at once. The spike's 64 from one client ran without throttling (docs/aws.md). */
const concurrency = 16;

/** Titan answers in about 120 ms at p95 from Lambda (#19), so 10 s only abandons a request that hangs. */
const requestTimeout = 10_000;

export function titanEmbedder(client = new BedrockRuntimeClient({ retryMode: "adaptive", maxAttempts: 10, requestHandler: { requestTimeout, throwOnRequestTimeout: true } })): Embedder {
  const embedOne = async (text: string): Promise<Float32Array> => {
    const { body } = await client.send(
      new InvokeModelCommand({
        modelId: embeddingModel,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ inputText: text.slice(0, longestText), dimensions: embeddingDimensions, normalize: true }),
      }),
    );
    return Float32Array.from((JSON.parse(new TextDecoder().decode(body)) as { embedding: number[] }).embedding);
  };
  return {
    async embed(texts) {
      const vectors = new Array<Float32Array>(texts.length);
      let next = 0;
      const worker = async () => {
        while (next < texts.length) {
          const at = next++;
          vectors[at] = await embedOne(texts[at]!);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
      return vectors;
    },
  };
}
