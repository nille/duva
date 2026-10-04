// Titan Text Embeddings V2 in eu-north-1, so mail stays in the region. It
// embeds one text per request, so a batch runs as concurrent requests, and the
// SDK's adaptive retries slow down when Bedrock throttles. A request that hangs
// is abandoned and retried, since the SDK otherwise waits on it forever.
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

export interface Embedder {
  dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface TitanEmbedder extends Embedder {
  // What the embedder has sent so far, which is what Bedrock bills.
  usage: { requests: number; inputTokens: number };
}

export const titanModelId = "amazon.titan-embed-text-v2:0";

// Titan V2 also offers 256 and 512 dimensions. #19 picked 1,024.
const dimensions = 1024;
// What Bedrock answered at without throttling, from here, on 2026-10-03.
const concurrency = 64;
// Titan answers in about 120 ms at p95 from Lambda (#19), so 10 s only
// abandons a request that hangs.
const requestTimeoutMs = 10_000;

export function titanEmbedder(): TitanEmbedder {
  const client = new BedrockRuntimeClient({
    region: "eu-north-1",
    retryMode: "adaptive",
    maxAttempts: 10,
    requestHandler: { requestTimeout: requestTimeoutMs, throwOnRequestTimeout: true },
  });
  const usage = { requests: 0, inputTokens: 0 };

  async function embedOne(text: string): Promise<Float32Array> {
    const response = await client.send(
      new InvokeModelCommand({
        modelId: titanModelId,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ inputText: text, dimensions, normalize: true }),
      }),
    );
    const body = JSON.parse(Buffer.from(response.body).toString("utf8")) as { embedding: number[]; inputTextTokenCount: number };
    usage.requests++;
    usage.inputTokens += body.inputTextTokenCount;
    return Float32Array.from(body.embedding);
  }

  return {
    dimensions,
    usage,
    async embed(texts) {
      const vectors = new Array<Float32Array>(texts.length);
      let next = 0;
      const worker = async () => {
        while (next < texts.length) {
          const i = next++;
          vectors[i] = await embedOne(texts[i]!);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, worker));
      return vectors;
    },
  };
}
